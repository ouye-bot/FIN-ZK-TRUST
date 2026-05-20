const express = require('express');
const router = express.Router();
const validate = require('../middleware/validate');
const { investSchema } = require('../middleware/validators');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const proofDao = require('../dao/proofDao');
const { verifySM2Signature, generateSM3Hash, buildSignatureData } = require('../utils/cryptoUtils');
const { CREDIT_RULES } = require('./credit');
const creditHistoryDao = require('../dao/creditHistoryDao');
const poolService = require('../services/poolService');
const { getCurrentLendingRate } = require('../services/interestRateService');
const logger = require('../utils/logger');
const blockchainService = require('../services/blockchainService');
const blockchainQueueService = require('../services/blockchainQueueService');
const dynamicConfig = require('../services/dynamicConfigService');

/**
 * @swagger
 * /invest:
 *   post:
 *     summary: 用户投资/出资
 *     tags: [投资]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *               - term
 *               - creditProof
 *               - verificationCode
 *               - signature
 *             properties:
 *               userId:
 *                 type: integer
 *                 example: 1
 *               amount:
 *                 type: integer
 *                 example: 1000
 *               term:
 *                 type: integer
 *                 example: 30
 *               creditProof:
 *                 type: object
 *               verificationCode:
 *                 type: string
 *               signature:
 *                 type: string
 *     responses:
 *       200:
 *         description: 投资成功
 *       400:
 *         description: 参数错误或验证失败
 * /invest/{userId}:
 *   get:
 *     summary: 获取用户投资列表
 *     tags: [投资]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: 投资列表
 */

