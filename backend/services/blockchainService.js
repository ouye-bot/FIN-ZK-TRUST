/**
 * 区块链服务路由 - 根据配置自动选择后端实现
 *
 * 环境变量 BLOCKCHAIN_NETWORK:
 *   - "fisco-bcos" → 使用 FISCO BCOS 联盟链（默认）
 *   - "hardhat"    → 使用 Hardhat 本地私链（仅开发调试）
 *
 * 所有调用方无需修改，接口完全一致。
 */

const logger = require('../utils/logger');

const network = (process.env.BLOCKCHAIN_NETWORK || 'fisco-bcos').toLowerCase();

let delegate;

if (network === 'fisco-bcos') {
  delegate = require('./blockchainServiceFisco');
  logger.info('区块链服务路由 → FISCO BCOS 联盟链');
} else {
  delegate = require('./blockchainServiceHardhat');
  logger.info('区块链服务路由 → Hardhat 本地私链');
}

// 使用 Proxy 透明转发所有属性和方法调用
module.exports = new Proxy(delegate, {
  get(target, prop, receiver) {
    const value = Reflect.get(target, prop, receiver);
    if (typeof value === 'function') {
      return value.bind(target);
    }
    return value;
  }
});
