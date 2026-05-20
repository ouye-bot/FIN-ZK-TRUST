const express = require('express');
const cryptoLogger = require('../services/cryptoLogger');

const router = express.Router();

// POST /api/v1/crypto-log
router.post('/', async (req, res) => {
  try {
    const { userId, operationType, description, data } = req.body;
    
    if (!userId || !operationType || !description) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    
    const id = await cryptoLogger.logOperation(userId, operationType, description, data);
    
    res.status(200).json({ success: true, id });
  } catch (error) {
    console.error('Error logging crypto operation:', error);
    res.status(500).json({ success: false, message: 'Failed to log crypto operation' });
  }
});

// GET /api/v1/crypto-log?limit=50&offset=0&userId=xxx
router.get('/', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const userId = req.query.userId;
    
    const { logs, total } = await cryptoLogger.getLogs({ limit, offset, userId });
    
    res.status(200).json({ success: true, data: { logs, total } });
  } catch (error) {
    console.error('Error getting crypto logs:', error);
    res.status(500).json({ success: false, message: 'Failed to get crypto logs' });
  }
});

module.exports = router;