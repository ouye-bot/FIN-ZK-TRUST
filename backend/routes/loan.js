const express = require('express');
const router = express.Router();
const validate = require('../middleware/validate');
const { borrowSchema, repaySchema } = require('../middleware/validators');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const proofDao = require('../dao/proofDao');
const creditHistoryDao = require('../dao/creditHistoryDao');
const { transaction } = require('../config/database');
const { verifyProof } = require('../services/zkService');
const { verifySM2Signature, buildSignatureData } = require('../utils/cryptoUtils');
const { CREDIT_RULES, getInterestRate } = require('./credit');
const challengeService = require('../services/challengeService');
const dynamicConfig = require('../services/dynamicConfigService');

/**
 * @swagger
 * /loan/borrow:
 *   post:
 *     summary: 用户借款
 *     tags: [借款]
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
 *         description: 借款成功
 *       400:
 *         description: 参数错误或验证失败
 * /loan/repay:
 *   post:
 *     summary: 用户还款
 *     tags: [借款]
 *     security:
 *       - bearerAuth: []
 * /loan/{userId}:
 *   get:
 *     summary: 获取用户借款列表
 *     tags: [借款]
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
 *         description: 借款列表
 */

const poolService = require('../services/poolService');
const { assessLoanRisk } = require('../services/riskService');
const logger = require('../utils/logger');
const blockchainService = require('../services/blockchainService');
const blockchainQueueService = require('../services/blockchainQueueService');

// 计算利息 - 基于信用评分的差异化利率 + 动态分级罚息
const calculateInterest = async (principal, days, creditScore, isOverdue = false, overdueDays = 0) => {
  const baseAnnualRate = getInterestRate(creditScore) / 100;
  const dailyRate = baseAnnualRate / 365;

  let rate;
  if (isOverdue && overdueDays > 0) {
    const penaltyMultiplier = dynamicConfig.getOverduePenaltyRate(overdueDays);
    rate = dailyRate * penaltyMultiplier;
  } else if (isOverdue) {
    rate = dailyRate * 1.5;
  } else {
    rate = dailyRate;
  }

  return Math.round(principal * rate * days * 100) / 100;
};

