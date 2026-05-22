const express = require('express');
const router = express.Router();
const { execute } = require('../config/database');
const zkQueue = require('../services/zkQueue');
const blockchainService = require('../services/blockchainService');
const logger = require('../utils/logger');

router.get('/detailed', async (req, res) => {
  const health = {
    timestamp: new Date().toISOString(),
    status: 'ok',
    components: {}
  };

  try {
    const dbResult = await execute('SELECT 1 AS test');
    health.components.database = {
      status: 'healthy',
      detail: dbResult ? 'Connection OK' : 'Unexpected empty result'
    };
  } catch (dbError) {
    logger.error('Health check: database failure', { error: dbError.message });
    health.components.database = {
      status: 'unhealthy',
      detail: process.env.NODE_ENV === 'production' ? 'Connection failed' : dbError.message
    };
    health.status = 'degraded';
  }

  try {
    const queueStats = zkQueue.getStats();
    health.components.zkQueue = {
      status: 'healthy',
      queued: queueStats.queued,
      processing: queueStats.processing,
      completed: queueStats.completed,
      failed: queueStats.failed
    };
  } catch (queueError) {
    logger.error('Health check: zkQueue failure', { error: queueError.message });
    health.components.zkQueue = {
      status: 'unhealthy',
      detail: 'Failed to retrieve queue status'
    };
    health.status = 'degraded';
  }

  const sm4Key = process.env.SM4_MASTER_KEY;
  health.components.sm4 = {
    status: sm4Key ? 'healthy' : 'unhealthy',
    loaded: !!sm4Key
  };
  if (!sm4Key) {
    health.status = 'degraded';
  }

  try {
    const blockchainStatus = blockchainService.getStatus();
    health.components.blockchain = {
      status: blockchainStatus.isInitialized ? 'healthy' : 'degraded',
      network: blockchainStatus.networkName || 'unknown',
      initialized: blockchainStatus.isInitialized,
      contracts: blockchainStatus.contracts
    };
    if (!blockchainStatus.isInitialized) {
      health.status = 'degraded';
    }
  } catch (bcError) {
    health.components.blockchain = {
      status: 'unhealthy',
      detail: bcError.message
    };
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

router.post('/csp-report', (req, res) => {
  logger.warning('[CSP] Violation Report', { report: req.body });
  res.status(204).end();
});

module.exports = router;
