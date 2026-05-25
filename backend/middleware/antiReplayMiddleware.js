const crypto = require('crypto');
const logger = require('../utils/logger');
const { execute } = require('../config/database');
const { getSecurityLevel } = require('../config/endpointRegistry');

const nonceCache = new Map();
const NONCE_CACHE_MAX = 10000;
let cleanupCounter = 0;

function evictOldestNonceEntries(count) {
  const entries = nonceCache.entries();
  for (let i = 0; i < count; i++) {
    const entry = entries.next();
    if (!entry.done) nonceCache.delete(entry.value[0]);
  }
}

const cleanupTimer = setInterval(async () => {
  const now = Date.now();

  for (const [nonce, expiresAt] of nonceCache.entries()) {
    if (now > expiresAt) {
      nonceCache.delete(nonce);
    }
  }

  if (nonceCache.size > NONCE_CACHE_MAX) {
    evictOldestNonceEntries(nonceCache.size - NONCE_CACHE_MAX);
  }

  cleanupCounter++;
  if (cleanupCounter >= 10) {
    cleanupCounter = 0;
    try {
      const result = await execute(
        'DELETE FROM replay_nonces WHERE expires_at < ?',
        [now]
      );
      if (result.affectedRows > 0) {
        logger.info('清理过期Nonce', { deletedCount: result.affectedRows });
      }
    } catch (dbError) {
      logger.warning('清理过期Nonce失败', { error: dbError.message });
    }
  }
}, 60 * 1000);
cleanupTimer.unref();

const generateRequestId = () => {
  return crypto.randomBytes(16).toString('hex');
};

exports.antiReplayMiddleware = async (req, res, next) => {
  try {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      return next();
    }

    const level = getSecurityLevel(req.method, req.path);

    if (level === 'public') {
      return next();
    }

    const timestamp = req.headers['x-request-timestamp'];
    const nonce = req.headers['x-request-nonce'];

    if (!timestamp || !nonce) {
      const requestId = generateRequestId();
      logger.warning('Missing anti-replay headers', { path: req.path, method: req.method, requestId });
      return res.status(403).json({
        code: '403_MISSING_REPLAY_FIELDS',
        message: 'Missing required anti-replay headers',
        requestId
      });
    }

    const now = Date.now();
    const requestTime = parseInt(timestamp, 10);
    if (isNaN(requestTime) || Math.abs(now - requestTime) > 5 * 60 * 1000) {
      const requestId = generateRequestId();
      logger.warning('Request expired, possible replay attack', { path: req.path, method: req.method, timestamp, requestId });
      return res.status(403).json({
        code: '403_REPLAY_ATTACK',
        message: 'Request expired, possible replay attack',
        requestId
      });
    }

    if (typeof nonce !== 'string' || nonce.length < 32) {
      const requestId = generateRequestId();
      logger.warning('Invalid nonce', { path: req.path, method: req.method, nonce: nonce.substring(0, 8) + '...', requestId });
      return res.status(403).json({
        code: '403_INVALID_NONCE',
        message: 'Invalid nonce, length must be at least 32 characters',
        requestId
      });
    }

    if (nonceCache.has(nonce)) {
      const cacheExpiry = nonceCache.get(nonce);
      if (Date.now() < cacheExpiry) {
        const requestId = generateRequestId();
        logger.warning('Duplicate request rejected (cache)', { path: req.path, method: req.method, nonce: nonce.substring(0, 8) + '...', requestId });
        return res.status(403).json({
          code: '403_REPLAY_ATTACK',
          message: 'Duplicate request, possible replay attack',
          requestId
        });
      }
    }

    const expiryTime = Date.now() + 5 * 60 * 1000;

    try {
      // ON DUPLICATE KEY UPDATE + affectedRows===2 依赖 MySQL 行为：
      // 新插入返回 affectedRows=1，已存在时 UPDATE 返回 affectedRows=2
      const result = await execute(
        'INSERT INTO replay_nonces (nonce, expires_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE nonce = nonce',
        [nonce, expiryTime]
      );
      if (result.affectedRows === 2) {
        const requestId = generateRequestId();
        logger.warning('Duplicate request rejected (database upsert)', { path: req.path, method: req.method, nonce: nonce.substring(0, 8) + '...', requestId });
        return res.status(403).json({
          code: '403_REPLAY_ATTACK',
          message: 'Duplicate request, possible replay attack',
          requestId
        });
      }
    } catch (dbError) {
      // DB 写入失败时降级到内存校验：nonce 仅存入内存，服务重启后可被重放
      logger.warning('Nonce持久化写入失败，降级到内存校验', { error: dbError.message });
    }

    if (nonceCache.size >= NONCE_CACHE_MAX) {
      evictOldestNonceEntries(nonceCache.size - NONCE_CACHE_MAX + 1);
    }
    nonceCache.set(nonce, expiryTime);

    logger.info('Anti-replay verification passed', { path: req.path, method: req.method });
    next();
  } catch (error) {
    const requestId = generateRequestId();
    logger.error('Anti-replay verification failed', { error: error.message, path: req.path, method: req.method, requestId });
    res.status(500).json({
      code: '500_INTERNAL_ERROR',
      message: 'Anti-replay verification failed',
      requestId
    });
  }
};