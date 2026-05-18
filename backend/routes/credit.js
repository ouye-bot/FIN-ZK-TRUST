const express = require('express');
const router = express.Router();
const userDao = require('../dao/userDao');
const proofDao = require('../dao/proofDao');
const transactionDao = require('../dao/transactionDao');
const { execute } = require('../config/database');
const logger = require('../utils/logger');
const { generateSM3Hash } = require('../utils/cryptoUtils');
const { verifyProof } = require('../services/zkService');

// 查询用户是否有逾期借款（系统自动判断，非用户自述）
async function checkUserHasOverdue(userId) {
  const rows = await execute(
    "SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ? AND type = 'loan' AND status = 'overdue'",
    [userId]
  );
  return rows[0].cnt > 0;
}

const CREDIT_RULES = {
  MIN_SCORE: 300,
  MAX_SCORE: 850,
  LOAN_LIMITS: {
    600: 1000,
    650: 2000,
    700: 5000,
    750: 10000,
    800: 20000,
    850: 50000
  },
  SCORE_CHANGES: {
    ON_TIME_REPAYMENT: 10,
    EARLY_REPAYMENT: 5,
    INVEST_REWARD: 2,
    FREQUENCY_PENALTY: 5,
    LATE_REPAYMENT_1: -5,
    LATE_REPAYMENT_2: -15,
    LATE_REPAYMENT_3: -30
  },
  INTEREST_RATES: {
    300: 13.8,
    600: 10.0,
    650: 8.0,
    700: 6.0,
    750: 4.0
  },
  COOLING_OFF_DAYS: 7,
  COOLING_OFF_LOAN_RATIO: 0.5
};

const getLoanLimit = (creditScore) => {
  const limits = CREDIT_RULES.LOAN_LIMITS;
  const scores = Object.keys(limits).map(Number).sort((a, b) => b - a);
  for (const s of scores) {
    if (creditScore >= s) return limits[s];
  }
  return 0;
};

const getInterestRate = (creditScore) => {
  const rates = CREDIT_RULES.INTEREST_RATES;
  const scores = Object.keys(rates).map(Number).sort((a, b) => b - a);
  for (const s of scores) {
    if (creditScore >= s) return rates[s];
  }
  return 13.8;
};

// 查询用户逾期状态（供前端生成 ZKP 前调用）
router.get('/overdue-status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const hasOverdue = await checkUserHasOverdue(parseInt(userId));
    res.json({
      success: true,
      data: { hasOverdue, hasNoOverdue: !hasOverdue }
    });
  } catch (error) {
    logger.error('查询逾期状态失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({ success: false, message: '查询逾期状态失败' });
  }
});

