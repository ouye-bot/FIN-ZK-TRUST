const { verifySM2Signature } = require('../utils/cryptoUtils');
const logger = require('../utils/logger');
const userDao = require('../dao/userDao');
const { execute } = require('../config/database');

// 内存缓存，存储已使用的Nonce，有效期5分钟
const nonceCache = new Map();

// 清理过期的Nonce
setInterval(async () => {
  const now = Date.now();
  
  // 1. 清理内存缓存中的过期条目
  for (const [nonce, expiresAt] of nonceCache.entries()) {
    if (now > expiresAt) {
      nonceCache.delete(nonce);
    }
  }
  
  // 2. 清理数据库中过期的Nonce（每10分钟执行一次）
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
}, 60 * 1000); // 每分钟清理一次

/**
 * 生成请求ID
 */
const generateRequestId = () => {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

/**
 * 防重放攻击中间件
 * 使用时间戳和随机数防止重放攻击
 */
exports.antiReplayMiddleware = async (req, res, next) => {
  try {
    // 白名单：公开接口直接放行
    const WHITE_LIST = [
      '/api-docs',
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/public/',
      '/api/v1/health',
      '/api/v1/monitoring'
    ];
    
    // 检查是否在白名单中
    const isInWhitelist = WHITE_LIST.some(route => {
      if (route.endsWith('/')) {
        return req.path.startsWith(route);
      }
      return req.path === route;
    });
    
    if (isInWhitelist) {
      logger.info('Route is whitelisted, skipping anti-replay', { path: req.path, method: req.method });
      return next();
    }
    
    // 对测试路由和敏感接口强制执行校验
    // 注意：在Express中，当使用app.use('/api/v1/test', middleware, router)时，req.path返回的是相对于挂载点的路径
    // 所以我们需要使用 req.baseUrl + req.path 来获取完整路径
    const fullPath = req.baseUrl + req.path;
    const isTestRoute = req.baseUrl.startsWith('/api/v1/test') || req.path.startsWith('/test');
    const isSensitiveRoute = [
      '/api/v1/credit/generate-proof',
      '/api/v1/credit/verify-proof',
      '/api/v1/loan/borrow',
      '/api/v1/loan/repay',
      '/api/v1/invest',
      '/api/v1/redeem'
    ].some(route => fullPath.startsWith(route));

    const needValidation = isTestRoute || isSensitiveRoute;

    // 打印调试信息
    console.log('[antiReplay] Request path:', req.path);
    console.log('[antiReplay] Base URL:', req.baseUrl);
    console.log('[antiReplay] Full path:', fullPath);
    console.log('[antiReplay] Is test route:', isTestRoute);
    console.log('[antiReplay] Is sensitive route:', isSensitiveRoute);
    console.log('[antiReplay] Need validation:', needValidation);
    
    // 只对需要验证的路径执行校验
    if (!needValidation) {
      logger.info('Non-validated route, skipping anti-replay', { path: req.path, method: req.method });
      return next();
    }
    
    // GET 请求是幂等的，不强制进行防重放签名验证
    if (req.method === 'GET') {
      logger.info('GET request skipping anti-replay', { path: req.path, method: req.method });
      return next();
    }
    
    // 获取请求头中的防重放和签名字段
    const timestamp = req.headers['x-request-timestamp'];
    const nonce = req.headers['x-request-nonce'];
    const signature = req.headers['x-request-sign'];
    
    // 验证防重放字段是否存在
    if (!timestamp || !nonce) {
      const requestId = generateRequestId();
      logger.warning('Missing anti-replay headers', { path: req.path, method: req.method, requestId });
      return res.status(403).json({
        code: '403_MISSING_REPLAY_FIELDS',
        message: 'Missing required anti-replay headers',
        requestId
      });
    }
    
    // 验证时间戳是否在5分钟有效期内
    const now = Date.now();
    const requestTime = parseInt(timestamp);
    if (isNaN(requestTime) || now - requestTime > 5 * 60 * 1000) {
      const requestId = generateRequestId();
      logger.warning('Request expired, possible replay attack', { path: req.path, method: req.method, timestamp, requestId });
      return res.status(403).json({
        code: '403_REPLAY_ATTACK',
        message: 'Request expired, possible replay attack',
        requestId
      });
    }
    
    // 验证随机数Nonce是否为32位以上有效字符串
    if (typeof nonce !== 'string' || nonce.length < 32) {
      const requestId = generateRequestId();
      logger.warning('Invalid nonce', { path: req.path, method: req.method, nonce, requestId });
      return res.status(403).json({
        code: '403_INVALID_NONCE',
        message: 'Invalid nonce, length must be at least 32 characters',
        requestId
      });
    }
    
    // 验证Nonce是否已被使用
    // Step 1: 检查内存缓存
    if (nonceCache.has(nonce)) {
      const cacheExpiry = nonceCache.get(nonce);
      if (Date.now() < cacheExpiry) {
        // 缓存命中且未过期，重复请求
        const requestId = generateRequestId();
        logger.warning('Duplicate request rejected (cache)', { path: req.path, method: req.method, nonce, requestId });
        return res.status(403).json({
          code: '403_REPLAY_ATTACK',
          message: 'Duplicate request, possible replay attack',
          requestId
        });
      }
    }
    
    // Step 2: 缓存未命中，查询数据库
    try {
      const dbResults = await execute(
        'SELECT nonce, expires_at FROM replay_nonces WHERE nonce = ? AND expires_at > ?',
        [nonce, Date.now()]
      );
      if (dbResults.length > 0) {
        // 数据库中已存在且未过期，重复请求
        // 同时更新本地缓存
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
      // 数据库查询失败，降级为仅依赖内存缓存（保证可用性）
      logger.warning('Nonce数据库查询失败，降级到内存校验', { error: dbError.message });
    }
    
    // 签名头缺失时跳过签名验证（由 sm2SignatureMiddleware 可选处理）
    if (!signature) {
      logger.info('No signature header, skipping signature verification', { path: req.path, method: req.method });
      const expiryTime = Date.now() + 5 * 60 * 1000;
      try {
        await execute('INSERT INTO replay_nonces (nonce, expires_at) VALUES (?, ?)', [nonce, expiryTime]);
      } catch (dbError) {
        if (dbError.code === 'ER_DUP_ENTRY') {
          return res.status(403).json({ code: '403_REPLAY_ATTACK', message: 'Duplicate request' });
        }
      }
      nonceCache.set(nonce, expiryTime);
      return next();
    }
    
    // 从JWT中获取用户信息
    const userId = req.user?.id;
    if (!userId) {
      const requestId = generateRequestId();
      logger.warning('User not authenticated', { path: req.path, method: req.method, requestId });
      return res.status(401).json({
        code: '401_UNAUTHORIZED',
        message: 'Authentication token not provided',
        requestId
      });
    }

    // 从数据库读取用户数据，获取SM2公钥
    const user = await userDao.findById(userId);
    
    if (!user || !user.sm2_public_key) {
      const requestId = generateRequestId();
      logger.warning('User has no SM2 public key', { userId, path: req.path, method: req.method, requestId });
      return res.status(401).json({
        code: '401_MISSING_PUBLIC_KEY',
        message: 'User has no SM2 public key',
        requestId
      });
    }
    
    // 构建签名原文：根据请求方法不同构建不同的签名数据
    let signatureData;
    if (req.method === 'GET') {
      signatureData = timestamp + nonce;
    } else {
      const requestBodyStr = JSON.stringify(req.body);
      signatureData = timestamp + nonce + requestBodyStr;
    }

    const isSignatureValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);
    if (!isSignatureValid) {
      const requestId = generateRequestId();
      logger.warning('Invalid request signature', { userId, path: req.path, method: req.method, requestId });
      return res.status(401).json({
        code: '401_SIGN_VERIFY_FAILED',
        message: 'Invalid request signature, may have been tampered',
        requestId
      });
    }
    
    // 记录已使用的Nonce
    const expiryTime = Date.now() + 5 * 60 * 1000; // 5分钟过期
    
    try {
      await execute(
        'INSERT INTO replay_nonces (nonce, expires_at) VALUES (?, ?)',
        [nonce, expiryTime]
      );
    } catch (dbError) {
      // 唯一索引冲突表示Nonce重复（正常情况：已被使用过）
      if (dbError.code === 'ER_DUP_ENTRY') {
        // 重复Nonce，按重放攻击处理
        const requestId = generateRequestId();
        logger.warning('Duplicate request rejected (DB insert conflict)', { path: req.path, method: req.method, nonce, requestId });
        return res.status(403).json({
          code: '403_REPLAY_ATTACK',
          message: 'Duplicate request, possible replay attack',
          requestId
        });
      } else {
        // 数据库写入失败时降级为仅内存校验（保证服务可用性）
        logger.warning('Nonce持久化写入失败，降级到内存校验', { error: dbError.message });
      }
    }
    // 无论DB是否成功，都更新内存缓存
    nonceCache.set(nonce, expiryTime);
    
    logger.info('Anti-replay and signature verification passed', { userId, path: req.path, method: req.method });
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