// 借款API
router.post('/borrow', validate(borrowSchema), async (req, res) => {
  try {
    const { userId, amount, creditProof, verificationCode, signature, term = 30 } = req.body;
    logger.info('借款请求', { userId, amount, term });

    // 数据隔离检查
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作其他用户的借款' });
    }

    // 验证请求参数
    if (!userId || !amount || !creditProof || !verificationCode || !signature) {
      logger.warning('借款失败：缺少必要参数', { userId, amount, hasCreditProof: !!creditProof, hasVerificationCode: !!verificationCode, hasSignature: !!signature });
      return res.status(400).json({
        success: false,
        message: '缺少必要的参数'
      });
    }

    // 验证借款期限
    const validTerms = [7, 14, 30, 60, 90];
    if (!validTerms.includes(term)) {
      logger.warning('借款失败：无效的借款期限', { userId, term });
      return res.status(400).json({
        success: false,
        message: '无效的借款期限，可选期限为：7, 14, 30, 60, 90天'
      });
    }

    // 验证SM2签名
    const user = await userDao.findById(userId);
    if (!user) {
      logger.warning('借款失败：用户不存在', { userId });
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (!user.sm2_public_key) {
      logger.warning('借款失败：用户未提供SM2公钥', { userId });
      return res.status(400).json({
        success: false,
        message: '用户未提供SM2公钥'
      });
    }

    const signatureData = buildSignatureData(
      { userId: String(userId), amount: parseInt(amount), creditProofId: creditProof.id },
      ['amount', 'creditProofId', 'userId']
    );
    const isSignatureValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);

    if (!isSignatureValid) {
      logger.warning('借款失败：无效的SM2签名', { userId });
      return res.status(400).json({
        success: false,
        message: '无效的SM2签名'
      });
    }

    // 验证creditProof格式
    if (!creditProof.id) {
      logger.warning('借款失败：信用证明格式无效', { creditProof });
      return res.status(400).json({
        success: false,
        message: '信用证明格式无效'
      });
    }

    // 验证信用证明和口令
    const matchingProof = await proofDao.findByProofId(creditProof.id);

    if (!matchingProof || new Date(matchingProof.expires_at) <= new Date() || matchingProof.verification_code !== verificationCode) {
      logger.warning('借款失败：信用证明或验证口令无效', {
        proofId: creditProof.id,
        verificationCode
      });
      return res.status(400).json({
        success: false,
        message: '信用证明或验证口令无效'
      });
    }

    // 提前执行风控评估（同时用于挑战阈值、借款限额、冷静期判断）
    const riskAssessment = await assessLoanRisk(
      userId,
      parseInt(amount),
      term,
      creditProof
    );
    const userRisk = riskAssessment.riskScore || 60;

    // 动态挑战阈值
    const dynamicThreshold = dynamicConfig.getChallengeThreshold('borrow', userRisk);
    if (parseInt(amount) >= dynamicThreshold) {
      const { challengeId, challengeSignature } = req.body;

      if (!challengeId || !challengeSignature) {
        const challenge = challengeService.generateChallenge(userId, 'borrow');
        return res.status(200).json({
          success: true,
          requireChallenge: true,
          challengeId: challenge.challengeId,
          challengeCode: challenge.challengeCode,
          message: '大额借款需要二次签名确认'
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

    // 检查借款额度
    const proofData = JSON.parse(matchingProof.proof_data);
    const proofDataCreditScore = proofData.creditScore;
    const loanLimit = await dynamicConfig.getLoanLimit(proofDataCreditScore, userRisk);

    // 计算用户已借未还金额
    const activeLoans = await transactionDao.findByUserId(userId, { type: 'loan', status: 'pending' });
    const totalActiveLoanAmount = activeLoans.reduce((sum, loan) => sum + loan.amount, 0);

    // 计算实际可借额度
    let actualLoanLimit = loanLimit - totalActiveLoanAmount;

    // 动态冷静期
    let isCoolingOff = false;
    let daysSinceRegister = 0;
    if (user.created_at) {
      const registerDate = new Date(user.created_at);
      daysSinceRegister = Math.floor((Date.now() - registerDate) / (24 * 60 * 60 * 1000));

      const coolingOff = dynamicConfig.getCoolingOff(userRisk);
      if (daysSinceRegister < coolingOff.days) {
        const coolingOffTotalLimit = Math.floor(loanLimit * coolingOff.ratio);
        const coolOffRemaining = Math.max(0, coolingOffTotalLimit - totalActiveLoanAmount);
        logger.info('用户处于借款冷静期', {
          userId,
          daysSinceRegister,
          loanLimit,
          coolingOffTotalLimit,
          totalActiveLoanAmount,
          coolOffRemaining
        });
        actualLoanLimit = coolOffRemaining;
        isCoolingOff = true;
      }
    }

    logger.info('借款额度检查', {
      creditScore: proofDataCreditScore,
      requestedAmount: amount,
      loanLimit,
      totalActiveLoanAmount,
      actualLoanLimit
    });

    if (amount > actualLoanLimit) {
      logger.warning('借款失败：借款金额超过限额', {
        requestedAmount: amount,
        loanLimit,
        totalActiveLoanAmount,
        actualLoanLimit,
        creditScore: proofDataCreditScore,
        isCoolingOff
      });
      let errorMessage;
      if (isCoolingOff) {
        const coolingOff = dynamicConfig.getCoolingOff(userRisk);
        errorMessage = `借款金额超过限额，当前处于冷静期（注册后${daysSinceRegister}天，需满${coolingOff.days}天），可借${actualLoanLimit}，已借${totalActiveLoanAmount}`;
      } else {
        errorMessage = `借款金额超过限额，当前信用分${proofDataCreditScore}可借${loanLimit}，已借${totalActiveLoanAmount}，剩余可借${actualLoanLimit}`;
      }
      return res.status(400).json({
        success: false,
        message: errorMessage
      });
    }

    // 验证零知识证明（如果提供）
    if (creditProof.proof && creditProof.publicSignals) {
      try {
        const isProofValid = await verifyProof(creditProof.proof, creditProof.publicSignals);
        if (!isProofValid) {
          logger.error('零知识证明验证失败', { proofId: creditProof.id });
          return res.status(400).json({
            success: false,
            message: '零知识证明验证失败'
          });
        } else {
          logger.info('零知识证明验证成功', { proofId: creditProof.id });
        }
      } catch (error) {
        logger.error('零知识证明验证出错', { proofId: creditProof.id, error: error.message });
        return res.status(400).json({
          success: false,
          message: '零知识证明验证出错'
        });
      }
    } else {
      logger.error('缺少零知识证明或公开信号', { proofId: creditProof.id });
      return res.status(400).json({
        success: false,
        message: '缺少零知识证明或公开信号'
      });
    }

    // 风控评估结果判定
    if (!riskAssessment.success) {
      logger.warning('风险评估拒绝', {
        userId,
        amount,
        loanRiskLevel: riskAssessment.loanRiskLevel,
        loanSuggestion: riskAssessment.loanSuggestion
      });
      return res.status(400).json({
        success: false,
        message: riskAssessment.loanSuggestion || '风险评估未通过',
        loanRiskLevel: riskAssessment.loanRiskLevel,
        loanRiskScore: riskAssessment.loanRiskScore
      });
    }

    logger.info('风险评估通过', {
      userId,
      amount,
      riskLevel: riskAssessment.riskLevel,
      interestRate: riskAssessment.interestRate,
      proofQuality: riskAssessment.proofQuality
    });

    // 调用资金池借款函数（使用事务，传入限额防止 TOCTOU 竞态）
    const borrowResult = await poolService.borrowFromPool(userId, parseInt(amount), term, actualLoanLimit);

    logger.info('借款成功', { userId, transactionId: borrowResult.transaction.id, amount });

    // 计算 SM3 哈希（返回给前端 + 异步上链）
    const borrowData = { ...borrowResult.transaction };
    const borrowHash = blockchainService.generateSM3Hash(borrowData);
    blockchainQueueService.enqueue('storeAuditHash', {
      sm3Hash: borrowHash,
      timestamp: Math.floor(Date.now() / 1000),
      transactionType: 'loan',
      userId: userId.toString()
    }).catch(err => {
      logger.error('借款审计入队失败', { transactionId: borrowResult.transaction.id, error: err.message });
    });

    res.json({
      success: true,
      message: '借款成功',
      transaction: borrowResult.transaction,
      hash: borrowHash
    });
  } catch (error) {
    logger.error('借款失败', { error: error.message, stack: error.stack, userId: req.body.userId });
    res.status(500).json({
      success: false,
      message: '借款失败'
    });
  }
});

// 还款API
router.post('/repay', validate(repaySchema), async (req, res) => {
  try {
    const { userId, transactionId, creditProof, verificationCode, signature, partialAmount } = req.body;
    logger.info('还款请求', { userId, transactionId });

    // 数据隔离检查
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权操作其他用户的还款' });
    }

    // 验证请求参数
    if (!userId || !transactionId || !creditProof || !verificationCode || !signature) {
      logger.warning('还款失败：缺少必要参数', { userId, transactionId, hasCreditProof: !!creditProof, hasVerificationCode: !!verificationCode, hasSignature: !!signature });
      return res.status(400).json({
        success: false,
        message: '缺少必要的参数'
      });
    }

    // 读取用户数据
    const user = await userDao.findById(userId);
    const transaction = await transactionDao.findById(transactionId);

    if (!user || !transaction) {
      logger.warning('还款失败：用户或交易不存在', { userId, transactionId });
      return res.status(404).json({
        success: false,
        message: '用户或交易不存在'
      });
    }

    // 验证SM2签名
    if (!user.sm2_public_key) {
      logger.warning('还款失败：用户未提供SM2公钥', { userId });
      return res.status(400).json({
        success: false,
        message: '用户未提供SM2公钥'
      });
    }

    // 验证creditProof格式
    if (!creditProof.id) {
      logger.warning('还款失败：信用证明格式无效', { creditProof });
      return res.status(400).json({
        success: false,
        message: '信用证明格式无效'
      });
    }

    // 验证信用证明和口令
    const matchingProof = await proofDao.findByProofId(creditProof.id);

    if (!matchingProof || new Date(matchingProof.expires_at) <= new Date() || matchingProof.verification_code !== verificationCode) {
      logger.warning('还款失败：信用证明或验证口令无效', {
        proofId: creditProof.id,
        verificationCode
      });
      return res.status(400).json({
        success: false,
        message: '信用证明或验证口令无效'
      });
    }

    const signatureData = buildSignatureData(
      { userId: String(userId), transactionId, creditProofId: creditProof.id },
      ['creditProofId', 'transactionId', 'userId']
    );
    const isSignatureValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);
    if (!isSignatureValid) {
      logger.warning('还款失败：无效的SM2签名', { userId, transactionId, signatureData });
      return res.status(400).json({
        success: false,
        message: '无效的SM2签名'
      });
    }

    if (transaction.type !== 'loan' || transaction.status !== 'pending') {
      logger.warning('还款失败：无效的还款请求', { transactionId, transactionType: transaction.type, transactionStatus: transaction.status });
      return res.status(400).json({
        success: false,
        message: '无效的还款请求'
      });
    }

    // 计算应还款总额（包括本金和利息）- 按实际天数计息
    const borrowDate = new Date(transaction.created_at);
    const now = new Date();
    const actualDays = Math.max(1, Math.ceil((now - borrowDate) / (24 * 60 * 60 * 1000)));

    const agreedInterest = Number(transaction.interest || 0);
    const principal = Number(transaction.amount);
    const creditScore = user.credit_score || 600;
    const actualInterest = await calculateInterest(principal, actualDays, creditScore, false);

    const dueDate = new Date(transaction.due_date || transaction.dueDate);
    const daysLate = Math.max(0, Math.floor((now - dueDate) / (24 * 60 * 60 * 1000)));

    let finalInterest;
    if (daysLate > 0) {
      finalInterest = agreedInterest + await calculateInterest(principal, daysLate, creditScore, true, daysLate);
    } else {
      finalInterest = Math.min(actualInterest, agreedInterest);
    }

    let totalRepayment = principal + finalInterest;
    totalRepayment = Math.round(totalRepayment * 100) / 100;
    finalInterest = Math.round(finalInterest * 100) / 100;
    
    const actualRepayAmount = partialAmount ? Number(partialAmount) : totalRepayment;
    
    if (actualRepayAmount <= 0) {
      return res.status(400).json({ success: false, message: '还款金额必须大于 0 元' });
    }
    
    if (actualRepayAmount > totalRepayment) {
      return res.status(400).json({ success: false, message: '还款金额不能超过应还总额' });
    }

    if (partialAmount && actualRepayAmount < totalRepayment) {
      let paidInterest = 0;
      let paidPrincipal = 0;
      if (actualRepayAmount >= finalInterest) {
        paidInterest = finalInterest;
        paidPrincipal = actualRepayAmount - finalInterest;
      } else {
        paidInterest = actualRepayAmount;
        paidPrincipal = 0;
      }

      const remainingPrincipal = Math.round((principal - paidPrincipal) * 100) / 100;

      const dueDate = new Date(transaction.due_date || transaction.dueDate);
      const now = new Date();
      const daysRemaining = Math.max(1, Math.ceil((dueDate - now) / (24 * 60 * 60 * 1000)));

      const remainingInterest = await calculateInterest(remainingPrincipal, daysRemaining, creditScore, false);

      const newTotalAmount = Math.round((remainingPrincipal + remainingInterest) * 100) / 100;

      // 如果剩余本金为0，标记交易完成
      const newStatus = remainingPrincipal <= 0 ? 'completed' : 'pending';

      // 在同一个事务内完成：扣余额 + 更新资金池 + 更新贷款记录（保证原子性）
      await poolService.repay(userId, paidPrincipal, paidInterest, {
        transactionId,
        loanUpdateFields: {
          amount: remainingPrincipal,
          interest: remainingInterest,
          total_amount: newTotalAmount,
          status: newStatus
        }
      });

      // 记录部分还款的信用历史
      const partialReason = `部分还款 ¥${actualRepayAmount.toFixed(2)}`;
      creditHistoryDao.create({
        user_id: parseInt(userId),
        score: user.credit_score,
        change_amount: 0,
        reason: partialReason,
        transaction_id: transactionId
      }).catch(err => logger.error('记录部分还款信用历史失败', { error: err.message }));

      logger.info('部分还款成功', {
        userId,
        transactionId,
        paidTotal: actualRepayAmount,
        paidPrincipal,
        paidInterest,
        remainingPrincipal,
        remainingInterest,
        newStatus
      });

      return res.json({
        success: true,
        message: remainingPrincipal <= 0
          ? `还款成功！已还清全部欠款 ¥${actualRepayAmount.toFixed(2)}`
          : `部分还款成功！已还 ¥${actualRepayAmount.toFixed(2)}，剩余本金 ¥${remainingPrincipal.toFixed(2)}，剩余利息 ¥${remainingInterest.toFixed(2)}`,
        paidTotal: actualRepayAmount,
        paidPrincipal,
        paidInterest,
        remainingPrincipal,
        remainingInterest,
        newTotalRepayment: newTotalAmount,
        scoreChange: 0,
        completed: remainingPrincipal <= 0
      });
    }

    // 在同一个事务内完成：扣余额 + 更新资金池 + 标记贷款完成（保证原子性）
    await poolService.repay(userId, principal, finalInterest, {
      transactionId,
      newStatus: 'completed'
    });

    // 更新信用分
    const repaidAt = new Date();
    const creditDaysLate = Math.floor((repaidAt - dueDate) / (24 * 60 * 60 * 1000));

    let scoreChange = CREDIT_RULES.SCORE_CHANGES.ON_TIME_REPAYMENT;
    let reason = '按时还款';

    if (creditDaysLate > 0) {
      if (creditDaysLate <= 7) {
        scoreChange = CREDIT_RULES.SCORE_CHANGES.LATE_REPAYMENT_1;
        reason = '逾期1-7天';
      } else if (creditDaysLate <= 15) {
        scoreChange = CREDIT_RULES.SCORE_CHANGES.LATE_REPAYMENT_2;
        reason = '逾期8-15天';
      } else {
        scoreChange = CREDIT_RULES.SCORE_CHANGES.LATE_REPAYMENT_3;
        reason = '逾期16天以上';
      }
    } else if (creditDaysLate < 0) {
      // 提前还款
      scoreChange = CREDIT_RULES.SCORE_CHANGES.EARLY_REPAYMENT;
      reason = '提前还款';
    }

    // 注意：借款频率惩罚已在借款时通过冷静期/限额机制体现，
    // 还款时不再重复扣分，避免同一笔借款被多次惩罚

    // 使用统一信用分更新
    const newScore = await dynamicConfig.updateCreditScore(userId, scoreChange, reason, transactionId);
    const updatedUser = await userDao.findById(userId);
    const newBalance = updatedUser.balance;

    logger.info('还款成功', {
      userId,
      transactionId,
      newBalance,
      newScore: newScore,
      scoreChange,
      reason
    });

    // 异步上链存证 - 使用 AuditStorage 合约（不阻塞响应）
    const repayTransactionData = {
      transactionId,
      userId,
      amount: transaction.amount,
      interest: transaction.interest || 0,
      totalRepayment: transaction.totalRepayment || transaction.totalRepay,
      repaidAt: new Date().toISOString(),
      status: 'completed',
      scoreChange,
      reason
    };
    
    const repayHash = blockchainService.generateSM3Hash(repayTransactionData);
    blockchainQueueService.enqueue('storeAuditHash', {
      sm3Hash: repayHash,
      timestamp: Math.floor(Date.now() / 1000),
      transactionType: 'repay',
      userId: userId.toString()
    }).catch(err => {
      logger.error('还款审计入队失败', { transactionId, error: err.message });
    });

    res.json({
      success: true,
      message: '还款成功',
      creditScore: newScore,
      scoreChange,
      newBalance,
      hash: repayHash
    });
  } catch (error) {
    logger.error('还款失败', { error: error.message, userId: req.body.userId, transactionId: req.body.transactionId });
    res.status(500).json({
      success: false,
      message: '还款失败'
    });
  }
});

// 获取交易历史API
router.get('/transactions/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    logger.info('获取用户交易历史', { userId });

    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权查看其他用户的交易记录' });
    }

    const userTransactions = await transactionDao.findByUserId(userId);

    logger.info('获取用户交易历史成功', { userId, transactionCount: userTransactions.length });
    res.json({
      success: true,
      transactions: userTransactions
    });
  } catch (error) {
    logger.error('获取交易历史失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({
      success: false,
      message: '获取交易历史失败'
    });
  }
});

