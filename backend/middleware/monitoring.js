const logger = require('../utils/logger');

// 监控数据
const monitoringData = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  totalResponseTime: 0,
  averageResponseTime: 0,
  requestsPerEndpoint: {},
  errorsPerEndpoint: {}
};

/**
 * 监控中间件
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @param {Function} next - 下一个中间件
 */
const monitoringMiddleware = (req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;

  // 重写send方法，记录响应时间和状态码
  res.send = function(body) {
    const endTime = Date.now();
    const responseTime = endTime - startTime;

    // 更新监控数据
    monitoringData.totalRequests++;
    monitoringData.totalResponseTime += responseTime;
    monitoringData.averageResponseTime = monitoringData.totalResponseTime / monitoringData.totalRequests;

    // 记录请求信息
    const endpoint = req.path;
    if (!monitoringData.requestsPerEndpoint[endpoint]) {
      monitoringData.requestsPerEndpoint[endpoint] = 0;
    }
    monitoringData.requestsPerEndpoint[endpoint]++;

    // 记录状态码
    if (res.statusCode >= 400) {
      monitoringData.failedRequests++;
      if (!monitoringData.errorsPerEndpoint[endpoint]) {
        monitoringData.errorsPerEndpoint[endpoint] = 0;
      }
      monitoringData.errorsPerEndpoint[endpoint]++;
      logger.warning('API请求失败', {
        endpoint,
        method: req.method,
        statusCode: res.statusCode,
        responseTime: responseTime
      });
    } else {
      monitoringData.successfulRequests++;
      logger.info('API请求成功', {
        endpoint,
        method: req.method,
        statusCode: res.statusCode,
        responseTime: responseTime
      });
    }

    // 调用原始的send方法
    return originalSend.call(this, body);
  };

  next();
};

/**
 * 获取监控数据
 * @param {Object} req - 请求对象
 * @param {Object} res - 响应对象
 * @param {Function} next - 下一个中间件
 */
const getMonitoringData = (req, res, next) => {
  res.json({
    success: true,
    data: {
      ...monitoringData,
      timestamp: new Date().toISOString()
    }
  });
};

module.exports = {
  monitoringMiddleware,
  getMonitoringData
};