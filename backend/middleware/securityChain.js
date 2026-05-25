const jwt = require('jsonwebtoken');
const { execute } = require('../config/database');
const { antiReplayMiddleware } = require('./antiReplayMiddleware');
const { authPermissionMiddleware } = require('./authPermissionMiddleware');
const { anomalyDetectionMiddleware } = require('./anomalyDetection');
const logger = require('../utils/logger');

const blacklistCache = new Map();
const validTokens = new Map();
let blacklistMissCount = 0;

const MAX_BLACKLIST_ENTRIES = 10000;
const MAX_VALID_TOKEN_ENTRIES = 10000;

const isTokenBlacklisted = async (jti, expiresAt) => {
  const now = Date.now();

  // 1. Check blacklist cache (token IS blacklisted)
  if (blacklistCache.has(jti)) {
    const cachedExpiresAt = blacklistCache.get(jti);
    if (now < cachedExpiresAt) {
      return true;
    }
    blacklistCache.delete(jti);
  }

  // 2. Check valid token cache (token confirmed NOT blacklisted)
  if (validTokens.has(jti)) {
    const cachedExpiry = validTokens.get(jti);
    if (now < cachedExpiry) {
      return false;
    }
    validTokens.delete(jti);
  }

  // 3. Query DB
  try {
    const results = await execute(
      'SELECT expires_at FROM token_blacklist WHERE jti = ? AND expires_at > ?',
      [jti, now]
    );

    if (results.length > 0) {
      blacklistCache.set(jti, results[0].expires_at);
      return true;
    }

    // Not blacklisted — cache as valid token (TTL = min of token expiry or 5 min)
    const ttl = Math.min(expiresAt - now, 300000);
    if (ttl > 0) {
      validTokens.set(jti, now + ttl);
    }
    return false;
  } catch (dbError) {
    if (blacklistCache.has(jti)) {
      logger.warning('Blacklist DB failed, token found in cache', { jti });
      return true;
    }
    logger.error('CRITICAL: Blacklist database query failed and token not in cache', { error: dbError.message, jti });
    blacklistMissCount++;
    if (blacklistMissCount % 100 === 0) {
      logger.error(`Blacklist fail-open count reached ${blacklistMissCount}`);
    }
    return false;
  }
};

const addToBlacklist = (jti, expiresAt) => {
  blacklistCache.set(jti, expiresAt);
};

const setupSecurityChain = (app) => {
  // 1. JWT 解析中间件
  app.use(async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        if (decoded.jti && decoded.exp) {
          const expiresAt = decoded.exp * 1000;
          const isBlacklisted = await isTokenBlacklisted(decoded.jti, expiresAt);
          
          if (isBlacklisted) {
            logger.warning('JWT Token is blacklisted', { jti: decoded.jti });
            return res.status(401).json({ success: false, message: 'Token 已被撤销' });
          }
        }
        
        req.user = decoded;
        logger.debug('JWT User parsed', { userId: req.user?.id });
      } catch(err) {
        logger.debug('JWT Token invalid', { error: err.message });
        return res.status(401).json({ success: false, message: '无效的认证令牌' });
      }
    }
    next();
  });

  // 2. 异常行为检测中间件
  app.use(anomalyDetectionMiddleware);

  // 3. SM2 签名验证中间件（有 x-user-id 时强制要求签名）
  const sm2SignatureMiddleware = require('./sm2SignatureMiddleware');
  app.use(sm2SignatureMiddleware);

  // 4. 防重放中间件
  app.use(antiReplayMiddleware);

  // 5. 权限校验中间件
  app.use(authPermissionMiddleware);
};

const blacklistCleanupInterval = setInterval(async () => {
  const now = Date.now();

  for (const [jti, expiresAt] of blacklistCache.entries()) {
    if (now > expiresAt) {
      blacklistCache.delete(jti);
    }
  }

  for (const [jti, expiry] of validTokens.entries()) {
    if (now > expiry) {
      validTokens.delete(jti);
    }
  }

  // Enforce max size — evict earliest-expiring entries if over limit
  if (blacklistCache.size > MAX_BLACKLIST_ENTRIES) {
    const sorted = [...blacklistCache.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, sorted.length - MAX_BLACKLIST_ENTRIES);
    for (const [jti] of toRemove) blacklistCache.delete(jti);
  }
  if (validTokens.size > MAX_VALID_TOKEN_ENTRIES) {
    const sorted = [...validTokens.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = sorted.slice(0, sorted.length - MAX_VALID_TOKEN_ENTRIES);
    for (const [jti] of toRemove) validTokens.delete(jti);
  }

  if (Math.floor(Date.now() / 600000) % 6 === 0) {
    try {
      const result = await execute(
        'DELETE FROM token_blacklist WHERE expires_at < ?',
        [now]
      );
      if (result.affectedRows > 0) {
        logger.debug('Cleaned up expired blacklist entries', { count: result.affectedRows });
      }
    } catch (dbError) {
      logger.warning('Failed to clean up blacklist', { error: dbError.message });
    }
  }
}, 60000);
blacklistCleanupInterval.unref();

module.exports = {
  setupSecurityChain,
  addToBlacklist
};