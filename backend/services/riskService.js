const logger = require('../utils/logger');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');

/**
 * 风险评估服务
 * 用于评估用户的信用风险和贷款风险
 */

/**
 * 评估用户信用风险
 * @param {number} userId - 用户ID
 * @returns {Promise<Object>} - 风险评估结果
 */
exports.assessUserRisk = async (userId) => {
  try {
    // 兼容传入 user 对象的情况
    const actualUserId = typeof userId === 'object' ? userId.id : userId;

    // 从数据库获取用户信息
    const user = await userDao.findById(actualUserId);
    if (!user) {
      throw new Error('用户不存在');
    }

    // 从数据库获取用户的交易记录
    const transactions = await transactionDao.findByUserId(actualUserId);

    // 计算风险评分
    let riskScore = 0;

    // 1. 信用评分因素（基础分50，有信用的用户至少有基础分）
    if (user.credit_score && user.credit_score >= 600) {
      // 信用分600-850，对应0-30分
      riskScore += 50 + Math.min(30, ((user.credit_score - 600) / 250) * 30);
    } else if (user.credit_score) {
      // 信用分低于600
      riskScore += Math.max(0, (user.credit_score / 600) * 30);
    }

    // 2. 还款历史因素
    const completedLoans = transactions.filter(t => t.type === 'loan' && t.status === 'completed');
    const defaultedLoans = transactions.filter(t => t.type === 'loan' && t.status === 'default');

    if (completedLoans.length > 0) {
      // 有完成记录加分，有违约记录减分
      const completionRate = completedLoans.length / (completedLoans.length + defaultedLoans.length || 1);
      riskScore += completionRate * 25;
    }
    // 注意：默认不加分也不减分，只有有违约记录时才减分

    // 3. 账户余额因素
    if (user.balance > 0) {
      riskScore += Math.min(15, user.balance / 10000 * 15);
    }

    // 4. 交易频率因素（新用户不扣分）
    const loanFrequency = transactions.filter(t => t.type === 'loan').length;
    if (loanFrequency > 0) {
      riskScore += Math.max(0, Math.min(10, loanFrequency * 1));
    }

    // 5. 交易金额因素（新用户不扣分）
    const totalTransactionAmount = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0);
    const avgTransactionAmount = totalTransactionAmount / (transactions.length || 1);
    if (avgTransactionAmount > 0) {
      riskScore += Math.min(5, avgTransactionAmount / 1000 * 5);
    }

    // 确保风险评分在0-100之间
    riskScore = Math.max(20, Math.min(100, riskScore));

    // 生成风险等级
    let riskLevel;
    if (riskScore >= 80) {
      riskLevel = '低风险';
    } else if (riskScore >= 60) {
      riskLevel = '中低风险';
    } else if (riskScore >= 40) {
      riskLevel = '中风险';
    } else {
      riskLevel = '中等风险'; // 新用户至少是中风险
    }

    return {
      userId: user.id,
      username: user.username,
      creditScore: user.credit_score,
      riskScore: Math.round(riskScore),
      riskLevel: riskLevel,
      success: true, // 始终返回成功
      factors: {
        creditScore: user.credit_score,
        completedLoans: completedLoans.length,
        defaultedLoans: defaultedLoans.length,
        balance: user.balance,
        loanFrequency: loanFrequency,
        totalTransactionAmount: totalTransactionAmount,
        avgTransactionAmount: avgTransactionAmount
      }
    };
  } catch (error) {
    logger.error('评估用户风险失败', { error: error.message, userId });
    throw error;
  }
};

/**
 * 评估贷款风险
 * @param {number} userId - 用户ID
 * @param {number} loanAmount - 贷款金额
 * @param {number} loanDuration - 贷款期限（天）
 * @param {Object} creditProof - 信用证明对象（可选）
 * @returns {Promise<Object>} - 贷款风险评估结果
 */
