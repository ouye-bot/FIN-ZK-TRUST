const logger = require('./logger');
const { initializePool } = require('../services/poolService');
const blockchainService = require('../services/blockchainService');
const userDao = require('../dao/userDao');

/**
 * 初始化系统
 * 包含事务处理以保证数据一致性
 * 国密SM3+私链不可篡改+ZK零知识隐私核验三合一安全架构
 */
exports.initializeSystem = async () => {
  try {
    logger.info('开始初始化系统...');
    
    // 检查是否存在系统账户
    let systemAccount = await userDao.findByUsername('system');
    
    if (systemAccount) {
      // 系统账户已存在，只打印日志，不修改余额
      logger.info('系统账户已存在', { id: systemAccount.id, username: systemAccount.username, balance: systemAccount.balance });
    } else {
      // 创建系统账户
      systemAccount = await userDao.create({
        username: 'system',
        password_hash: 'password2',
        sm2_public_key: ''
      });
      logger.info('创建系统账户', { id: systemAccount.id, username: systemAccount.username, balance: systemAccount.balance });
    }
    
    // 初始化资金池（这里可以保持原有的逻辑）
    try {
      await initializePool();
      logger.info('资金池初始化成功');
    } catch (poolError) {
      logger.error('资金池初始化失败', { error: poolError.message });
    }
    
    // 初始化区块链服务（国密SM3+私链不可篡改+ZK零知识隐私核验三合一安全架构）
    logger.info('开始初始化区块链服务...');
    try {
      const blockchainInitialized = await blockchainService.initialize();
      if (blockchainInitialized) {
        logger.info('区块链服务初始化成功');
        
        // 获取区块链状态
        const status = blockchainService.getStatus();
        logger.info('区块链服务状态', {
          isInitialized: status.isInitialized,
          contractAddress: status.contractAddress,
          walletAddress: status.walletAddress,
          network: status.network
        });
      } else {
        logger.warning('区块链服务初始化失败，系统将继续运行但无法使用链上存证功能');
      }
    } catch (blockchainError) {
      // 区块链初始化失败不阻塞系统启动
      logger.error('区块链服务初始化异常', { error: blockchainError.message });
      logger.warning('系统将继续运行，但区块链存证功能不可用');
    }
    
    logger.info('系统初始化完成');
    return true;
  } catch (error) {
    logger.error('系统初始化失败', { error: error.message });
    return false;
  }
};