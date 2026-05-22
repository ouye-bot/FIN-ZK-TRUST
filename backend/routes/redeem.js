const express = require('express');
const router = express.Router();
const validate = require('../middleware/validate');
const { redeemSchema } = require('../middleware/validators');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const poolDao = require('../dao/poolDao');
const proofDao = require('../dao/proofDao');
const { verifySM2Signature, generateSM3Hash, buildSignatureData } = require('../utils/cryptoUtils');
const cryptoNode = require('crypto');
const poolService = require('../services/poolService');
const logger = require('../utils/logger');
const dynamicConfig = require('../services/dynamicConfigService');
const blockchainService = require('../services/blockchainService');
const blockchainQueueService = require('../services/blockchainQueueService');
const challengeService = require('../services/challengeService');



// 赎回API
router.post('/', validate(redeemSchema), async (req, res) => {
  try {
    const { userId, amount, creditProof, verificationCode, signature } = req.body;
    logger.info('赎回请求', { userId, amount });

    // 数据隔离检查
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作其他用户的赎回' });
    }

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

    // 时序安全比较验证口令
    let codeValid = false;
    if (matchingProof && matchingProof.verification_code && verificationCode) {
      const a = Buffer.from(matchingProof.verification_code, 'utf8');
      const b = Buffer.from(verificationCode, 'utf8');
      codeValid = a.length === b.length && cryptoNode.timingSafeEqual(a, b);
    }
    if (!matchingProof || new Date(matchingProof.expires_at) <= new Date() || !codeValid) {
      logger.warning('赎回失败：信用证明或验证口令无效', {
        proofId: creditProof.id
      });
      return res.status(400).json({
        success: false,
        message: '信用证明或验证口令无效'
      });
    }

    const userCreditScore = user.credit_score || 600;
    const userRisk = userCreditScore >= 750 ? 80 : userCreditScore >= 700 ? 70 : userCreditScore >= 650 ? 60 : userCreditScore >= 600 ? 40 : 20;
    const dynamicThreshold = dynamicConfig.getChallengeThreshold('redeem', userRisk);
    if (parseInt(amount) >= dynamicThreshold) {
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

    // 使用动态流动性策略计算可赎回金额（替代旧的仅到期逻辑）
    const userInvestments = await transactionDao.findByUserId(userId, { type: 'invest' });
    const redeemInfo = poolService.calculateRedeemable(userInvestments, pool);
    const exactRedeemable = redeemInfo.maxRedeemAmount;

    if (parseInt(amount) > exactRedeemable) {
      logger.warning('赎回失败：可赎回金额不足', {
        userId,
        requestedAmount: amount,
        ...redeemInfo
      });
      return res.status(400).json({
        success: false,
        message: `可赎回金额不足，当前可赎回 ¥${exactRedeemable.toFixed(2)}（流动性档位：${redeemInfo.liquidityTier}，池可用率：${redeemInfo.liquidityRatio}%）`,
        liquidity: {
          tier: redeemInfo.liquidityTier,
          ratio: redeemInfo.liquidityRatio,
          earlyRedeemRatio: redeemInfo.earlyRedeemRatio
        }
      });
    }

    // 调用资金池服务处理赎回（原子事务：资金池扣除 + 投资关闭 + 收益累加）
    const redeemResult = await poolService.redeem(userId, parseInt(amount));
    const { totalRedeemed, totalInterestEarned } = redeemResult;

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

    logger.info('赎回交易记录已创建', { transactionId: newTransaction.id, totalRedeemed });

    logger.info('赎回成功', { userId, totalRedeemed });
    
    // 异步上链存证 - 加入重试队列
    blockchainQueueService.enqueue('storeTransactionHash', {
      transactionId: newTransaction.id.toString(),
      transactionData: newTransaction,
      transactionType: 'redeem',
      userId: userId.toString()
    }).catch(err => {
      logger.error('赎回上链入队失败', { transactionId: newTransaction.id, error: err.message });
    });
    
    res.json({
      success: true,
      message: '赎回成功',
      amount: totalRedeemed,
      newBalance: redeemResult.newBalance
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