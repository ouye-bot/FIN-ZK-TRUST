const logger = require('../utils/logger');
const { getSecurityLevel } = require('../config/endpointRegistry');
const { UnauthorizedError, ForbiddenError, ValidationError } = require('./errorHandler');

exports.authPermissionMiddleware = (req, res, next) => {
  try {
    const level = getSecurityLevel(req.method, req.path);

    if (level === 'public') {
      return next();
    }

    const currentUserId = req.user?.id;

    if (!currentUserId) {
      logger.warning('User not authenticated', { path: req.path, method: req.method });
      return next(new UnauthorizedError('Authentication token not provided'));
    }

    let targetUserId = req.params.id || req.params.userId || req.body.userId;

    if (targetUserId) {
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