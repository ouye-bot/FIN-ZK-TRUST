const express = require('express');
const router = express.Router();
const validate = require('../middleware/validate');
const { redeemSchema } = require('../middleware/validators');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const poolDao = require('../dao/poolDao');
const proofDao = require('../dao/proofDao');
const { verifySM2Signature, generateSM3Hash, buildSignatureData } = require('../utils/cryptoUtils');
const poolService = require('../services/poolService');
const logger = require('../utils/logger');
const blockchainService = require('../services/blockchainService');
const challengeService = require('../services/challengeService');

const LARGE_REDEEM_THRESHOLD = 10000;

// 赎回API
router.post('/', validate(redeemSchema), async (req, res) => {
  try {
    const { userId, amount, creditProof, verificationCode, signature } = req.body;
    logger.info('赎回请求', { userId, amount });

    // 验证请求参数
    if (!userId || !amount || !creditProof || !verificationCode || !signature) {
      logger.warning('赎回失败：缺少必要参数', { userId, amount, hasCreditProof: !!creditProof, hasVerificationCode: !!verificationCode, hasSignature: !!signature });
      return res.status(400).json({
        success: false,
        message: '缺少必要的参数'
      });
    }

    // 验证SM2签名
    const user = await userDao.findById(userId);
    if (!user) {
      logger.warning('赎回失败：用户不存在', { userId });
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (!user.sm2_public_key) {
      logger.warning('赎回失败：用户未提供SM2公钥', { userId });
      return res.status(400).json({
        success: false,
        message: '用户未提供SM2公钥'
      });
    }

    const signatureData = buildSignatureData(
      { userId: String(userId), amount: parseInt(amount), creditProofId: creditProof.id },
      ['amount', 'creditProofId', 'userId']
    );
    logger.info('赎回签名数据构建完成', { userId });
    const isSignatureValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);
    if (!isSignatureValid) {
      logger.warning('赎回失败：无效的SM2签名', { userId, signatureData });
      return res.status(400).json({
        success: false,
        message: '无效的SM2签名'
      });
    }

    // 验证creditProof格式
    if (!creditProof.id) {
      logger.warning('赎回失败：信用证明格式无效', { creditProof });
      return res.status(400).json({
        success: false,
        message: '信用证明格式无效'
      });
    }

    // 验证信用证明和口令
    const matchingProof = await proofDao.findByProofId(creditProof.id);

    if (!matchingProof || new Date(matchingProof.expires_at) <= new Date() || matchingProof.verification_code !== verificationCode) {
      logger.warning('赎回失败：信用证明或验证口令无效', {
        proofId: creditProof.id,
        verificationCode
      });
      return res.status(400).json({
        success: false,
        message: '信用证明或验证口令无效'
      });
    }

    if (parseInt(amount) >= LARGE_REDEEM_THRESHOLD) {
      const { challengeId, challengeSignature } = req.body;

      if (!challengeId || !challengeSignature) {
        const challenge = challengeService.generateChallenge(userId, 'redeem');
        return res.status(200).json({
          success: true,
          requireChallenge: true,
          challengeId: challenge.challengeId,
          challengeCode: challenge.challengeCode,
          message: '大额赎回需要二次签名确认'
        });
      }

      const challengeResult = challengeService.verifyChallenge(
        challengeId,
        challengeSignature,
        user.sm2_public_key
      );

      if (!challengeResult.success) {
        return res.status(400).json({
          success: false,
          message: challengeResult.error || '二次签名验证失败'
        });
      }
    }

    // 获取资金池信息进行精确校验
    const pool = await poolDao.getPool();
    
    // 精确可赎回金额校验
    const userInvestments = await transactionDao.findByUserId(userId, { type: 'invest' });
    const activeInvests = userInvestments.filter(inv => inv.status === 'active');
    const totalActiveInvest = activeInvests.reduce((sum, inv) => sum + Number(inv.amount || 0), 0);
    const poolAvailable = Number(pool.available_amount || 0);
    const exactRedeemable = Math.min(totalActiveInvest, poolAvailable);

    if (parseInt(amount) > exactRedeemable) {
      logger.warning('赎回失败：精确可赎回金额不足', {
        userId,
        requestedAmount: amount,
        totalActiveInvest,
        poolAvailable,
        exactRedeemable,
        borrowedAmount: Math.max(0, totalActiveInvest - poolAvailable)
      });
      return res.status(400).json({
        success: false,
        message: `可赎回金额不足，当前可赎回 ¥${exactRedeemable.toFixed(2)}（总出资 ¥${totalActiveInvest.toFixed(2)}，已借出 ¥${Math.max(0, totalActiveInvest - poolAvailable).toFixed(2)}）`
      });
    }

    // 调用资金池服务处理赎回
    await poolService.redeem(userId, parseInt(amount));

    // 将对应的出资交易状态更新为 completed
    const activeInvestments = await transactionDao.findByUserId(userId, { type: 'invest' });
    for (const inv of activeInvestments) {
      if (inv.status === 'active') {
        await transactionDao.updateStatus(inv.id, 'completed');
      }
    }

    // 计算总赎回金额
    const totalRedeemed = parseInt(amount);

    // 生成交易数据的SM3哈希，用于数据完整性验证
    const transactionDataForHash = JSON.stringify({
      userId,
      amount: totalRedeemed,
      timestamp: new Date().toISOString()
    });
    const transactionHash = generateSM3Hash(transactionDataForHash);

    // 创建赎回交易记录
    const newTransaction = await transactionDao.create({
      user_id: parseInt(userId),
      type: 'redeem',
      amount: totalRedeemed,
      status: 'completed',
      tx_hash: transactionHash
    });

    // 更新用户余额
    await userDao.updateBalance(userId, user.balance + totalRedeemed);
    const updatedUser = await userDao.findById(userId);
    logger.info('更新用户余额', {
      userId: user.id,
      newBalance: updatedUser.balance
    });

    logger.info('赎回成功', { userId, totalRedeemed });
    
    // 异步上链存证 - 不阻塞响应
    blockchainService.storeTransactionHash(
      newTransaction.id.toString(),
      newTransaction,
      'redeem',
      userId.toString()
    ).then(result => {
      if (result.success) {
        logger.info('赎回交易哈希上链存证成功', {
          transactionId: newTransaction.id,
          blockchainTxHash: result.blockchainTxHash
        });
      } else {
        logger.warning('赎回交易哈希上链存证失败', {
          transactionId: newTransaction.id,
          error: result.error
        });
      }
    }).catch(err => {
      logger.error('赎回交易哈希上链存证异常', {
        transactionId: newTransaction.id,
        error: err.message
      });
    });
    
    res.json({
      success: true,
      message: '赎回成功',
      amount: totalRedeemed,
      newBalance: updatedUser.balance
    });
  } catch (error) {
    logger.error('赎回失败', { error: error.message, userId: req.body.userId });
    res.status(500).json({
      success: false,
      message: '赎回失败'
    });
  }
});

module.exports = router;