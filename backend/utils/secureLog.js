/**
 * 安全日志工具
 * 防止敏感数据泄漏到日志中
 */

const logger = require('./logger');

const MASK_RULES = {
  sm2PublicKey: (val) => val ? val.substring(0, 6) + '...' + val.substring(val.length - 4) : '[empty]',
  sm2PrivateKey: () => '[REDACTED]',
  signature: (val) => val ? val.substring(0, 8) + '...' : '[empty]',
  token: (val) => val ? val.substring(0, 8) + '...' : '[empty]',
  password: () => '[REDACTED]',
  dek: () => '[REDACTED]',
  masterKey: () => '[REDACTED]'
};

function secureLog(level, message, data = {}) {
  const sanitized = { ...data };
  for (const [key, maskFn] of Object.entries(MASK_RULES)) {
    if (sanitized[key] !== undefined) {
      sanitized[key] = maskFn(sanitized[key]);
    }
  }
  logger[level](message, sanitized);
}

module.exports = {
  secureLog,
  MASK_RULES
};