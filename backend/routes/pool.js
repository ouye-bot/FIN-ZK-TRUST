const express = require('express');
const router = express.Router();
const { getPoolInfo, calculateRedeemable } = require('../services/poolService');
const { getCurrentLendingRate } = require('../services/interestRateService');
const dynamicConfig = require('../services/dynamicConfigService');
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
    
    const totalPool = poolData.totalPool || (poolData.platformCapital + poolData.userCapital);
    const utilizationRate = totalPool > 0 ? (poolData.loanedAmount / totalPool) : 0;
    const userRatio = totalPool > 0 ? (poolData.userCapital / totalPool) : 0;
    const availableRatio = totalPool > 0 ? (poolData.availableAmount / totalPool) : 0;

    const poolHealth = await dynamicConfig.getPoolHealth();

    const responseData = {
      platformCapital: poolData.platformCapital,
      userCapital: poolData.userCapital,
      loanedAmount: poolData.loanedAmount,
      totalPool: totalPool,
      availableAmount: poolData.availableAmount,
      // 利息分层
      platformInterest: poolData.platformInterest || 0,
      userInterest: poolData.userInterest || 0,
      totalInterest: poolData.totalInterest || 0,
      // 健康指标
      health: {
        utilizationRate: Math.round(utilizationRate * 10000) / 100, // 百分比，两位小数
        userRatio: Math.round(userRatio * 10000) / 100,
        availableRatio: Math.round(availableRatio * 10000) / 100,
        overdueRate: Math.round(poolHealth.overdueRate * 10000) / 100,
      },
      // 状态
      status,
      totalInvestors: poolData.totalInvestors,
      // 兼容旧字段
      originalPool: poolData.originalPoolBalance,
      userPool: poolData.userPoolBalance,
      totalAvailable: poolData.totalAvailable,
      userPoolStatus: poolData.userPoolStatus,
      emergencyBorrow: 0
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

    // 获取资金池当前数据
    const pool = await poolDao.getPool();

    // 计算总出资金额
    let investAmount = 0;
    let todayInvestAmount = 0;
    const today = new Date().toISOString().split('T')[0];
    investments.forEach(inv => {
      investAmount += inv.amount || 0;
      const investDate = new Date(inv.created_at).toISOString().split('T')[0];
      if (investDate === today) todayInvestAmount += inv.amount || 0;
    });

    // 使用动态流动性策略计算可赎回金额
    const redeemInfo = calculateRedeemable(investments, pool);

    logger.info('可赎回金额计算完成', {
      userId,
      ...redeemInfo
    });

    return res.json({
      success: true,
      data: {
        userId: userId,
        investAmount,
        todayInvestAmount,
        pendingInterest: 0,
        canRedeemToday: redeemInfo.maxRedeemAmount > 0,
        maxRedeemAmount: redeemInfo.maxRedeemAmount,
        totalAsset: redeemInfo.totalActive,
        totalActiveInvest: redeemInfo.totalActive,
        totalMaturedActiveInvest: redeemInfo.totalMaturedActive,
        poolAvailable: redeemInfo.poolAvailable,
        // 流动性策略信息
        liquidity: {
          ratio: redeemInfo.liquidityRatio,
          tier: redeemInfo.liquidityTier,
          earlyRedeemRatio: redeemInfo.earlyRedeemRatio,
          totalImmaturedActive: redeemInfo.totalImmaturedActive,
          totalEligible: redeemInfo.totalEligible
        }
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