const fs = require('fs');
const path = require('path');
const blockchainService = require('../services/blockchainService');
const logger = require('./logger');

class Initializer {
  constructor() {
    this.initialized = false;
  }

  /**
   * 初始化系统
   * @returns {Promise<boolean>} 初始化结果
   */
  async initialize() {
    if (this.initialized) {
      logger.info('System already initialized');
      return true;
    }

    try {
      logger.info('Starting system initialization...');

      // 1. 初始化区块链服务
      logger.info('Initializing blockchain service...');
      const blockchainInitialized = await blockchainService.initialize();
      if (!blockchainInitialized) {
        logger.error('Blockchain service initialization failed');
        return false;
      }

      // 2. 检查数据文件
      await this.checkDataFiles();

      // 3. 检查目录结构
      this.checkDirectories();

      this.initialized = true;
      logger.info('System initialization completed successfully');
      return true;
    } catch (error) {
      logger.error('System initialization failed:', error);
      return false;
    }
  }

  /**
   * 检查数据文件
   * @private
   */
  async checkDataFiles() {
    const dataDir = path.join(__dirname, '../data');
    const requiredFiles = [
      'users.json',
      'transactions.json',
      'pool.json',
      'credit_history.json',
      'credit_proofs.json'
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(dataDir, file);
      if (!fs.existsSync(filePath)) {
        logger.warning(`Data file ${file} not found, creating empty file`);
        fs.writeFileSync(filePath, JSON.stringify([], null, 2));
      }
    }

    logger.info('Data files checked successfully');
  }

  /**
   * 检查目录结构
   * @private
   */
  checkDirectories() {
    const directories = [
      path.join(__dirname, '../logs'),
      path.join(__dirname, '../test_results'),
      path.join(__dirname, '../test/test_results')
    ];

    for (const dir of directories) {
      if (!fs.existsSync(dir)) {
        logger.info(`Creating directory: ${dir}`);
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    logger.info('Directory structure checked successfully');
  }

  /**
   * 检查系统状态
   * @returns {Object} 系统状态
   */
  getStatus() {
    return {
      initialized: this.initialized,
      timestamp: new Date().toISOString(),
      services: {
        blockchain: blockchainService.isInitialized
      }
    };
  }

  /**
   * 重置系统
   * @returns {Promise<boolean>} 重置结果
   */
  async reset() {
    try {
      logger.info('Resetting system...');
      
      // 重置区块链服务
      await blockchainService.reset();
      
      this.initialized = false;
      logger.info('System reset completed');
      return true;
    } catch (error) {
      logger.error('System reset failed:', error);
      return false;
    }
  }
}

module.exports = new Initializer();