// 验证交易哈希API - 区块链存证验证
router.post('/verify-transaction', async (req, res) => {
  try {
    const { transactionId, transactionData } = req.body;
    
    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: '缺少交易ID参数'
      });
    }

    logger.info('验证交易哈希请求', { transactionId });

    // 调用区块链服务验证交易哈希
    const verificationResult = await blockchainService.verifyTransactionHash(
      transactionId,
      transactionData || {}
    );

    if (!verificationResult.success) {
      logger.warning('交易哈希验证失败', { 
        transactionId, 
        error: verificationResult.error 
      });
      return res.status(400).json({
        success: false,
        message: '交易哈希验证失败',
        error: verificationResult.error
      });
    }

    logger.info('交易哈希验证完成', { 
      transactionId, 
      isValid: verificationResult.isValid 
    });

    res.json({
      success: true,
      message: verificationResult.isValid ? '交易验证成功' : '交易验证失败',
      isValid: verificationResult.isValid,
      storedHash: verificationResult.storedHash,
      calculatedHash: verificationResult.calculatedHash,
      timestamp: verificationResult.timestamp,
      transactionType: verificationResult.transactionType,
      userId: verificationResult.userId
    });
  } catch (error) {
    logger.error('验证交易失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '验证交易失败'
    });
  }
});

