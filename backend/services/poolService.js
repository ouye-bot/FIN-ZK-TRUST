const poolDao = require('../dao/poolDao');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const { transaction } = require('../config/database');
const logger = require('../utils/logger');
const crypto = require('crypto');
const { generateSM3Hash } = require('../utils/cryptoUtils');
const { getInterestRate } = require('../routes/credit');
const { getCurrentLendingRate } = require('./interestRateService');

// 生成日志ID
const generateLogId = () => {
  return crypto.randomBytes(8).toString('hex');
};

// 生成操作哈希（使用SM3算法）
const generateOperationHash = (data) => {
  const stringData = JSON.stringify(data);
  return generateSM3Hash(stringData);
};

// 计算利息 - 基于信用评分的差异化利率
const calculateInterest = (principal, days, creditScore, isOverdue = false) => {
  const annualRate = getInterestRate(creditScore) / 100;
  const dailyRate = annualRate / 365;
  const rate = isOverdue ? dailyRate * 2 : dailyRate;
  return Math.round(principal * rate * days * 100) / 100;
};

// 计算并分配利息
exports.calculateAndDistributeInterest = async () => {
  try {
    // 获取资金池信息
    const pool = await poolDao.getPool();
    
    // 计算当日利息
    const today = new Date().toISOString().split('T')[0];
    let totalInterest = 0;
    
    // 这里简化处理，实际项目中可能需要更复杂的投资者利息分配逻辑
    // 由于我们的数据库设计中没有投资者表，这里暂时跳过具体的利息分配
    // 只更新资金池的总余额和总利息
    
    // 假设日利率为0.05%，计算当日利息
    totalInterest = pool.total_amount * 0.0005;
    
    // 更新资金池总利息和总余额
    const newTotalAmount = pool.total_amount + totalInterest;
    const newAvailableAmount = pool.available_amount + totalInterest;
    
    // 保存更新后的数据
    await poolDao.updatePool({
      total_amount: newTotalAmount,
      available_amount: newAvailableAmount,
      reserved_amount: pool.reserved_amount
    });
    
    logger.info(`利息分配完成，总利息 ${totalInterest} 元`);
    
    return true;
  } catch (error) {
    logger.error('利息分配失败:', error);
    throw error;
  }
};

// 初始化资金池
exports.initializePool = async () => {
  try {
    // 获取当前资金池数据
    const pool = await poolDao.getPool();
    
    // 检查资金池是否已初始化
    if (pool && (pool.available_amount > 0 || pool.total_amount > 0)) {
      // 资金池已存在且有余额，跳过初始化
      logger.info('资金池已存在，跳过初始化', {
        total_amount: pool.total_amount,
        available_amount: pool.available_amount,
        reserved_amount: pool.reserved_amount
      });
      return true;
    }
    
    // 资金池未初始化，设置初始金额为10000（新模型）
    await poolDao.updatePoolV2({
      platform_capital: 10000,
      user_capital: 0,
      loaned_amount: 0
    });
    logger.info('资金池初始化成功');
    return true;
  } catch (error) {
    logger.error('资金池初始化失败', { error: error.message });
    return false;
  }
};

// 获取资金池整体信息
exports.getPoolInfo = async () => {
  try {
    const pool = await poolDao.getPool();
    
    // 确保余额不为负数
    const safeTotalAmount = Math.max(0, pool.total_amount || 0);
    const safeAvailableAmount = Math.max(0, pool.available_amount || 0);
    const safePlatformCapital = Math.max(0, pool.platform_capital || 0);
    const safeUserCapital = Math.max(0, pool.user_capital || 0);
    const safeLoanedAmount = Math.max(0, pool.loaned_amount || 0);
    
    // 检查资金池状态
    const poolStatus = safeAvailableAmount < 0 ? 'abnormal' : 'normal';
    
    // 如果检测到异常，记录日志
    if (poolStatus === 'abnormal') {
      logger.warn('检测到资金池异常状态（负余额），当前值:', safeAvailableAmount);
    }
    
    // 记录资金池状态信息（新模型字段）
    logger.info(`资金池状态: 总金额=${safeTotalAmount}, 可用金额=${safeAvailableAmount}, 平台资本=${safePlatformCapital}, 用户资本=${safeUserCapital}, 已借出=${safeLoanedAmount}, 状态=${poolStatus}`);
    
    return {
      platformCapital: pool.platform_capital,
      userCapital: pool.user_capital,
      loanedAmount: pool.loaned_amount,
      totalPool: pool.total_amount,
      availableAmount: pool.available_amount,
      originalPoolBalance: pool.platform_capital,
      userPoolBalance: pool.user_capital,
      totalBalance: pool.total_amount,
      totalAvailable: pool.available_amount,
      userPoolStatus: poolStatus,
      emergencyBorrow: 0,
      totalInterest: pool.total_interest_earned || 0,
      totalInvestors: 0
    };
  } catch (error) {
    logger.error('获取资金池信息失败:', error);
    throw error;
  }
};

