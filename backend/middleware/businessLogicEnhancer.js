/**
 * 业务逻辑增强中间件
 * 提供统一的业务规则验证、数据校验和流程控制
 */

const logger = require('../utils/logger');

class BusinessLogicEnhancer {
  constructor() {
    this.validators = new Map();
    this.rules = new Map();
    this.cache = new Map();
  }

  /**
   * 数据验证中间件
   * 统一验证请求数据的完整性和有效性
   */
  validateData(validationRules) {
    return async (req, res, next) => {
      try {
        const errors = [];
        const data = { ...req.body, ...req.query, ...req.params };

        for (const [field, rules] of Object.entries(validationRules)) {
          const value = data[field];
          
          // 检查必填字段
          if (rules.required && (value === undefined || value === null || value === '')) {
            errors.push({ field, message: `${field} 为必填字段` });
            continue;
          }

          // 如果值为空且不是必填项，跳过其他验证
          if (!value && !rules.required) continue;

          // 类型验证
          if (rules.type && !this.validateType(value, rules.type)) {
            errors.push({ field, message: `${field} 类型应为 ${rules.type}` });
          }

          // 长度验证
          if (rules.minLength && String(value).length < rules.minLength) {
            errors.push({ field, message: `${field} 最小长度为 ${rules.minLength}` });
          }
          if (rules.maxLength && String(value).length > rules.maxLength) {
            errors.push({ field, message: `${field} 最大长度为 ${rules.maxLength}` });
          }

          // 数值范围验证
          if (rules.type === 'number') {
            const num = Number(value);
            if (rules.min !== undefined && num < rules.min) {
              errors.push({ field, message: `${field} 最小值为 ${rules.min}` });
            }
            if (rules.max !== undefined && num > rules.max) {
              errors.push({ field, message: `${field} 最大值为 ${rules.max}` });
            }
          }

          // 正则表达式验证
          if (rules.pattern && !rules.pattern.test(String(value))) {
            errors.push({ field, message: rules.message || `${field} 格式不正确` });
          }

          // 自定义验证
          if (rules.validator && typeof rules.validator === 'function') {
            const result = await rules.validator(value, data);
            if (result !== true) {
              errors.push({ field, message: result || `${field} 验证失败` });
            }
          }
        }

        if (errors.length > 0) {
          return res.status(400).json({
            success: false,
            message: '数据验证失败',
            errors
          });
        }

        // 将验证后的数据附加到请求对象
        req.validatedData = data;
        next();
      } catch (error) {
        logger.error('数据验证中间件错误:', error);
        return res.status(500).json({
          success: false,
          message: '验证过程发生错误'
        });
      }
    };
  }

  /**
   * 业务规则验证中间件
   * 验证业务逻辑规则
   */
  validateBusinessRules(rules) {
    return async (req, res, next) => {
      try {
        const errors = [];
        const context = {
          user: req.user,
          data: req.validatedData || { ...req.body, ...req.query, ...req.params },
          req
        };

        for (const rule of rules) {
          const result = await rule.validate(context);
          if (result !== true) {
            errors.push({
              rule: rule.name || '业务规则',
              message: result || '业务规则验证失败'
            });
          }
        }

        if (errors.length > 0) {
          return res.status(422).json({
            success: false,
            message: '业务规则验证失败',
            errors
          });
        }

        next();
      } catch (error) {
        logger.error('业务规则验证中间件错误:', error);
        return res.status(500).json({
          success: false,
          message: '业务规则验证过程发生错误'
        });
      }
    };
  }

  /**
   * 事务管理中间件
   * 确保数据一致性
   */
  transaction() {
    return async (req, res, next) => {
      const transactionId = this.generateTransactionId();
      req.transactionId = transactionId;
      
      // 存储事务操作日志
      req.transactionLog = [];
      
      // 添加事务回滚方法
      req.rollback = async () => {
        logger.info(`执行事务回滚: ${transactionId}`);
        for (const operation of req.transactionLog.reverse()) {
          try {
            await operation.rollback();
          } catch (error) {
            logger.error(`事务回滚操作失败: ${transactionId}`, error);
          }
        }
      };

      // 添加事务提交方法
      req.commit = async () => {
        logger.info(`提交事务: ${transactionId}`);
        req.transactionLog = []; // 清空事务日志
      };

      // 添加事务操作记录方法
      req.addOperation = (operation) => {
        req.transactionLog.push(operation);
      };

      // 监听响应完成事件
      res.on('finish', () => {
        if (res.statusCode >= 400 && req.transactionLog.length > 0) {
          // 如果响应状态码表示错误，自动回滚
          req.rollback();
        } else {
          // 否则提交事务
          req.commit();
        }
      });

      next();
    };
  }

