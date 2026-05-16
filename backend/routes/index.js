const express = require('express');
const authRoutes = require('./auth');
const userRoutes = require('./user');
const creditRoutes = require('./credit');
const loanRoutes = require('./loan');
const investRoutes = require('./invest');
const redeemRoutes = require('./redeem');
const poolRoutes = require('./pool');
const riskRoutes = require('./risk');
const zkRoutes = require('./zk');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * 注册所有路由
 */
function registerRoutes() {
  // 认证路由已在app.js中单独挂载
  
  // 用户路由
  router.use('/user', userRoutes);
  
  // 信用证明路由
  router.use('/credit', creditRoutes.router);
  
  // 贷款路由
  router.use('/loan', loanRoutes);
  
  // 投资路由
  router.use('/invest', investRoutes);
  
  // 赎回路由
  router.use('/redeem', redeemRoutes);
  
  // 资金池路由
  router.use('/pool', poolRoutes);
  
  // 风险评估路由
  router.use('/risk', riskRoutes);
  
  // 零知识证明路由
  router.use('/zk', zkRoutes);
  
  // 健康检查
  router.get('/health', (req, res) => {
    res.json({
      success: true,
      message: 'Service is healthy',
      timestamp: new Date().toISOString()
    });
  });
  
  // 根路径
  router.get('/', (req, res) => {
    res.json({
      success: true,
      message: 'Welcome to Fin-ZK-Trust API',
      version: '1.0.0',
      endpoints: {
        auth: '/api/v1/auth/*',
        user: '/api/v1/user/*',
        credit: '/api/v1/credit/*',
        loan: '/api/v1/loan/*',
        invest: '/api/v1/invest/*',
        redeem: '/api/v1/redeem/*',
        pool: '/api/v1/pool/*',
        risk: '/api/v1/risk/*',
        zk: '/api/v1/zk/*',
        health: '/api/v1/health'
      }
    });
  });
  
  logger.info('All routes registered successfully');
}

// 注册路由
registerRoutes();

module.exports = router;