// 获取区块链服务状态API
router.get('/blockchain-status', async (req, res) => {
  try {
    const status = blockchainService.getStatus();
    const transactionCount = await blockchainService.getTransactionCount();
    
    res.json({
      success: true,
      status: {
        ...status,
        transactionCount
      }
    });
  } catch (error) {
    logger.error('获取区块链状态失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取区块链状态失败'
    });
  }
});

// 动态借款配置查询（用于前端展示）
router.get('/config/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权查看其他用户的配置' });
    }

    const user = await userDao.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    const creditScore = user.credit_score || 600;
    const userRisk = creditScore >= 750 ? 80 : creditScore >= 700 ? 70 : creditScore >= 650 ? 60 : creditScore >= 600 ? 40 : 20;

    const [loanRate, loanLimit, challengeThreshold, coolingOff, activeLoans] = await Promise.all([
      dynamicConfig.getLoanRate(creditScore),
      dynamicConfig.getLoanLimit(creditScore, userRisk),
      Promise.resolve(dynamicConfig.getChallengeThreshold('borrow', userRisk)),
      Promise.resolve(dynamicConfig.getCoolingOff(userRisk)),
      transactionDao.findByUserId(userId, { type: 'loan', status: 'pending' })
    ]);

    const totalActiveLoanAmount = activeLoans.reduce((sum, loan) => sum + loan.amount, 0);

    res.json({
      success: true,
      data: {
        creditScore,
        loanRate: Math.round(loanRate * 100) / 100,
        maxLoanLimit: loanLimit,
        availableLimit: Math.max(0, loanLimit - totalActiveLoanAmount),
        challengeThreshold,
        coolingOff: {
          days: coolingOff.days,
          ratio: coolingOff.ratio
        }
      }
    });
  } catch (error) {
    logger.error('获取借款配置失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({ success: false, message: '获取借款配置失败' });
  }
});

module.exports = router;