  /**
   * 缓存中间件
   * 缓存频繁访问的数据
   */
  cache(keyGenerator, ttl = 300000) {
    return async (req, res, next) => {
      try {
        const cacheKey = typeof keyGenerator === 'function' 
          ? keyGenerator(req) 
          : keyGenerator;

        // 检查缓存
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < ttl) {
          logger.debug(`缓存命中: ${cacheKey}`);
          return res.json(cached.data);
        }

        // 重写res.json方法以缓存响应
        const originalJson = res.json.bind(res);
        res.json = (data) => {
          if (res.statusCode === 200) {
            this.cache.set(cacheKey, {
              data,
              timestamp: Date.now()
            });
            logger.debug(`缓存数据: ${cacheKey}`);
          }
          return originalJson(data);
        };

        next();
      } catch (error) {
        logger.error('缓存中间件错误:', error);
        next();
      }
    };
  }

  /**
   * 速率限制中间件（增强版）
   * 基于用户ID和IP的双重限制
   */
  rateLimitEnhanced(options = {}) {
    const {
      windowMs = 15 * 60 * 1000, // 15分钟
      maxRequests = 100,
      keyPrefix = 'rate_limit'
    } = options;

    const requests = new Map();

    return async (req, res, next) => {
      try {
        const userId = req.user?.id || 'anonymous';
        const ip = req.ip || req.connection.remoteAddress;
        const key = `${keyPrefix}:${userId}:${ip}`;

        const now = Date.now();
        const windowStart = now - windowMs;

        // 获取或初始化请求记录
        let userRequests = requests.get(key) || [];
        
        // 清理过期记录
        userRequests = userRequests.filter(timestamp => timestamp > windowStart);

        // 检查是否超过限制
        if (userRequests.length >= maxRequests) {
          logger.warn(`速率限制触发: ${key}`);
          return res.status(429).json({
            success: false,
            message: '请求过于频繁，请稍后再试',
            retryAfter: Math.ceil(windowMs / 1000)
          });
        }

        // 记录当前请求
        userRequests.push(now);
        requests.set(key, userRequests);

        // 添加响应头
        res.setHeader('X-RateLimit-Limit', maxRequests);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - userRequests.length));

        next();
      } catch (error) {
        logger.error('速率限制中间件错误:', error);
        next();
      }
    };
  }

  /**
   * 数据转换中间件
   * 统一数据格式转换
   */
  transform(transformers) {
    return async (req, res, next) => {
      try {
        if (req.body && transformers.body) {
          req.body = await transformers.body(req.body);
        }
        if (req.query && transformers.query) {
          req.query = await transformers.query(req.query);
        }
        if (req.params && transformers.params) {
          req.params = await transformers.params(req.params);
        }
        next();
      } catch (error) {
        logger.error('数据转换中间件错误:', error);
        return res.status(400).json({
          success: false,
          message: '数据转换失败'
        });
      }
    };
  }

  /**
   * 审计日志中间件
   * 记录关键业务操作
   */
  auditLog(operation) {
    return async (req, res, next) => {
      const startTime = Date.now();
      
      // 记录请求信息
      const auditData = {
        operation,
        userId: req.user?.id,
        ip: req.ip || req.connection.remoteAddress,
        method: req.method,
        path: req.path,
        timestamp: new Date().toISOString(),
        requestData: this.sanitizeData(req.body)
      };

      // 重写res.json方法以捕获响应
      const originalJson = res.json.bind(res);
      res.json = (data) => {
        auditData.responseTime = Date.now() - startTime;
        auditData.statusCode = res.statusCode;
        auditData.success = res.statusCode < 400;
        
        // 记录审计日志
        this.logAudit(auditData);
        
        return originalJson(data);
      };

      next();
    };
  }

  /**
   * 类型验证辅助方法
   * @private
   */
  validateType(value, type) {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'array':
        return Array.isArray(value);
      case 'object':
        return typeof value === 'object' && value !== null && !Array.isArray(value);
      case 'email':
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
      case 'url':
        try {
          new URL(String(value));
          return true;
        } catch {
          return false;
        }
      default:
        return true;
    }
  }

  /**
   * 生成事务ID
   * @private
   */
  generateTransactionId() {
    return `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 清理敏感数据
   * @private
   */
  sanitizeData(data) {
    if (!data || typeof data !== 'object') return data;
    
    const sensitiveFields = ['password', 'secret', 'token', 'key', 'privateKey'];
    const sanitized = { ...data };
    
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '***';
      }
    }
    
    return sanitized;
  }

  /**
   * 记录审计日志
   * @private
   */
  logAudit(data) {
    logger.info('审计日志:', data);
    // 这里可以扩展为写入数据库或文件
  }

  /**
   * 清除缓存
   */
  clearCache(pattern) {
    if (pattern) {
      for (const [key] of this.cache) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
    logger.info('缓存已清除');
  }
}

// 创建单例实例
const businessLogicEnhancer = new BusinessLogicEnhancer();

module.exports = {
  BusinessLogicEnhancer,
  validateData: (rules) => businessLogicEnhancer.validateData(rules),
  validateBusinessRules: (rules) => businessLogicEnhancer.validateBusinessRules(rules),
  transaction: () => businessLogicEnhancer.transaction(),
  cache: (keyGenerator, ttl) => businessLogicEnhancer.cache(keyGenerator, ttl),
  rateLimitEnhanced: (options) => businessLogicEnhancer.rateLimitEnhanced(options),
  transform: (transformers) => businessLogicEnhancer.transform(transformers),
  auditLog: (operation) => businessLogicEnhancer.auditLog(operation)
};