// 修复用户资金池负余额
exports.fixUserPoolNegativeBalance = async () => {
  try {
    const pool = await poolDao.getPool();
    
    // 检查资金池是否为负
    if (pool.available_amount < 0) {
      const negativeAmount = Math.abs(pool.available_amount);
      logger.info(`检测到资金池负余额，正在修复: ${negativeAmount}元`);
      
      // 将负余额部分转移为reserved金额
      await poolDao.updatePool({
        total_amount: pool.total_amount,
        available_amount: 0,
        reserved_amount: pool.reserved_amount + negativeAmount
      });
      
      logger.info('资金池负余额修复成功');
    }
  } catch (error) {
    logger.error('修复资金池负余额失败:', error);
  }
};

// 定期检查资金池一致性
exports.checkPoolConsistency = async () => {
  try {
    logger.info('开始执行资金池一致性检查');
    
    // 检查并修复资金池负余额
    await exports.fixUserPoolNegativeBalance();
    
    // 检查资金池是否存在
    const pool = await poolDao.getPool();
    if (!pool) {
      logger.warn('资金池数据不存在，正在重新初始化');
      await exports.initializePool();
      return;
    }
    
    logger.info('资金池一致性检查完成');
  } catch (error) {
    logger.error('资金池一致性检查失败:', error);
  }
};

// 执行出资操作
exports.invest = async (userId, amount) => {
  try {
    // 确保userId是字符串类型
    userId = userId.toString();
    
    // 业务规则校验
    if (!userId || !amount) {
      throw new Error('缺少必要参数');
    }
    
    if (amount < 100) {
      throw new Error('出资金额必须大于等于100元');
    }
    
    if (amount > 100000) {
      throw new Error('单次出资金额不能超过10万元');
    }
    
    // 读取用户数据，验证用户状态和信用评分
    const user = await userDao.findById(userId);
    
    if (!user) {
      throw new Error('用户不存在');
    }
    
    if (user.credit_score < 600) {
      throw new Error('信用分低于600，无法出资');
    }
    
    if (user.balance < amount) {
      throw new Error('余额不足');
    }
    
    // 获取资金池信息
    const pool = await poolDao.getPool();
    
    // 更新资金池（新模型：仅增加 user_capital）和用户余额，在同一事务中执行
    await transaction(async (connection) => {
      await poolDao.updatePoolV2({
        platform_capital: pool.platform_capital,
        user_capital: (pool.user_capital || 0) + amount,
        loaned_amount: pool.loaned_amount || 0
      });
      await userDao.updateBalance(userId, user.balance - amount);
    });
    
    logger.info(`用户 ${userId} 出资 ${amount} 元成功，信用分 ${user.credit_score}`);
    
    return true;
  } catch (error) {
    logger.error('出资操作失败:', { error: error.message, userId, amount });
    throw error;
  }
};

// 执行赎回操作
exports.redeem = async (userId, amount, investmentId = null) => {
  try {
    userId = userId.toString();
    
    if (!userId || !amount) {
      throw new Error('缺少必要参数');
    }
    
    if (amount < 100) {
      throw new Error('赎回金额必须大于等于100元');
    }
    
    if (amount > 50000) {
      throw new Error('单次赎回金额不能超过5万元');
    }
    
    const user = await userDao.findById(userId);
    
    if (!user) {
      throw new Error('用户不存在');
    }
    
    let dynamicInterest = 0;
    
    if (investmentId) {
      const investment = await transactionDao.findById(investmentId);
      if (investment && investment.type === 'invest' && investment.status === 'active') {
        const investDays = Math.max(1, Math.ceil((new Date() - new Date(investment.created_at)) / (24 * 60 * 60 * 1000)));
        const annualRate = await getCurrentLendingRate();
        const dailyRate = annualRate / 365;
        dynamicInterest = Math.round(Number(investment.amount) * dailyRate * investDays * 100) / 100;
        
        const newTotalAmount = Math.round((Number(investment.amount) + dynamicInterest) * 100) / 100;
        
        await transactionDao.update(investmentId, {
          interest: dynamicInterest,
          total_amount: newTotalAmount,
          status: 'completed'
        });
        
        logger.info('投资记录收益已更新', {
          investmentId,
          principal: investment.amount,
          dynamicInterest,
          newTotalAmount
        });
      }
    }
    
    const pool = await poolDao.getPool();
    
    if (amount > pool.available_amount) {
      throw new Error(`可赎回金额不足，当前可赎回 ${pool.available_amount} 元`);
    }
    
    await transaction(async (connection) => {
      await poolDao.updatePoolV2({
        platform_capital: pool.platform_capital,
        user_capital: (pool.user_capital || 0) - amount,
        loaned_amount: pool.loaned_amount || 0
      });
      await userDao.updateBalance(userId, user.balance + amount);
    });
    
    logger.info(`用户 ${userId} 赎回 ${amount} 元成功`, { dynamicInterest });
    
    return true;
  } catch (error) {
    logger.error('赎回操作失败:', { error: error.message, userId, amount });
    throw error;
  }
};