// 生成信用证明
// 前端为主通道（端侧生成ZKP），后端只验证和存储
// 后端异步队列 /api/v1/zk/generate-proof 为降级备份
router.post('/generate-proof', async (req, res) => {
  try {
    const { userId, proof, publicSignals, signature } = req.body;

    logger.info('生成信用证明请求', { userId, hasProof: !!proof, hasPublicSignals: !!publicSignals });

    // 系统自动查询用户逾期状态（不信任前端传值）
    const serverHasNoOverdue = !(await checkUserHasOverdue(parseInt(userId)));
    logger.info('用户逾期状态（系统查询）', { userId, hasNoOverdue: serverHasNoOverdue });

    // 验证用户存在
    const user = await userDao.findById(parseInt(userId));

    if (!user) {
      return res.json({
        success: false,
        message: '用户不存在'
      });
    }

    // 如果前端提供了 proof 和 publicSignals，进行端侧ZKP验证
    if (proof && publicSignals) {
      try {
        const isProofValid = await verifyProof(proof, publicSignals);

        if (!isProofValid) {
          logger.warning('端侧零知识证明验证失败', { userId });
          return res.status(400).json({
            success: false,
            message: '零知识证明验证失败'
          });
        }

        logger.info('端侧零知识证明验证通过', { userId });

        // 服务端独立校验逾期状态（不信任 ZKP 中的 hasNoOverdue 输入）
        if (!serverHasNoOverdue) {
          logger.warning('用户有逾期记录，拒绝生成信用证明', { userId });
          return res.status(400).json({
            success: false,
            message: '您当前有逾期借款记录，无法生成信用证明'
          });
        }
      } catch (verifyError) {
        logger.error('ZKP验证异常', { error: verifyError.message, userId });
        return res.status(400).json({
          success: false,
          message: '零知识证明验证失败: ' + verifyError.message
        });
      }
    }

    // 创建包含真实信用评分的数据
    const creditScore = user.credit_score || 600;
    const proofData = JSON.stringify({ creditScore, verified: true, timestamp: Date.now() });

    const sm3Hash = generateSM3Hash(proofData);

    const proofId = `proof_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const verificationCode = `code_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAtDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const expiresAt = expiresAtDate.toISOString().slice(0, 19).replace('T', ' ');

    // 保存信用证明到数据库
    const savedProof = await proofDao.create({
      user_id: user.id,
      proof_id: proofId,
      verification_code: verificationCode,
      sm3_hash: sm3Hash,
      proof_data: proofData,
      expires_at: expiresAt,
      zk_proof: proof ? JSON.stringify(proof) : null,
      public_signals: publicSignals ? JSON.stringify(publicSignals) : null
    });
    logger.info('信用证明生成成功', { userId, proofId, expiresAt: expiresAtDate.toISOString() });

    // 构建 ZKP 标准嵌套结构
    const proofResult = {
      proofId: proofId,
      verificationCode: verificationCode,
      proofData: proofData,
      publicSignals: publicSignals || ['1'],
      expiresAt: expiresAtDate.toISOString(),
      sm3Hash: sm3Hash
    };

    try {
      res.json({
        success: true,
        message: '信用证明生成成功',
        data: {
          proof: proofResult,
          expiresAt: expiresAtDate.toISOString(),
          sm3Hash: sm3Hash
        }
      });
    } catch (err) {
      logger.error('发送响应失败', { error: err.message, stack: err.stack });
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: '生成信用证明失败',
          error: err.message
        });
      }
    }
  } catch (error) {
    logger.error('生成信用证明失败', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: '生成信用证明失败',
      error: error.message
    });
  }
});

// 验证信用证明
router.post('/verify-proof', async (req, res) => {
  try {
    // 支持嵌套结构 (proof.proofId) 和扁平结构 (proofId)
    const proofId = req.body.proof?.proofId || req.body.proofId;
    const verificationCode = req.body.verificationCode || req.body.proof?.verificationCode;

    logger.info('验证信用证明请求', { proofId, verificationCode });

    // 从数据库获取信用证明
    const proof = await proofDao.findByProofId(proofId);

    if (!proof) {
      return res.json({
        success: false,
        message: '信用证明不存在'
      });
    }

    // 检查是否过期
    if (new Date(proof.expires_at) < new Date()) {
      return res.json({
        success: false,
        message: '信用证明已过期'
      });
    }

    // 验证证明

    const isValid = proof.verification_code === verificationCode;

    if (isValid) {
      logger.info('信用证明验证成功', { proofId });

      const responseData = {
        proofId,
        expiresAt: proof.expires_at
      };

      // 如果有存储的 ZKP proof，返回给第三方独立验证
      if (proof.zk_proof && proof.public_signals) {
        responseData.zkProof = JSON.parse(proof.zk_proof);
        responseData.publicSignals = JSON.parse(proof.public_signals);
      }

      res.json({
        success: true,
        message: '信用证明验证成功',
        data: responseData
      });
    } else {
      logger.warn('信用证明验证失败', { proofId });
      res.json({
        success: false,
        message: '信用证明验证失败'
      });
    }
  } catch (error) {
    logger.error('验证信用证明失败', { error: error.message, stack: error.stack });
    res.status(500).json({
      success: false,
      message: '验证信用证明失败',
      error: error.message
    });
  }
});

