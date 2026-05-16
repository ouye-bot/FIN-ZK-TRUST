const logger = require('../utils/logger');

/**
 * 自定义错误类
 */
class AppError extends Error {
  constructor(message, statusCode, name = 'AppError') {
    super(message);
    this.name = name;
    this.statusCode = statusCode;
    this.isOperational = true;
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message) {
    super(message, 400, 'ValidationError');
  }
}

class UnauthorizedError extends AppError {
  constructor(message = '未授权访问') {
    super(message, 401, 'UnauthorizedError');
  }
}

class ForbiddenError extends AppError {
  constructor(message = '禁止访问') {
    super(message, 403, 'ForbiddenError');
  }
}

class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, 404, 'NotFoundError');
  }
}

/**
 * 错误监控服务
 */
class ErrorMonitor {
  constructor() {
    this.errors = [];
    this.errorCounts = {};
    this.threshold = 10; // 每分钟错误阈值
  }
  
  /**
   * 记录错误
   * @param {Error} error - 错误对象
   * @param {Object} req - 请求对象
   */
  recordError(error, req) {
    const errorData = {
      timestamp: new Date().toISOString(),
      errorType: error.name || 'UnknownError',
      message: error.message,
      path: req.path,
      method: req.method,
      userId: req.user?.id,
      ip: req.ip
    };
    
    this.errors.push(errorData);
    
    // 更新错误计数
    if (!this.errorCounts[error.name]) {
      this.errorCounts[error.name] = 0;
    }
    this.errorCounts[error.name]++;
    
    // 检查是否超过阈值
    this.checkThreshold();
  }
  
  /**
   * 检查错误阈值
   */
  checkThreshold() {
    const now = Date.now();
    const oneMinuteAgo = now - 60 * 1000;
    
    // 统计一分钟内的错误数
    const recentErrors = this.errors.filter(error => 
      new Date(error.timestamp).getTime() > oneMinuteAgo
    );
    
    if (recentErrors.length > this.threshold) {
      // 触发告警
      this.triggerAlert(recentErrors.length);
    }
  }
  
  /**
   * 触发告警
   * @param {number} errorCount - 错误数量
   */
  triggerAlert(errorCount) {
    logger.warning(`错误率超过阈值: ${errorCount} 个错误/分钟`);
    // 这里可以集成邮件、短信等告警机制
  }
  
  /**
   * 获取错误统计
   * @returns {Object} 错误统计信息
   */
  getStats() {
    return {
      totalErrors: this.errors.length,
      errorCounts: this.errorCounts,
      recentErrors: this.errors.slice(-10) // 最近10个错误
    };
  }
  
  /**
   * 清理旧错误数据
   */
  cleanup() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.errors = this.errors.filter(error => 
      new Date(error.timestamp).getTime() > oneHourAgo
    );
  }
}

// 初始化错误监控
const errorMonitor = new ErrorMonitor();

// 定期清理旧数据
setInterval(() => {
  errorMonitor.cleanup();
}, 60 * 60 * 1000); // 每小时清理一次

/**
 * 统一错误处理中间件
 * @param {Error} err - 错误对象
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @param {Function} next - 下一个中间件
 */
const errorHandler = (err, req, res, next) => {
  // 记录错误到监控系统
  errorMonitor.recordError(err, req);
  
  // 错误分类
  let errorType = 'internal';
  let statusCode = 500;
  let message = '内部服务器错误';
  
  // 根据错误类型设置不同的处理策略
  if (err.name === 'ValidationError') {
    errorType = 'validation';
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'UnauthorizedError') {
    errorType = 'unauthorized';
    statusCode = 401;
    message = err.message;
  } else if (err.name === 'ForbiddenError') {
    errorType = 'forbidden';
    statusCode = 403;
    message = err.message;
  } else if (err.name === 'NotFoundError') {
    errorType = 'not_found';
    statusCode = 404;
    message = err.message;
  } else if (err.statusCode) {
    statusCode = err.statusCode;
    message = err.message || message;
  }
  
  // 错误码映射
  const errorCodeMap = {
    validation: 'INVALID_PARAMS',
    unauthorized: 'TOKEN_INVALID',
    forbidden: 'FORBIDDEN',
    not_found: 'NOT_FOUND',
    internal: 'INTERNAL_ERROR'
  };

  // 标准化错误响应
  const errorResponse = {
    success: false,
    code: errorCodeMap[errorType] || 'INTERNAL_ERROR',
    message: message
  };
  
  // 记录错误日志
  logger.error('Error occurred:', {
    errorType,
    statusCode,
    message,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    error: err.stack
  });
  
  // 返回错误响应
  res.status(statusCode).json(errorResponse);
};

/**
 * 404错误处理中间件
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 */
const notFoundHandler = (req, res) => {
  res.status(404).json({
    success: false,
    message: '请求的资源不存在'
  });
};

/**
 * 获取错误监控统计
 * @returns {Object} 错误监控统计信息
 */
const getErrorStats = () => {
  return errorMonitor.getStats();
};

// 导出模块
module.exports = {
  errorHandler,
  notFoundHandler,
  AppError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  getErrorStats
};
