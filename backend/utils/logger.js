const fs = require('fs');
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
try {
  fs.mkdirSync(LOG_DIR, { recursive: true });
} catch (error) {
  console.error('创建日志目录失败:', error);
}

// 使用持久化的写入流，避免每次写入都打开新文件句柄（EMFILE 修复）
let logStream = null;
function getLogStream() {
  if (!logStream) {
    logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });
    logStream.on('error', (err) => {
      console.error('日志写入流失效:', err.message);
      logStream = null;
    });
  }
  return logStream;
}

/**
 * 记录日志
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @param {Object} data - 附加数据
 */
const log = (level, message, data = {}) => {
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

    // 文件输出（使用持久化写入流）
    const logString = JSON.stringify(logEntry) + '\n';
    const stream = getLogStream();
    if (stream && !stream.destroyed) {
      stream.write(logString);
    }
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