// 从资金池借款
exports.borrowFromPool = async (userId, amount, duration = 30) => {
  try {
    // 确保userId是字符串类型
    userId = userId.toString();
    
    // 业务规则校验
    if (!userId || !amount) {
      throw new Error('缺少必要参数');
    }
    
    if (amount < 100) {
      throw new Error('借款金额必须大于等于100元');
    }
    
    if (amount > 50000) {
      throw new Error('单次借款金额不能超过5万元');
    }
    
    // 读取用户数据
    const user = await userDao.findById(userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    
    // 验证用户信用评分
    if (user.credit_score < 600) {
      throw new Error('信用分低于600，无法借款');
    }
    
    // 计算利息和应还总额
    const interest = calculateInterest(amount, duration, user.credit_score);
    const totalRepay = amount + interest;
    
    // 计算到期日期
    const dueDate = new Date(Date.now() + duration * 24 * 60 * 60 * 1000);
    
    // 获取资金池信息
    const pool = await poolDao.getPool();
    
    // 检查资金池余额
    if (amount > pool.available_amount) {
      throw new Error('资金池余额不足');
    }
    
    // 执行事务
    const result = await transaction(async (connection) => {
      // 1. 更新资金池（新模型：仅增加 loaned_amount）
      await poolDao.updatePoolV2({
        platform_capital: pool.platform_capital,
        user_capital: pool.user_capital || 0,
        loaned_amount: (pool.loaned_amount || 0) + amount
      });
      
      // 2. 更新用户余额
      await userDao.updateBalance(userId, user.balance + amount);
      
      // 3. 创建交易记录
      const newTransaction = await transactionDao.create({
        user_id: parseInt(userId),
        type: 'loan',
        amount: amount,
        interest: interest,
        total_amount: totalRepay,
        status: 'pending',
        due_date: dueDate
      });
      
      return newTransaction;
    });
    
    logger.info('借款操作成功', { userId, amount, interest, totalRepay, duration });
    return {
      success: true,
      message: '借款成功',
      transaction: result
    };
  } catch (error) {
    logger.error('借款操作失败:', { error: error.message, userId, amount });
    throw error;
  }
};

// 执行借款操作（旧版，保留兼容）
exports.borrow = async (userId, amount, interestRate, duration) => {
  return await exports.borrowFromPool(userId, amount, duration);
};

// 执行还款操作
exports.repay = async (userId, amount, interest) => {
  try {
    // 确保userId是字符串类型
    userId = userId.toString();
    
    // 业务规则校验
    if (!userId || !amount || !interest) {
      throw new Error('缺少必要参数');
    }
    
    if (amount < 0 || interest < 0) {
      throw new Error('金额不能为负数');
    }
    
    // 读取用户数据
    const user = await userDao.findById(userId);
    if (!user) {
      throw new Error('用户不存在');
    }
    
    // 验证用户余额
    const totalRepayment = amount + interest;
    if (user.balance < totalRepayment) {
      throw new Error('余额不足');
    }
    
    // 获取资金池信息
    const pool = await poolDao.getPool();
    
    // 利息独立记录
    const oldInterestEarned = pool.total_interest_earned || 0;
    const newInterestEarned = oldInterestEarned + interest;
    
    // 执行事务
    await transaction(async (connection) => {
      // 1. 更新资金池（新模型：减少 loaned_amount，增加 total_interest_earned）
      await poolDao.updatePoolV2({
        platform_capital: pool.platform_capital,
        user_capital: pool.user_capital || 0,
        loaned_amount: (pool.loaned_amount || 0) - amount,
        total_interest_earned: newInterestEarned
      });
      
      // 2. 更新用户余额
      await userDao.updateBalance(userId, user.balance - totalRepayment);
    });
    
    logger.info('利息已独立记录', {
      interest,
      totalInterestEarned: newInterestEarned
    });
    
    logger.info('还款操作成功', {
      userId,
      totalRepayment,
      principal: amount,
      interest,
      userBalanceAfter: user.balance - totalRepayment,
      totalInterestEarned: newInterestEarned
    });
    
    return true;
  } catch (error) {
    logger.error('还款操作失败:', { error: error.message, userId, amount, interest });
    throw error;
  }
};