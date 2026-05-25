const express = require('express');
const cryptoLogger = require('../services/cryptoLogger');
const logger = require('../utils/logger');

const router = express.Router();

// GET /api/v1/audit/verify
router.get('/verify', async (req, res) => {
  try {
    const result = await cryptoLogger.verifyChain();
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Error verifying audit chain:', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to verify audit chain' });
  }
});

// GET /api/v1/audit/entries?limit=20&offset=0
router.get('/entries', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;
    
    const { logs, total } = await cryptoLogger.getLogs({ limit, offset });
    
    // 移除敏感信息，只返回关键字段
    const sanitizedLogs = logs.map(log => ({
      id: log.id,
      index: log.index,
      userId: log.userId,
      operationType: log.operationType,
      description: log.description,
      timestamp: log.timestamp,
      currentHash: log.currentHash,
      prevHash: log.prevHash
    }));
    
    res.status(200).json({ success: true, logs: sanitizedLogs, total });
  } catch (error) {
    logger.error('Error getting audit entries:', { error: error.message });
    res.status(500).json({ success: false, message: 'Failed to get audit entries' });
  }
});

module.exports = router;