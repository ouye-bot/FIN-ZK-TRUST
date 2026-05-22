const express = require('express');
const cryptoLogger = require('../services/cryptoLogger');
const logger = require('../utils/logger');

const router = express.Router();

// POST /api/v1/crypto-log (需要认证)
router.post('/', async (req, res) => {
  // 要求认证
  if (!req.user || !req.user.id) {
    return res.status(401).json({ success: false, message: '未认证' });
  }
  // 数据隔离：只能为自己记录日志
  const reqUserId = req.body.userId;
  if (reqUserId && parseInt(reqUserId) !== req.user.id) {
    return res.status(403).json({ success: false, message: '无权为其他用户记录日志' });
  }
  try {
    const { userId, operationType, description, data } = req.body;
    
    if (!userId || !operationType || !description) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    const id = await cryptoLogger.logOperation(userId, operationType, description, data);
    
    res.status(200).json({ success: true, id });
  } catch (error) {
    logger.error('Error logging crypto operation', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to log crypto operation' });
  }
});

// GET /api/v1/crypto-log?limit=50&offset=0
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    // 强制使用当前认证用户的ID，防止跨用户数据访问
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    const { logs, total } = await cryptoLogger.getLogs({ limit, offset, userId });

    res.status(200).json({ success: true, data: { logs, total } });
  } catch (error) {
    logger.error('Error getting crypto logs', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get crypto logs' });
  }
});

module.exports = router;