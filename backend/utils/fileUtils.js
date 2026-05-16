const fs = require('fs').promises;
const path = require('path');

// 内存缓存
const memoryCache = new Map();
// 文件锁
const fileLocks = new Map();

/**
 * 读取JSON文件，使用内存缓存减少I/O操作
 * @param {string} filename - 文件名
 * @returns {Promise<any>} - 解析后的数据
 */
const readJsonFile = async (filename) => {
  try {
    if (memoryCache.has(filename)) {
      return memoryCache.get(filename);
    }

    const filePath = path.join(__dirname, '../data', filename);
    const data = await fs.readFile(filePath, 'utf8');
    
    // 确保数据是有效的JSON
    let parsed;
    try {
      parsed = JSON.parse(data);
    } catch (parseError) {
      console.error('JSON parse error:', parseError);
      // 根据文件名返回不同的默认值
      if (filename === 'pool.json') {
        return null;
      }
      return [];
    }

    // 更新缓存
    memoryCache.set(filename, parsed);
    return parsed;
  } catch (error) {
    console.error('Error reading file:', error);
    if (error.code === 'ENOENT') {
      // 如果文件不存在，根据文件名返回不同的默认值
      let defaultValue = [];
      if (filename === 'pool.json') {
        defaultValue = null;
      }
      memoryCache.set(filename, defaultValue);
      return defaultValue;
    }
    throw error;
  }
};

/**
 * 写入JSON文件，使用文件锁确保数据一致性
 * @param {string} filename - 文件名
 * @param {any} data - 要写入的数据
 * @returns {Promise<void>}
 */
const writeJsonFile = async (filename, data) => {
  try {
    const filePath = path.join(__dirname, '../data', filename);
    
    // 获取文件锁
    const lockKey = `lock_${filename}`;
    while (fileLocks.has(lockKey)) {
      // 等待锁释放
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // 加锁
    fileLocks.set(lockKey, true);
    
    try {
      // 写入文件
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      // 更新缓存
      memoryCache.set(filename, data);
    } finally {
      // 释放锁
      fileLocks.delete(lockKey);
    }
  } catch (error) {
    console.error('Error writing file:', error);
    throw error;
  }
};

/**
 * 清除指定文件的缓存
 * @param {string} filename - 文件名
 */
const clearCache = (filename) => {
  memoryCache.delete(filename);
};

/**
 * 清除所有缓存
 */
const clearAllCache = () => {
  memoryCache.clear();
};

module.exports = {
  readJsonFile,
  writeJsonFile,
  clearCache,
  clearAllCache
};
