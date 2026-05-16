const fs = require('fs').promises;
const path = require('path');

// 日志级别
const LOG_LEVELS = {
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  DEBUG: 'debug'
};

// 日志文件路径
const LOG_DIR = path.join(__dirname, '../logs');
const LOG_FILE = path.join(LOG_DIR, 'app.log');

// 确保日志目录存在
const ensureLogDir = async () => {
  try {
    await fs.mkdir(LOG_DIR, { recursive: true });
  } catch (error) {
    console.error('创建日志目录失败:', error);
  }
};

// 初始化日志目录
ensureLogDir();

/**
 * 记录日志
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {Object} data - 附加数据
 */
const log = async (level, message, data = {}) => {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      data
    };

    // 控制台输出
    const consoleMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    if (Object.keys(data).length > 0) {
      console[level === LOG_LEVELS.ERROR ? 'error' : level === LOG_LEVELS.WARNING ? 'warn' : 'log'](
        consoleMessage,
        data
      );
    } else {
      console[level === LOG_LEVELS.ERROR ? 'error' : level === LOG_LEVELS.WARNING ? 'warn' : 'log'](
        consoleMessage
      );
    }

    // 文件输出
    const logString = JSON.stringify(logEntry) + '\n';
    await fs.appendFile(LOG_FILE, logString);
  } catch (error) {
    console.error('记录日志失败:', error);
  }
};

// 导出日志函数
module.exports = {
  info: (message, data) => log(LOG_LEVELS.INFO, message, data),
  warning: (message, data) => log(LOG_LEVELS.WARNING, message, data),
  error: (message, data) => log(LOG_LEVELS.ERROR, message, data),
  debug: (message, data) => log(LOG_LEVELS.DEBUG, message, data)
};