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

    // 对 ZKP 类型记录补充链上验证状态
    if (data && data.recentRecords) {
      for (const record of data.recentRecords) {
        if (record.operationType === 'zkp' && record.proofId) {
          try {
            const zkpResult = await blockchainService.getZKPResult(record.proofId);
            if (zkpResult) {
              record.chainVerified = zkpResult.chainVerified || false;
              record.chainValid = zkpResult.chainValid || false;
            }
          } catch (e) {
            // 查询失败不影响主数据
          }
        }
      }
    }

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
 * 一键验证交易（需要 transactionData）
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
 * POST /api/v1/blockchain/verify
 * 按 SM3 哈希验证链上存证（无需重建原始数据）
 * Body: { hash: "SM3哈希值" }
 */
router.post('/verify', requireBlockchain, async (req, res) => {
  try {
    const { hash } = req.body;
    if (!hash || typeof hash !== 'string' || hash.length < 10) {
      return res.status(400).json({ success: false, message: '请提供有效的 SM3 哈希值' });
    }

    const record = await blockchainService.getRecordByHash(hash);
    if (!record) {
      return res.json({ success: true, data: { verified: false, reason: '链上无此记录' } });
    }

    res.json({
      success: true,
      data: {
        verified: true,
        hash,
        timestamp: record.timestamp,
        submitter: record.submitter,
        operationType: record.operationType,
        userId: record.userId
      }
    });
  } catch (error) {
    logger.error('哈希验证失败', { error: error.message });
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

/**
 * GET /api/v1/blockchain/zkp-verify/:proofId
 * 查询 ZKP 验证结果
 */
router.get('/zkp-verify/:proofId', requireBlockchain, async (req, res) => {
  try {
    const { proofId } = req.params;
    const result = await blockchainService.getZKPResult(proofId);
    if (!result) {
      return res.status(404).json({ success: false, message: 'ZKP 验证记录不存在' });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('ZKP 验证查询失败', { error: error.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /api/v1/blockchain/public-key/:userId
 * 查询用户当前活跃的链上公钥（第三方可调用）
 */
router.get('/public-key/:userId', requireBlockchain, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ success: false, message: '缺少用户ID' });
    }

    const activeKey = await blockchainService.getActivePublicKey(userId);
    if (!activeKey) {
      return res.json({
        success: true,
        data: { found: false, message: '该用户无链上公钥记录' }
      });
    }

    res.json({
      success: true,
      data: {
        found: true,
        userId,
        publicKey: activeKey.publicKey,
        pkHash: activeKey.pkHash,
        version: activeKey.version,
        timestamp: activeKey.timestamp,
        active: activeKey.active
      }
    });
  } catch (error) {
    logger.error('链上公钥查询失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /api/v1/blockchain/public-key/:userId/history
 * 查询用户公钥历史（含已撤销密钥）
 */
router.get('/public-key/:userId/history', requireBlockchain, async (req, res) => {
  try {
    const { userId } = req.params;
    if (!userId) {
      return res.status(400).json({ success: false, message: '缺少用户ID' });
    }

    const history = await blockchainService.getPublicKeyHistory(userId);
    res.json({
      success: true,
      data: {
        userId,
        totalKeys: history.length,
        keys: history.map(k => ({
          publicKey: k.publicKey,
          pkHash: k.pkHash,
          version: k.version,
          timestamp: k.timestamp,
          active: k.active
        }))
      }
    });
  } catch (error) {
    logger.error('链上公钥历史查询失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * POST /api/v1/blockchain/public-key/revoke
 * 紧急撤销公钥（管理员操作）
 * Body: { userId, pkHash }
 */
router.post('/public-key/revoke', requireBlockchain, async (req, res) => {
  try {
    const { userId, pkHash } = req.body;
    if (!userId || !pkHash) {
      return res.status(400).json({ success: false, message: '缺少 userId 或 pkHash' });
    }

    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: '需要管理员权限' });
    }

    const result = await blockchainService.revokePublicKey(userId, pkHash);
    if (result.success) {
      logger.info('管理员撤销公钥成功', { userId, pkHash, admin: req.user.id });
      res.json({ success: true, message: '公钥撤销成功', data: result });
    } else {
      res.status(400).json({ success: false, message: '公钥撤销失败', error: result.error });
    }
  } catch (error) {
    logger.error('公钥撤销失败', { error: error.message });
    res.status(500).json({ success: false, message: '撤销失败' });
  }
});

module.exports = router;
