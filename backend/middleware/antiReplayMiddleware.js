const crypto = require('crypto');
const logger = require('../utils/logger');
const { execute } = require('../config/database');
const { getSecurityLevel } = require('../config/endpointRegistry');

const nonceCache = new Map();
const NONCE_CACHE_MAX = 10000;

setInterval(async () => {
  const now = Date.now();

  for (const [nonce, expiresAt] of nonceCache.entries()) {
    if (now > expiresAt) {
      nonceCache.delete(nonce);
    }
  }

  if (nonceCache.size > NONCE_CACHE_MAX) {
    const excess = nonceCache.size - NONCE_CACHE_MAX;
    const entries = nonceCache.entries();
    for (let i = 0; i < excess; i++) {
      const entry = entries.next();
      if (!entry.done) nonceCache.delete(entry.value[0]);
    }
  }

  if (Math.floor(Date.now() / 60000) % 10 === 0) {
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
    const requestTime = parseInt(timestamp);
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
      logger.warning('Invalid nonce', { path: req.path, method: req.method, nonce, requestId });
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
        logger.warning('Duplicate request rejected (cache)', { path: req.path, method: req.method, nonce, requestId });
        return res.status(403).json({
          code: '403_REPLAY_ATTACK',
          message: 'Duplicate request, possible replay attack',
          requestId
        });
      }
    }

    try {
      const dbResults = await execute(
        'SELECT nonce, expires_at FROM replay_nonces WHERE nonce = ? AND expires_at > ?',
        [nonce, Date.now()]
      );
      if (dbResults.length > 0) {
        nonceCache.set(nonce, dbResults[0].expires_at);
        const requestId = generateRequestId();
        logger.warning('Duplicate request rejected (database)', { path: req.path, method: req.method, nonce, requestId });
        return res.status(403).json({
          code: '403_REPLAY_ATTACK',
          message: 'Duplicate request, possible replay attack',
          requestId
        });
      }
    } catch (dbError) {
      logger.warning('Nonce数据库查询失败，降级到内存校验', { error: dbError.message });
    }

    const expiryTime = Date.now() + 5 * 60 * 1000;

    try {
      await execute(
        'INSERT INTO replay_nonces (nonce, expires_at) VALUES (?, ?)',
        [nonce, expiryTime]
      );
    } catch (dbError) {
      if (dbError.code === 'ER_DUP_ENTRY') {
        const requestId = generateRequestId();
        logger.warning('Duplicate request rejected (DB insert conflict)', { path: req.path, method: req.method, nonce, requestId });
        return res.status(403).json({
          code: '403_REPLAY_ATTACK',
          message: 'Duplicate request, possible replay attack',
          requestId
        });
      } else {
        logger.warning('Nonce持久化写入失败，降级到内存校验', { error: dbError.message });
      }
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