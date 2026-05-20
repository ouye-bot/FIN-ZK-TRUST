const jwt = require('jsonwebtoken');
const { execute } = require('../config/database');
const { antiReplayMiddleware } = require('./antiReplayMiddleware');
const { authPermissionMiddleware } = require('./authPermissionMiddleware');
const { anomalyDetectionMiddleware } = require('./anomalyDetection');

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
    console.warn('[JWT] Blacklist database query failed, falling back to cache only:', dbError.message);
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
            console.log('[JWT] Token is blacklisted:', decoded.jti);
            return res.status(401).json({ success: false, message: 'Token 已被撤销' });
          }
        }
        
        req.user = decoded;
        console.log('[JWT] User parsed:', req.user?.id);
      } catch(err) {
        console.log('[JWT] Token invalid:', err.message);
        return res.status(401).json({ success: false, message: '无效的认证令牌' });
      }
    }
    next();
  });

  // 2. 异常行为检测中间件
  app.use(anomalyDetectionMiddleware);

  // 3. 防重放中间件
  app.use(antiReplayMiddleware);

  // 4. 权限校验中间件
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
        console.log('[JWT] Cleaned up expired blacklist entries:', result.affectedRows);
      }
    } catch (dbError) {
      console.warn('[JWT] Failed to clean up blacklist:', dbError.message);
    }
  }
}, 60000);
blacklistCleanupInterval.unref();

module.exports = {
  setupSecurityChain,
  addToBlacklist
};