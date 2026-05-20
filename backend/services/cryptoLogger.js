const fs = require('fs').promises;
const path = require('path');
const { sm3 } = require('sm-crypto');

const LOG_FILE_PATH = path.join(__dirname, '..', 'data', 'crypto_logs.json');

class CryptoLogger {
  constructor() {
    this._writeLock = Promise.resolve();
  }

  async logOperation(userId, operationType, description, data = {}) {
    // 串行化写入，防止并发损坏
    return new Promise((resolve, reject) => {
      this._writeLock = this._writeLock.then(() => this._doLog(userId, operationType, description, data)).then(resolve).catch(reject);
    });
  }

  async _doLog(userId, operationType, description, data = {}) {
    try {
      // 确保 data 目录存在
      await fs.mkdir(path.dirname(LOG_FILE_PATH), { recursive: true });
      
      // 读取现有日志
      let logs = [];
      try {
        const content = await fs.readFile(LOG_FILE_PATH, 'utf8');
        logs = JSON.parse(content);
      } catch (error) {
        // 文件不存在或为空，初始化空数组
        logs = [];
      }
      
      // 生成新日志ID
      const id = logs.length + 1;
      
      // 计算上一条日志的哈希
      let prevHash = '';
      if (logs.length > 0) {
        prevHash = logs[logs.length - 1].currentHash;
      }
      
      // 构造日志对象
      const newLog = {
        id,
        index: id,
        userId,
        operationType,
        description,
        data,
        timestamp: new Date().toISOString(),
        prevHash
      };
      
      // 计算当前日志的哈希
      const hashInput = newLog.index + 
                       newLog.timestamp + 
                       newLog.userId + 
                       newLog.operationType + 
                       newLog.description + 
                       JSON.stringify(newLog.data) + 
                       newLog.prevHash;
      newLog.currentHash = sm3(hashInput);
      
      // 追加新日志
      logs.push(newLog);
      
      // 写回文件
      await fs.writeFile(LOG_FILE_PATH, JSON.stringify(logs, null, 2), 'utf8');
      
      return id;
    } catch (error) {
      console.error('Error logging crypto operation:', error);
      throw error;
    }
  }
  
  async getLogs(options = {}) {
    const { limit = 50, offset = 0, userId } = options;
    
    try {
      // 读取日志文件
      let logs = [];
      try {
        const content = await fs.readFile(LOG_FILE_PATH, 'utf8');
        logs = JSON.parse(content);
      } catch (error) {
        // 文件不存在，返回空数组
        return { logs: [], total: 0 };
      }
      
      // 按用户筛选（兼容字符串和数字类型）
      if (userId) {
        logs = logs.filter(log => String(log.userId) === String(userId));
      }
      
      // 按时间倒序排序
      logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      // 分页
      const total = logs.length;
      const paginatedLogs = logs.slice(offset, offset + limit);
      
      return {
        logs: paginatedLogs,
        total
      };
    } catch (error) {
      console.error('Error getting crypto logs:', error);
      return { logs: [], total: 0 };
    }
  }
  
  async getLogCount() {
    try {
      let logs = [];
      try {
        const content = await fs.readFile(LOG_FILE_PATH, 'utf8');
        logs = JSON.parse(content);
      } catch (error) {
        // 文件不存在，返回 0
        return 0;
      }
      
      return logs.length;
    } catch (error) {
      console.error('Error getting log count:', error);
      return 0;
    }
  }
  
  async verifyChain() {
    try {
      // 读取日志文件
      let logs = [];
      try {
        const content = await fs.readFile(LOG_FILE_PATH, 'utf8');
        logs = JSON.parse(content);
      } catch (error) {
        // 文件不存在，返回有效（空链）
        return { valid: true, totalEntries: 0, firstInvalidIndex: null };
      }
      
      // 验证链的完整性
      let prevHash = '';
      for (let i = 0; i < logs.length; i++) {
        const log = logs[i];
        
        // 检查索引是否正确
        if (log.index !== i + 1) {
          return { valid: false, totalEntries: logs.length, firstInvalidIndex: log.index };
        }
        
        // 检查 prevHash 是否正确
        if (log.prevHash !== prevHash) {
          return { valid: false, totalEntries: logs.length, firstInvalidIndex: log.index };
        }
        
        // 重新计算 currentHash
        const hashInput = log.index + 
                         log.timestamp + 
                         log.userId + 
                         log.operationType + 
                         log.description + 
                         JSON.stringify(log.data) + 
                         log.prevHash;
        const calculatedHash = sm3(hashInput);
        
        // 检查 currentHash 是否正确
        if (log.currentHash !== calculatedHash) {
          return { valid: false, totalEntries: logs.length, firstInvalidIndex: log.index };
        }
        
        prevHash = log.currentHash;
      }
      
      return { valid: true, totalEntries: logs.length, firstInvalidIndex: null };
    } catch (error) {
      console.error('Error verifying chain:', error);
      return { valid: false, totalEntries: 0, firstInvalidIndex: 1 };
    }
  }
}

module.exports = new CryptoLogger();