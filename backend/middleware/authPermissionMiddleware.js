const logger = require('../utils/logger');
const { UnauthorizedError, ForbiddenError, ValidationError } = require('./errorHandler');

/**
 * 权限校验中间件
 * 验证用户只能访问自己的资源
 */

exports.authPermissionMiddleware = (req, res, next) => {
  try {
    // 白名单路径 - 不需要权限校验的接口
    // 注意：这些路径需与路由注册的完整路径匹配（包含 /api/v1 前缀）
    const whitelistPaths = [
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/auth/refresh-token',
      '/api/v1/health',
      '/api/v1/user/me',
      '/api/v1/credit/generate-proof',
      '/api/v1/credit/verify-proof',
      '/api/v1/loan/apply',
      '/api/v1/loan/list',
      '/api/v1/pool/status',
      '/api/v1/risk/assessment',
      '/api/v1/mfa/verify'
    ];
    
    // 检查是否在白名单中
    if (whitelistPaths.some(path => req.path.startsWith(path))) {
      return next();
    }
    
    // 从请求对象中获取用户信息（由authMiddleware设置）
    const currentUserId = req.user?.id;
    
    if (!currentUserId) {
      logger.warning('User not authenticated', { path: req.path, method: req.method });
      return next(new UnauthorizedError('Authentication token not provided'));
    }
    
    // 从请求路径或请求体中获取目标用户ID
    let targetUserId = req.params.id || req.params.userId || req.body.userId;
    
    // 确保用户ID类型一致
    if (targetUserId) {
      // 验证targetUserId是否为有效的数字ID
      if (isNaN(targetUserId) || !/^\d+$/.test(targetUserId.toString())) {
        logger.warning('Invalid user ID format', {
          targetUserId: targetUserId,
          path: req.path,
          method: req.method
        });
        return next(new ValidationError('Invalid user ID format'));
      }
      
      const currentUserIdStr = currentUserId.toString();
      const targetUserIdStr = targetUserId.toString();
      
      if (currentUserIdStr !== targetUserIdStr) {
        logger.warning('Access denied', {
          currentUserId: currentUserIdStr,
          targetUserId: targetUserIdStr,
          path: req.path,
          method: req.method
        });
        return next(new ForbiddenError('No permission to access this resource'));
      }
    }
    
    next();
  } catch (error) {
    logger.error('Permission check failed', { error: error.message, path: req.path, method: req.method });
    next(error);
  }
};
