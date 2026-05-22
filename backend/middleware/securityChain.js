const jwt = require('jsonwebtoken');
const { execute } = require('../config/database');
const { antiReplayMiddleware } = require('./antiReplayMiddleware');
const { authPermissionMiddleware } = require('./authPermissionMiddleware');
const { anomalyDetectionMiddleware } = require('./anomalyDetection');
const logger = require('../utils/logger');

const blacklistCache = new Map();

const isTokenBlacklisted = async (jti, expiresAt) => {
  const now = Date.now();
  
  if (blacklistCache.has(jti)) {
    const cachedExpiresAt = blacklistCache.get(jti);
    if (now < cachedExpiresAt) {
      return true;
    }
    blacklistCache.delete(jti);
    return false;
  }

  try {
    const results = await execute(
      'SELECT expires_at FROM token_blacklist WHERE jti = ? AND expires_at > ?',
      [jti, now]
    );
    
    if (results.length > 0) {
      blacklistCache.set(jti, results[0].expires_at);
      return true;
    }
    return false;
  } catch (dbError) {
    // DB查询失败时，检查缓存中是否有该JTI的记录
    if (blacklistCache.has(jti)) {
      logger.warning('Blacklist DB failed, token found in cache', { jti });
      return true;
    }
    logger.error('CRITICAL: Blacklist database query failed and token not in cache', { error: dbError.message, jti });
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

  if (Math.floor(Date.now() / 600000) % 1 === 0) {
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