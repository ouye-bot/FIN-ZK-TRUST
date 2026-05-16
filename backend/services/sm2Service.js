const { generateSM2KeyPair, signWithSM2, verifySM2Signature } = require('../utils/cryptoUtils');
const logger = require('../utils/logger');

class SM2Service {
  constructor() {
    this.cache = new Map();
  }

  /**
   * 生成SM2密钥对
   * @returns {Object} 包含公钥和私钥的对象
   */
  generateKeyPair() {
    try {
      const keyPair = generateSM2KeyPair();
      logger.info('SM2 key pair generated successfully');
      return keyPair;
    } catch (error) {
      logger.error('SM2 key pair generation failed:', error);
      throw error;
    }
  }

  /**
   * 使用SM2私钥签名
   * @param {string} message - 要签名的消息
   * @param {string} privateKey - SM2私钥
   * @returns {string} 签名结果
   */
  sign(message, privateKey) {
    try {
      const signature = signWithSM2(message, privateKey);
      logger.info('SM2 signature generated successfully');
      return signature;
    } catch (error) {
      logger.error('SM2 signature generation failed:', error);
      throw error;
    }
  }

  /**
   * 验证SM2签名
   * @param {string} message - 原始消息
   * @param {string} signature - 签名
   * @param {string} publicKey - SM2公钥
   * @returns {boolean} 验证结果
   */
  verify(message, signature, publicKey) {
    try {
      const cacheKey = `${message}-${signature}-${publicKey}`;
      
      // 检查缓存
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }
      
      const isValid = verifySM2Signature(message, signature, publicKey);
      
      // 缓存结果
      this.cache.set(cacheKey, isValid);
      
      // 限制缓存大小
      if (this.cache.size > 1000) {
        const firstKey = this.cache.keys().next().value;
        this.cache.delete(firstKey);
      }
      
      logger.info('SM2 signature verification result:', {
        result: isValid,
        message,
        signature: signature.substring(0, 10) + '...',
        publicKey: publicKey.substring(0, 20) + '...'
      });
      
      return isValid;
    } catch (error) {
      logger.error('SM2 signature verification failed:', error);
      return false;
    }
  }

  /**
   * 批量验证SM2签名
   * @param {Array} items - 包含message, signature, publicKey的对象数组
   * @returns {Array} 验证结果数组
   */
  batchVerify(items) {
    try {
      const results = items.map(item => {
        return {
          ...item,
          valid: this.verify(item.message, item.signature, item.publicKey)
        };
      });
      
      logger.info(`SM2 batch verification completed: ${results.length} items`);
      return results;
    } catch (error) {
      logger.error('SM2 batch verification failed:', error);
      return items.map(item => ({ ...item, valid: false }));
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.cache.clear();
    logger.info('SM2 verification cache cleared');
  }

  /**
   * 获取缓存大小
   * @returns {number} 缓存大小
   */
  getCacheSize() {
    return this.cache.size;
  }
}

module.exports = new SM2Service();
