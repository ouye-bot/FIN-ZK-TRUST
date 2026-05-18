/**
 * 区块链查询/验证 API
 * 挂载路径: /api/v1/blockchain/
 */
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

let blockchainService;
try {
  blockchainService = require('../services/blockchainService');
} catch (e) {
  logger.warning('区块链服务加载失败', { error: e.message });
}

// 中间件：检查区块链服务是否可用
function requireBlockchain(req, res, next) {
  if (!blockchainService) {
    return res.status(503).json({ success: false, message: '区块链服务未加载' });
  }
  next();
}

/**
 * GET /api/v1/blockchain/explorer
 * 浏览器概览数据：总记录数、最近记录、类型统计
 */
router.get('/explorer', requireBlockchain, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const data = await blockchainService.getExplorerData(limit);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('区块链浏览器查询失败', { error: error.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /api/v1/blockchain/records
 * 分页查询链上记录
 * 参数: page (默认1), pageSize (默认20, 最大100), type (可选), userId (可选)
 */
router.get('/records', requireBlockchain, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 20, 1), 100);
    const typeFilter = req.query.type || null;
    const userIdFilter = req.query.userId || null;

    const totalRecords = await blockchainService.getTransactionCount();
    const totalPages = Math.ceil(totalRecords / pageSize);

    const records = [];
    for (let i = 0; i < totalRecords; i++) {
      const record = await blockchainService.getRecordByIndex(i);
      if (!record) continue;
      if (typeFilter && record.operationType !== typeFilter) continue;
      if (userIdFilter && record.userId !== userIdFilter) continue;
      records.push({ index: i, ...record });
    }

    const startIdx = (page - 1) * pageSize;
    const paginatedRecords = records.slice(startIdx, startIdx + pageSize);

    res.json({
      success: true,
      data: {
        records: paginatedRecords,
        pagination: { page, pageSize, total: records.length, totalPages }
      }
    });
  } catch (error) {
    logger.error('区块链记录查询失败', { error: error.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /api/v1/blockchain/records/:hash
 * 按哈希精确查询链上记录
 */
router.get('/records/:hash', requireBlockchain, async (req, res) => {
  try {
    const { hash } = req.params;
    if (!hash || hash.length < 10) {
      return res.status(400).json({ success: false, message: '无效的哈希值' });
    }
    const record = await blockchainService.getRecordByHash(hash);
    if (!record) {
      return res.status(404).json({ success: false, message: '链上无此记录' });
    }
    res.json({ success: true, data: record });
  } catch (error) {
    logger.error('按哈希查询失败', { error: error.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /api/v1/blockchain/verify/:transactionId
 * 一键验证交易
 */
router.get('/verify/:transactionId', requireBlockchain, async (req, res) => {
  try {
    const { transactionId } = req.params;
    let { transactionData } = req.query;

    if (!transactionId) {
      return res.status(400).json({ success: false, message: '缺少交易ID' });
    }

    if (!transactionData) {
      return res.status(400).json({
        success: false,
        message: '请提供 transactionData 查询参数（JSON 格式）'
      });
    }

    let parsedData;
    try {
      parsedData = JSON.parse(transactionData);
    } catch {
      return res.status(400).json({ success: false, message: 'transactionData 必须是有效的 JSON' });
    }

    const result = await blockchainService.verifyTransactionHash(transactionId, parsedData);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('交易验证失败', { error: error.message });
    res.status(500).json({ success: false, message: '验证失败' });
  }
});

/**
 * GET /api/v1/blockchain/status
 * 区块链服务状态
 */
router.get('/status', requireBlockchain, async (req, res) => {
  try {
    const status = blockchainService.getStatus();
    const totalRecords = await blockchainService.getTransactionCount();
    res.json({ success: true, data: { ...status, totalRecords } });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取状态失败' });
  }
});

module.exports = router;
