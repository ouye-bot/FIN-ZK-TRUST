const express = require('express');
const router = express.Router();
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const logger = require('../utils/logger');

// 风险评估API
router.post('/assess', async (req, res) => {
  try {
    const { userId, loanAmount, loanDuration } = req.body;
    
    logger.info('风险评估请求', { userId, loanAmount, loanDuration });
    
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
    
    // 计算风险评分
    let riskScore = 0;
    
    // 1. 信用评分因素
    if (user.credit_score) {
      riskScore += Math.max(0, (user.credit_score - 600) / 250) * 30;
    }
    
    // 2. 还款历史因素
    const completedLoans = transactions.filter(t => t.type === 'loan' && t.status === 'completed');
    const defaultedLoans = transactions.filter(t => t.type === 'loan' && t.status === 'default');
    
    if (completedLoans.length > 0) {
      riskScore += (completedLoans.length / (completedLoans.length + defaultedLoans.length || 1)) * 25;
    }
    
    // 3. 贷款金额因素（相对于用户余额）
    if (user.balance > 0) {
      const loanToBalanceRatio = loanAmount / user.balance;
      riskScore += Math.max(0, 1 - loanToBalanceRatio) * 20;
    }
    
    // 4. 贷款期限因素
    const maxDuration = 365; // 最长贷款期限
    riskScore += (1 - loanDuration / maxDuration) * 15;
    
    // 5. 历史贷款频率
    const loanFrequency = transactions.filter(t => t.type === 'loan').length;
    if (loanFrequency > 0) {
      riskScore += Math.max(0, 1 - loanFrequency / 10) * 10;
    }
    
    // 确保风险评分在0-100之间
    riskScore = Math.max(0, Math.min(100, riskScore));
    
    // 生成风险等级
    let riskLevel;
    if (riskScore >= 80) {
      riskLevel = '低风险';
    } else if (riskScore >= 60) {
      riskLevel = '中低风险';
    } else if (riskScore >= 40) {
      riskLevel = '中风险';
    } else if (riskScore >= 20) {
      riskLevel = '中高风险';
    } else {
      riskLevel = '高风险';
    }
    
    // 生成风险评估建议
    let suggestion;
    if (riskScore >= 80) {
      suggestion = '建议批准贷款，可给予较低利率';
    } else if (riskScore >= 60) {
      suggestion = '建议批准贷款，可给予中等利率';
    } else if (riskScore >= 40) {
      suggestion = '建议谨慎批准，可给予较高利率并缩短贷款期限';
    } else if (riskScore >= 20) {
      suggestion = '建议拒绝贷款或要求提供担保';
    } else {
      suggestion = '强烈建议拒绝贷款';
    }
    
    logger.info('风险评估完成', { userId, riskScore, riskLevel });
    
    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        creditScore: user.credit_score,
        riskScore: Math.round(riskScore),
        riskLevel: riskLevel,
        suggestion: suggestion,
        factors: {
          creditScore: user.credit_score,
          completedLoans: completedLoans.length,
          defaultedLoans: defaultedLoans.length,
          balance: user.balance,
          loanAmount: loanAmount,
          loanDuration: loanDuration,
          loanFrequency: loanFrequency
        }
      }
    });
  } catch (error) {
    logger.error('风险评估失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '风险评估失败',
      error: error.message
    });
  }
});

// 风险监控API
router.get('/monitor/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    logger.info('风险监控请求', { userId });
    
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
    
    // 分析交易模式
    const recentTransactions = transactions.filter(t => {
      const txDate = new Date(t.created_at);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return txDate > thirtyDaysAgo;
    });
    
    // 计算异常指标
    const totalRecentAmount = recentTransactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const avgTransactionAmount = totalRecentAmount / (recentTransactions.length || 1);
    const transactionFrequency = recentTransactions.length;
    
    // 检测异常
    const anomalies = [];
    
    // 检测大额交易
    recentTransactions.forEach(tx => {
      if (tx.amount > avgTransactionAmount * 3) {
        anomalies.push({
          type: '大额交易',
          amount: tx.amount,
          timestamp: tx.created_at,
          description: `交易金额 ${tx.amount} 超过平均交易金额的3倍`
        });
      }
    });
    
    // 检测交易频率异常
    if (transactionFrequency > 10) {
      anomalies.push({
        type: '交易频率异常',
        frequency: transactionFrequency,
        description: '30天内交易次数超过10次'
      });
    }
    
    // 检测贷款违约
    const defaultedLoans = transactions.filter(t => t.type === 'loan' && t.status === 'default');
    if (defaultedLoans.length > 0) {
      anomalies.push({
        type: '贷款违约',
        count: defaultedLoans.length,
        description: `存在 ${defaultedLoans.length} 笔违约贷款`
      });
    }
    
    // 生成风险监控报告
    const riskLevel = anomalies.length > 3 ? '高风险' : anomalies.length > 1 ? '中风险' : '低风险';
    
    logger.info('风险监控完成', { userId, anomalies: anomalies.length, riskLevel });
    
    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        creditScore: user.credit_score,
        riskLevel: riskLevel,
        transactionStats: {
          totalRecentAmount: totalRecentAmount,
          avgTransactionAmount: avgTransactionAmount,
          transactionFrequency: transactionFrequency,
          totalTransactions: transactions.length
        },
        anomalies: anomalies
      }
    });
  } catch (error) {
    logger.error('风险监控失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '风险监控失败',
      error: error.message
    });
  }
});

module.exports = router;