// 投资API
router.post('/', validate(investSchema), async (req, res) => {
  try {
    const { userId, amount, term, creditProof, verificationCode, signature } = req.body;
    logger.info('投资请求', { userId, amount, term });

    // 数据隔离检查
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作其他用户的投资' });
    }

    // 验证请求参数
    if (!userId || !amount || !term || !creditProof || !verificationCode || !signature) {
      logger.warning('投资失败：缺少必要参数', { userId, amount, term, hasCreditProof: !!creditProof, hasVerificationCode: !!verificationCode, hasSignature: !!signature });
      return res.status(400).json({
        success: false,
        message: '缺少必要的参数'
      });
    }

    // 验证SM2签名
    const user = await userDao.findById(userId);
    if (!user) {
      logger.warning('投资失败：用户不存在', { userId });
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (!user.sm2_public_key) {
      logger.warning('投资失败：用户未提供SM2公钥', { userId });
      return res.status(400).json({
        success: false,
        message: '用户未提供SM2公钥'
      });
    }

    const signatureData = buildSignatureData(
      { userId: userId.toString(), amount: parseInt(amount), term, creditProofId: creditProof.id },
      ['amount', 'creditProofId', 'term', 'userId']
    );
    logger.info('投资签名数据构建完成', { userId });
    const isSignatureValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);
    if (!isSignatureValid) {
      logger.warning('投资失败：无效的SM2签名', { userId, signatureData });
      return res.status(400).json({
        success: false,
        message: '无效的SM2签名'
      });
    }

    // 验证creditProof格式
    if (!creditProof.id) {
      logger.warning('投资失败：信用证明格式无效', { creditProof });
      return res.status(400).json({
        success: false,
        message: '信用证明格式无效'
      });
    }

    // 验证信用证明和口令
    const matchingProof = await proofDao.findByProofId(creditProof.id);

    if (!matchingProof || new Date(matchingProof.expires_at) <= new Date() || matchingProof.verification_code !== verificationCode) {
      logger.warning('投资失败：信用证明或验证口令无效', {
        proofId: creditProof.id,
        verificationCode
      });
      return res.status(400).json({
        success: false,
        message: '信用证明或验证口令无效'
      });
    }

    // 检查用户余额
    if (user.balance < amount) {
      logger.warning('投资失败：余额不足', {
        userId,
        balance: user.balance,
        required: amount
      });
      return res.status(400).json({
        success: false,
        message: '余额不足'
      });
    }

    // 动态出资限额检查
    const investLimit = await dynamicConfig.getInvestLimit();
    if (amount < investLimit.minInvest) {
      logger.warning('投资失败：金额低于最低出资限额', {
        userId,
        amount,
        minInvest: investLimit.minInvest
      });
      return res.status(400).json({
        success: false,
        message: `单笔出资不能低于 ${investLimit.minInvest} 元`
      });
    }
    if (amount > investLimit.maxInvest) {
      logger.warning('投资失败：金额超过最高出资限额', {
        userId,
        amount,
        maxInvest: investLimit.maxInvest
      });
      return res.status(400).json({
        success: false,
        message: `单笔出资不能超过 ${investLimit.maxInvest} 元`
      });
    }

    // 计算预期收益（使用动态浮动利率）
    const annualRate = await getCurrentLendingRate();
    const dailyRate = annualRate / 365;
    const expectedReturn = Math.round(amount * dailyRate * term * 100) / 100;

    logger.info('出资利率计算', {
      annualRate: (annualRate * 100).toFixed(2) + '%',
      amount,
      term,
      expectedReturn
    });

    // 调用资金池服务处理投资
    await poolService.invest(userId, parseInt(amount));

    // 生成交易数据的SM3哈希，用于数据完整性验证
    const transactionDataForHash = JSON.stringify({
      userId,
      amount: parseInt(amount),
      term,
      expectedReturn,
      timestamp: new Date().toISOString()
    });
    const transactionHash = generateSM3Hash(transactionDataForHash);

    // 记录投资
    const newTransaction = await transactionDao.create({
      user_id: parseInt(userId),
      type: 'invest',
      amount: parseInt(amount),
      interest: expectedReturn,
      total_amount: parseInt(amount) + expectedReturn,
      status: 'active',
      tx_hash: transactionHash,
      term: term
    });

    logger.info('投资成功', { userId, transactionId: newTransaction.id, amount, expectedReturn });

    // 出资成功，增加信用分 +2（统一信用分更新）
    try {
      const newScore = await dynamicConfig.updateCreditScore(
        userId,
        CREDIT_RULES.SCORE_CHANGES.INVEST_REWARD,
        '出资奖励',
        newTransaction ? newTransaction.id : null
      );
      logger.info('出资奖励信用分 +2', {
        userId,
        newScore
      });
    } catch (scoreErr) {
      logger.warning('出资奖励信用分失败', { error: scoreErr.message });
    }
    
    // 异步上链存证 - 加入重试队列
    blockchainQueueService.enqueue('storeTransactionHash', {
      transactionId: newTransaction.id.toString(),
      transactionData: newTransaction,
      transactionType: 'invest',
      userId: userId.toString()
    }).catch(err => {
      logger.error('投资上链入队失败', { transactionId: newTransaction.id, error: err.message });
    });
    
    res.json({
      success: true,
      message: '投资成功',
      transaction: newTransaction
    });
  } catch (error) {
    logger.error('投资失败', { error: error.message, userId: req.body.userId });
    res.status(500).json({
      success: false,
      message: '投资失败'
    });
  }
});

// 动态出资配置查询（用于前端展示）
router.get('/config', async (req, res) => {
  try {
    const investLimit = await dynamicConfig.getInvestLimit();
    const currentRate = await getCurrentLendingRate();
    res.json({
      success: true,
      data: {
        ...investLimit,
        currentRate: Math.round(currentRate * 10000) / 100
      }
    });
  } catch (error) {
    logger.error('获取出资配置失败', { error: error.message });
    res.status(500).json({ success: false, message: '获取出资配置失败' });
  }
});

// 获取用户投资列表
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    logger.info('获取用户投资列表', { userId });

    // 数据隔离检查
    if (parseInt(req.params.userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权查看其他用户的投资' });
    }

    // 从数据库获取投资列表
    const userInvestments = await transactionDao.findByUserId(parseInt(userId), { type: 'invest' });

    // 计算到期日期
    for (const inv of userInvestments) {
      if (inv.term && inv.timestamp) {
        inv.maturityDate = new Date(new Date(inv.timestamp).getTime() + inv.term * 86400000).toISOString();
      }
    }

    logger.info('获取用户投资列表成功', { userId, investmentCount: userInvestments.length });
    res.json({
      success: true,
      investments: userInvestments
    });
  } catch (error) {
    logger.error('获取投资列表失败', { error: error.message, stack: error.stack, userId: req.params.userId });
    res.status(500).json({
      success: false,
      message: '获取投资列表失败: ' + error.message
    });
  }
});

module.exports = router;