// 前端缓存管理工具
import { get } from './apiUtils';

/**
 * 缓存管理工具类
 */
class CacheManager {
  constructor() {
    this.config = {
      maxSize: 5 * 1024 * 1024, // 5MB
      defaultExpiry: 30 * 60 * 1000 // 30分钟
    };
  }

  /**
   * 设置缓存
   * @param {string} key - 缓存键
   * @param {any} value - 缓存值
   * @param {number} expiry - 过期时间（毫秒）
   */
  set(key, value, expiry = this.config.defaultExpiry) {
    const cacheData = {
      value,
      timestamp: Date.now(),
      expiry: Date.now() + expiry
    };

    // 检查缓存大小
    this.checkSize();

    try {
      localStorage.setItem(key, JSON.stringify(cacheData));
    } catch (error) {
      console.error('设置缓存失败:', error);
      // 清理部分缓存后重试
      this.cleanupOldest();
      try {
        localStorage.setItem(key, JSON.stringify(cacheData));
      } catch (retryError) {
        console.error('重试设置缓存失败:', retryError);
      }
    }
  }

  /**
   * 获取缓存
   * @param {string} key - 缓存键
   * @returns {any} 缓存值或null
   */
  get(key) {
    try {
      const cachedData = localStorage.getItem(key);
      if (!cachedData) return null;

      const { value, expiry } = JSON.parse(cachedData);
      if (Date.now() > expiry) {
        localStorage.removeItem(key);
        return null;
      }
      return value;
    } catch (error) {
      console.error('获取缓存失败:', error);
      return null;
    }
  }

  /**
   * 检查缓存大小
   */
  checkSize() {
    let totalSize = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        totalSize += localStorage[key].length;
      }
    }

    // 如果超过最大大小，清理最旧的缓存
    if (totalSize > this.config.maxSize) {
      this.cleanupOldest();
    }
  }

  /**
   * 清理最旧的缓存
   */
  cleanupOldest() {
    const cacheItems = [];
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        try {
          const cachedData = JSON.parse(localStorage[key]);
          if (cachedData.timestamp) {
            cacheItems.push({
              key,
              timestamp: cachedData.timestamp
            });
          }
        } catch (error) {
          // 忽略非JSON格式的缓存
        }
      }
    }

    // 按时间排序，删除最旧的
    cacheItems.sort((a, b) => a.timestamp - b.timestamp);
    while (cacheItems.length > 0) {
      const oldest = cacheItems.shift();
      localStorage.removeItem(oldest.key);

      // 再次检查大小
      let totalSize = 0;
      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          totalSize += localStorage[key].length;
        }
      }

      if (totalSize <= this.config.maxSize) {
        break;
      }
    }
  }

  /**
   * 清理所有过期缓存
   */
  cleanupExpired() {
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        try {
          const cachedData = JSON.parse(localStorage[key]);
          if (cachedData.expiry && Date.now() > cachedData.expiry) {
            localStorage.removeItem(key);
          }
        } catch (error) {
          // 忽略非JSON格式的缓存
        }
      }
    }
  }

  /**
   * 获取缓存使用情况
   * @returns {Object} 缓存统计信息
   */
  getStats() {
    let totalSize = 0;
    let itemCount = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        totalSize += localStorage[key].length;
        itemCount++;
      }
    }

    return {
      totalSize,
      itemCount,
      maxSize: this.config.maxSize,
      usagePercent: (totalSize / this.config.maxSize) * 100
    };
  }

  /**
   * 删除指定缓存
   * @param {string} key - 缓存键
   */
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.error('删除缓存失败:', error);
    }
  }

  /**
   * 清空所有缓存
   */
  clear() {
    try {
      localStorage.clear();
    } catch (error) {
      console.error('清空缓存失败:', error);
    }
  }
}

// 创建缓存管理器实例
const cacheManager = new CacheManager();

/**
 * 信用证明缓存管理
 */
export const CreditProofCache = {
  /**
   * 存储信用证明
   * @param {Object} proof - 信用证明
   * @param {string|number} userId - 用户ID
   */
  setProof(proof, userId) {
    const key = `creditProof_${userId}`;
    cacheManager.set(key, proof, 24 * 60 * 60 * 1000); // 24小时过期
  },

  /**
   * 获取信用证明
   * @param {string|number} userId - 用户ID
   * @returns {Object|null} 信用证明或null
   */
  getProof(userId) {
    const key = `creditProof_${userId}`;
    return cacheManager.get(key);
  },

  /**
   * 检查信用证明是否有效
   * @param {string|number} userId - 用户ID
   * @returns {boolean} 是否有效
   */
  isProofValid(userId) {
    return this.getProof(userId) !== null;
  },

  /**
   * 清除信用证明缓存
   * @param {string|number} userId - 用户ID
   */
  clearProof(userId) {
    const key = `creditProof_${userId}`;
    cacheManager.remove(key);
  }
};

/**
 * 用户数据缓存管理
 */
export const UserDataCache = {
  /**
   * 存储用户数据
   * @param {Object} userData - 用户数据
   */
  setUserData(userData) {
    cacheManager.set('userData', userData, 30 * 60 * 1000); // 30分钟过期
  },

  /**
   * 获取用户数据
   * @returns {Object|null} 用户数据或null
   */
  getUserData() {
    return cacheManager.get('userData');
  },

  /**
   * 强制刷新用户数据
   * @param {string} userId - 用户ID
   * @param {string} token - 认证令牌
   * @returns {Promise<Object|null>} 刷新后的用户数据
   */
  async refreshUserData(userId, token) {
    try {
      const response = await get(`/api/v1/users/${userId}`);

      const userData = await response.json();
      if (userData.success) {
        this.setUserData(userData.user);
        return userData.user;
      }
      return null;
    } catch (error) {
      console.error('刷新用户数据失败:', error);
      return null;
    }
  },

  /**
   * 清除用户数据缓存
   */
  clearUserData() {
    cacheManager.remove('userData');
  }
};

/**
 * 导出缓存管理器
 */
export { cacheManager };

// 在应用启动时清理过期缓存
cacheManager.cleanupExpired();
