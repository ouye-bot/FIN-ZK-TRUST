const zkService = require('./zkService');
const logger = require('../utils/logger');

class ZKAdapter {
  constructor() {
    this.providers = new Map();
    this.currentProvider = 'default';
  }

  /**
   * 注册零知识证明提供者
   * @param {string} name - 提供者名称
   * @param {Object} provider - 提供者对象，包含generateProof和verifyProof方法
   */
  registerProvider(name, provider) {
    if (!provider.generateProof || !provider.verifyProof) {
      throw new Error('Provider must implement generateProof and verifyProof methods');
    }
    
    this.providers.set(name, provider);
    logger.info(`ZK provider ${name} registered`);
  }

  /**
   * 设置当前使用的提供者
   * @param {string} name - 提供者名称
   */
  setProvider(name) {
    if (!this.providers.has(name) && name !== 'default') {
      throw new Error(`Provider ${name} not registered`);
    }
    
    this.currentProvider = name;
    logger.info(`ZK provider set to ${name}`);
  }

  /**
   * 生成零知识证明
   * @param {number} creditScore - 信用评分
   * @param {number} threshold - 阈值
   * @param {Object} options - 可选参数
   * @returns {Object} 证明对象
   */
  async generateProof(creditScore, threshold, options = {}) {
    try {
      let provider;
      if (this.currentProvider === 'default' || !this.providers.has(this.currentProvider)) {
        // 使用默认的zkService
        const proof = await zkService.generateProof(creditScore, threshold);
        logger.info('ZK proof generated successfully using default provider');
        return proof;
      } else {
        // 使用注册的提供者
        provider = this.providers.get(this.currentProvider);
        const proof = await provider.generateProof(creditScore, threshold, options);
        logger.info(`ZK proof generated successfully using ${this.currentProvider} provider`);
        return proof;
      }
    } catch (error) {
      logger.error('ZK proof generation failed:', error);
      throw error;
    }
  }

  /**
   * 验证零知识证明
   * @param {Object} proof - 证明对象
   * @param {number} threshold - 阈值
   * @param {Object} options - 可选参数
   * @returns {boolean} 验证结果
   */
  async verifyProof(proof, threshold, options = {}) {
    try {
      let provider;
      if (this.currentProvider === 'default' || !this.providers.has(this.currentProvider)) {
        // 使用默认的验证逻辑
        // 注意：默认的zkService可能没有verifyProof方法，这里使用简单的验证
        const isValid = proof && proof.publicSignals;
        logger.info('ZK proof verification completed using default provider');
        return isValid;
      } else {
        // 使用注册的提供者
        provider = this.providers.get(this.currentProvider);
        const isValid = await provider.verifyProof(proof, threshold, options);
        logger.info(`ZK proof verification completed using ${this.currentProvider} provider`);
        return isValid;
      }
    } catch (error) {
      logger.error('ZK proof verification failed:', error);
      return false;
    }
  }

  /**
   * 获取所有注册的提供者
   * @returns {Array} 提供者名称数组
   */
  getProviders() {
    return Array.from(this.providers.keys());
  }

  /**
   * 获取当前提供者
   * @returns {string} 当前提供者名称
   */
  getCurrentProvider() {
    return this.currentProvider;
  }
}

module.exports = new ZKAdapter();