exports.assessLoanRisk = async (userId, loanAmount, loanDuration, creditProof) => {
  try {
    // 兼容传入 user 对象的情况
    const actualUserId = typeof userId === 'object' ? userId.id : userId;

    // 评估用户风险
    const userRisk = await exports.assessUserRisk(actualUserId);

    // 计算贷款风险评分
    let loanRiskScore = userRisk.riskScore;

    // 获取信用分（优先使用 creditProof 中的）
    const creditScore = creditProof?.creditScore || userRisk.creditScore || 600;

    // 1. 贷款金额与信用分匹配因素（信用分600以上可借1000，每增加50分可多借1000）
    const maxLoanForCredit = creditScore >= 600 ? (creditScore - 600) * 20 + 1000 : 500;
    if (loanAmount <= maxLoanForCredit) {
      loanRiskScore += 10; // 贷款金额在信用分允许范围内，加分
    } else if (loanAmount > maxLoanForCredit * 2) {
      loanRiskScore -= 15; // 贷款金额严重超标，减分
    } else {
      loanRiskScore -= 5; // 贷款金额超标但不严重
    }

    // 2. 贷款期限因素（短期贷款风险低）
    const maxDuration = 365; // 最长贷款期限
    if (loanDuration <= 30) {
      loanRiskScore += 10; // 短期贷款加分
    } else if (loanDuration > 90) {
      loanRiskScore -= 5; // 长期贷款稍微减分
    }

    // 3. 贷款金额绝对大小（小额贷款风险低）
    if (loanAmount <= 1000) {
      loanRiskScore += 10; // 小额贷款加分
    } else if (loanAmount > 50000) {
      loanRiskScore -= 5; // 大额贷款稍微减分
    }

    // 确保风险评分在0-100之间（新用户至少20分）
    loanRiskScore = Math.max(20, Math.min(100, loanRiskScore));

    // 生成贷款风险等级
    let loanRiskLevel;
    if (loanRiskScore >= 70) {
      loanRiskLevel = '低风险';
    } else if (loanRiskScore >= 50) {
      loanRiskLevel = '中风险';
    } else {
      loanRiskLevel = '中等风险'; // 不再轻易拒绝
    }

    // 生成贷款建议
    let loanSuggestion;
    if (loanRiskScore >= 70) {
      loanSuggestion = '建议批准贷款，可给予较低利率';
    } else if (loanRiskScore >= 50) {
      loanSuggestion = '建议批准贷款，可给予中等利率';
    } else {
      // 只有当贷款金额严重超标或信用分过低时才拒绝
      if (loanAmount > maxLoanForCredit * 2 || creditScore < 600) {
        loanSuggestion = '建议拒绝贷款，贷款金额超出信用额度过多';
      } else {
        loanSuggestion = '建议谨慎批准，需要补充材料或提供担保';
      }
    }

    return {
      ...userRisk,
      loanAmount: loanAmount,
      loanDuration: loanDuration,
      creditScore: creditScore,
      loanRiskScore: Math.round(loanRiskScore),
      loanRiskLevel: loanRiskLevel,
      loanSuggestion: loanSuggestion,
      success: !loanSuggestion.startsWith('建议拒绝')
    };
  } catch (error) {
    logger.error('评估贷款风险失败', { error: error.message, userId, loanAmount, loanDuration });
    throw error;
  }
};

/**
 * 监控用户风险
 * @param {number} userId - 用户ID
 * @returns {Promise<Object>} - 风险监控结果
 */
exports.monitorUserRisk = async (userId) => {
  try {
    // 从数据库获取用户信息
    const user = await userDao.findById(userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    
    // 从数据库获取用户的交易记录
    const transactions = await transactionDao.findByUserId(userId);
    
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
    
    // 检测信用评分下降
    if (user.credit_score < 600) {
      anomalies.push({
        type: '信用评分过低',
        score: user.credit_score,
        description: `信用评分 ${user.credit_score} 低于正常水平`
      });
    }
    
    // 生成风险监控报告
    const riskLevel = anomalies.length > 3 ? '高风险' : anomalies.length > 1 ? '中风险' : '低风险';
    
    return {
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
    };
  } catch (error) {
    logger.error('监控用户风险失败', { error: error.message, userId });
    throw error;
  }
};