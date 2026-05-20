const express = require('express');
const router = express.Router();
const { getPoolInfo } = require('../services/poolService');
const transactionDao = require('../dao/transactionDao');
const poolDao = require('../dao/poolDao');
const logger = require('../utils/logger');

/**
 * @swagger
 * /pool:
 *   get:
 *     summary: 获取资金池信息
 *     tags: [资金池]
 *     responses:
 *       200:
 *         description: 资金池信息
 * /pool/my-invest/{userId}:
 *   get:
 *     summary: 获取用户个人出资信息
 *     tags: [资金池]
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
 *         description: 用户出资信息
 */

// 获取资金池信息
router.get('/', async (req, res) => {
  try {
    // 使用资金池服务获取资金池信息
    const poolData = await getPoolInfo();
    
    // 确定资金池状态
    let status = 'normal';
    if (poolData.totalBalance < 10000) {
      status = 'critical';
    } else if (poolData.totalBalance < 50000) {
      status = 'warning';
    }
    
    const responseData = {
      platformCapital: poolData.platformCapital,
      userCapital: poolData.userCapital,
      loanedAmount: poolData.loanedAmount,
      totalPool: poolData.totalPool,
      availableAmount: poolData.availableAmount,
      // 以下保留旧字段兼容（前端适配后将逐步弃用）
      originalPool: poolData.originalPoolBalance,
      userPool: poolData.userPoolBalance,
      totalAvailable: poolData.totalAvailable,
      status,
      userPoolStatus: poolData.userPoolStatus,
      totalInvestors: poolData.totalInvestors,
      emergencyBorrow: poolData.emergencyBorrow,
      totalInterest: poolData.totalInterest
    };
    
    logger.info('获取资金池信息成功', responseData);
    res.json({
      success: true,
      pool: responseData
    });
  } catch (error) {
    logger.error('获取资金池信息失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取资金池信息失败'
    });
  }
});

// 获取用户个人出资信息
router.get('/my-invest/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    logger.info('获取用户个人出资信息', { userId });

    // 数据隔离检查
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权查看其他用户的投资详情' });
    }

    // 从数据库获取用户的投资记录
    const investments = await transactionDao.findByUserId(parseInt(userId), { type: 'invest' });
    
    // 获取资金池当前可用余额
    const pool = await poolDao.getPool();
    const poolAvailable = Number(pool.available_amount || 0);
    
    // 计算总出资金额和有效可赎回金额
    let investAmount = 0;
    let todayInvestAmount = 0;
    let totalActiveInvestAmount = 0;
    
    const today = new Date().toISOString().split('T')[0];
    
    investments.forEach(investment => {
      investAmount += investment.amount || 0;
      
      // 检查是否是今天的投资
      const investDate = new Date(investment.created_at).toISOString().split('T')[0];
      if (investDate === today) {
        todayInvestAmount += investment.amount || 0;
      }
      
      // 只计算状态为 active 的记录作为可赎回金额
      if (investment.status === 'active') {
        totalActiveInvestAmount += investment.amount || 0;
      }
    });
    
    // 精确可赎回金额 = min(用户出资总额, 资金池当前可用余额)
    const exactRedeemableAmount = Math.min(totalActiveInvestAmount, poolAvailable);
    
    logger.info('精确可赎回金额计算完成', {
      userId,
      totalActiveInvest: totalActiveInvestAmount,
      poolAvailable: poolAvailable,
      exactRedeemableAmount: exactRedeemableAmount,
      borrowedAmount: Math.max(0, totalActiveInvestAmount - poolAvailable)
    });
    
    return res.json({
      success: true,
      data: {
        userId: userId,
        investAmount: investAmount,
        todayInvestAmount: todayInvestAmount,
        pendingInterest: 0, // 简化处理，暂时返回0
        canRedeemToday: true,
        maxRedeemAmount: exactRedeemableAmount,
        totalAsset: exactRedeemableAmount,
        totalActiveInvest: totalActiveInvestAmount,
        poolAvailable: poolAvailable
      }
    });
  } catch (error) {
    console.error('Error getting user invest info:', error);
    res.status(500).json({
      success: false,
      message: '获取投资信息失败'
    });
  }
});

module.exports = router;