// 获取用户信用信息
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    logger.info('获取用户信用信息', { userId });
    
    // 从数据库获取用户信息
    const user = await userDao.findById(parseInt(userId));
    if (!user) {
      return res.json({
        success: false,
        message: '用户不存在'
      });
    }
    
    // 从数据库获取用户的信用证明
    const proofs = await proofDao.findByUserId(parseInt(userId));
    
    // 过滤出有效证明并按创建时间降序排列
    const validProofs = proofs
      .filter(proof => new Date(proof.expires_at) > new Date())
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // 获取最新有效证明
    const latestProofData = validProofs.length > 0 ? validProofs[0] : null;
    const latestProof = latestProofData ? {
      id: latestProofData.proof_id,
      verificationCode: latestProofData.verification_code,
      creditScore: user.credit_score,
      expiresAt: latestProofData.expires_at,
      proofData: latestProofData.proof_data,
      sm3Hash: latestProofData.sm3_hash
    } : null;

    logger.info('获取用户信用信息成功', { userId, creditScore: user.credit_score, validProofs: validProofs.length });

    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        creditScore: user.credit_score,
        hasValidProof: validProofs.length > 0,
        lastProofAt: latestProofData ? latestProofData.created_at : null,
        proofExpiresAt: latestProofData ? latestProofData.expires_at : null,
        proof: latestProof
      }
    });
  } catch (error) {
    logger.error('获取用户信用信息失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({
      success: false,
      message: '获取用户信用信息失败',
      error: error.message
    });
  }
});

// 信用评分API
router.get('/score/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    logger.info('获取用户信用评分', { userId });
    
    // 从数据库获取用户信息
    const user = await userDao.findById(parseInt(userId));
    if (!user) {
      return res.json({
        success: false,
        message: '用户不存在'
      });
    }
    
    // 从数据库获取用户的交易记录
    const transactions = await transactionDao.findByUserId(parseInt(userId));
    
    // 计算信用评分
    let score = user.credit_score || 600;
    let history = [];
    
    // 基于交易记录更新信用评分
    transactions.forEach(transaction => {
      if (transaction.type === 'loan' && transaction.status === 'completed') {
        // 按时还款，增加信用分
        score += 10;
        history.push({
          timestamp: transaction.created_at,
          type: 'repayment',
          description: '按时还款',
          scoreChange: 10
        });
      } else if (transaction.type === 'loan' && transaction.status === 'default') {
        // 逾期还款，减少信用分
        score -= 50;
        history.push({
          timestamp: transaction.created_at,
          type: 'default',
          description: '逾期还款',
          scoreChange: -50
        });
      }
    });
    
    // 确保评分在合理范围内
    score = Math.max(CREDIT_RULES.MIN_SCORE, Math.min(CREDIT_RULES.MAX_SCORE, score));
    
    // 更新用户信用评分
    await userDao.updateCreditScore(parseInt(userId), score);
    
    logger.info('获取用户信用评分成功', { userId, score });
    
    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        creditScore: score,
        history: history
      }
    });
  } catch (error) {
    logger.error('获取用户信用评分失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({
      success: false,
      message: '获取用户信用评分失败',
      error: error.message
    });
  }
});

// 信用历史API
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    logger.info('获取用户信用历史', { userId });
    
    // 从数据库获取用户信息
    const user = await userDao.findById(parseInt(userId));
    if (!user) {
      return res.json({
        success: false,
        message: '用户不存在'
      });
    }
    
    // 从数据库获取用户的交易记录
    const transactions = await transactionDao.findByUserId(parseInt(userId));
    
    // 构建信用历史
    const history = [];
    
    transactions.forEach(transaction => {
      if (transaction.type === 'loan') {
        const historyItem = {
          id: transaction.id,
          timestamp: transaction.created_at,
          type: transaction.status === 'completed' ? 'repayment' : 'default',
          description: transaction.status === 'completed' ? '按时还款' : '逾期还款',
          amount: transaction.amount,
          scoreChange: transaction.status === 'completed' ? 10 : -50
        };
        history.push(historyItem);
      }
    });
    
    // 按时间倒序排序
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    
    logger.info('获取用户信用历史成功', { userId, historyCount: history.length });
    
    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        creditScore: user.credit_score,
        history: history
      }
    });
  } catch (error) {
    logger.error('获取信用历史失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({
      success: false,
      message: '获取信用历史失败',
      error: error.message
    });
  }
});

module.exports = router;
module.exports.CREDIT_RULES = CREDIT_RULES;
module.exports.getLoanLimit = getLoanLimit;
module.exports.getInterestRate = getInterestRate;