/**
 * 区块链服务模块 - 适配 Hardhat 本地私链
 * 国密SM3+私链不可篡改+ZK零知识隐私核验三合一安全架构
 * 
 * 功能：
 * 1. 连接本地私链 (http://127.0.0.1:8545, chainId: 31337)
 * 2. 自动签名上链，无需用户连接 MetaMask
 * 3. 仅存储交易数据的 SM3 哈希摘要，原始数据不上链
 * 4. 异步非阻塞处理，上链失败不打断主业务流程
 * 5. 支持多合约集成：TransactionHashStorage（兼容）、AuditStorage、ZKPVerifier
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const { generateSM3Hash } = require('../utils/cryptoUtils');
const logger = require('../utils/logger');

// Hardhat 默认私钥（账户0）- 用于自动签名上链
const HARDHAT_DEFAULT_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// 本地私链配置
const LOCAL_CHAIN_CONFIG = {
  url: 'http://127.0.0.1:8545',
  chainId: 31337,
  name: 'Hardhat Local'
};

class BlockchainService {
  constructor() {
    this.provider = null;
    this.wallet = null;
    this.contract = null; // TransactionHashStorage（兼容旧代码）
    this.auditContract = null; // AuditStorage 新合约
    this.zkpVerifierContract = null; // ZKPVerifier 新合约
    this.verifierContract = null; // Verifier 合约（Groth16 验证器）
    this.contractAddress = null;
    this.auditContractAddress = null; // AuditStorage 合约地址
    this.isInitialized = false;
    this.auditHashSent = new Set(); // 审计哈希去重
  }

  /**
   * 初始化区块链服务
   * 连接本地私链，加载所有智能合约
   */
  async initialize() {
    try {
      logger.info('开始初始化区块链服务...');

      // 1. 连接本地私链
      this.provider = new ethers.providers.JsonRpcProvider(LOCAL_CHAIN_CONFIG.url);
      
      // 验证网络连接
      const network = await this.provider.getNetwork();
      if (network.chainId !== LOCAL_CHAIN_CONFIG.chainId) {
        throw new Error(`链ID不匹配: 期望 ${LOCAL_CHAIN_CONFIG.chainId}, 实际 ${network.chainId}`);
      }
      
      logger.info('本地私链连接成功', { 
        chainId: network.chainId, 
        name: network.name,
        url: LOCAL_CHAIN_CONFIG.url 
      });

      // 2. 创建钱包（使用固定私钥自动签名）
      const privateKey = process.env.HARDHAT_PRIVATE_KEY || HARDHAT_DEFAULT_PRIVATE_KEY;
      this.wallet = new ethers.Wallet(privateKey, this.provider);
      
      const balance = await this.wallet.getBalance();
      logger.info('钱包初始化成功', { 
        address: this.wallet.address,
        balance: ethers.utils.formatEther(balance) + ' ETH'
      });

      // 3. 加载所有智能合约
      await this.loadAllContracts();

      this.isInitialized = true;
      logger.info('区块链服务初始化完成');
      return true;

    } catch (error) {
      logger.error('区块链服务初始化失败', { error: error.message });
      this.isInitialized = false;
      // 初始化失败不抛出异常，允许系统继续运行
      return false;
    }
  }

  /**
   * 通用化加载单个智能合约
   * @param {string} contractName - 合约名称
   * @returns {Promise<Object|null>} 合约实例或 null
   */
  async loadContract(contractName) {
    try {
      // 读取合约地址
      const addressesPath = path.join(__dirname, '../contract-addresses.json');
      
      if (!fs.existsSync(addressesPath)) {
        logger.warning('合约地址文件不存在，请先部署合约', { path: addressesPath });
        return null;
      }

      const addresses = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));

      // 兼容新旧格式：优先读 hardhat 段，其次顶层 contracts
      const contracts = addresses.hardhat?.contracts || addresses.contracts;
      if (!contracts || !contracts[contractName]) {
        logger.warning('合约 ' + contractName + ' 地址未配置', { path: addressesPath });
        return null;
      }

      const contractAddress = contracts[contractName];

      // 读取合约 ABI - 从 contracts 文件夹
      const abiPath = path.join(__dirname, '../../contracts/artifacts/contracts/' + contractName + '.sol/' + contractName + '.json');
      
      if (!fs.existsSync(abiPath)) {
        logger.warning('合约 ABI 文件不存在，请先编译合约', { path: abiPath, contractName });
        return null;
      }

      const abiData = JSON.parse(fs.readFileSync(abiPath, 'utf8'));
      
      // 创建合约实例
      const contract = new ethers.Contract(contractAddress, abiData.abi, this.wallet);
      
      logger.info('智能合约 ' + contractName + ' 加载成功', { address: contractAddress });
      return contract;

    } catch (error) {
      logger.error('加载智能合约 ' + contractName + ' 失败', { error: error.message });
      return null;
    }
  }

  /**
   * 加载所有合约
   */
  async loadAllContracts() {
    try {
      this.contract = await this.loadContract('TransactionHashStorage');
      this.auditContract = await this.loadContract('AuditStorage');
      this.zkpVerifierContract = await this.loadContract('ZKPVerifier');
      this.verifierContract = await this.loadContract('Verifier');

      // 存储 AuditStorage 合约地址（供查询方法使用）
      if (this.auditContract) {
        this.auditContractAddress = this.auditContract.address;
      }

      logger.info('所有合约加载完成', {
        TransactionHashStorage: !!this.contract,
        AuditStorage: !!this.auditContract,
        ZKPVerifier: !!this.zkpVerifierContract,
        Verifier: !!this.verifierContract
      });

      return true;
    } catch (error) {
      logger.error('加载所有合约失败', { error: error.message });
      return false;
    }
  }

  /**
   * 生成 SM3 哈希（批量处理支持）
   * @param {Array|Object} data - 交易数据或数据数组
   * @returns {string|Array} SM3 哈希值或哈希数组
   */
  generateSM3Hash(data) {
    try {
      if (Array.isArray(data)) {
        // 批量处理
        return data.map(item => {
          const dataStr = typeof item === 'string' ? item : JSON.stringify(item);
          return generateSM3Hash(dataStr);
        });
      } else {
        // 单条处理
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        return generateSM3Hash(dataStr);
      }
    } catch (error) {
      logger.error('生成 SM3 哈希失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 将 SM3 哈希转换为 bytes32 格式
   * @param {string} sm3Hash - SM3 哈希字符串（64位十六进制）
   * @returns {string} bytes32 格式
   */
  convertSM3ToBytes32(sm3Hash) {
    try {
      // 移除 0x 前缀（如果有）
      const cleanHash = sm3Hash.startsWith('0x') ? sm3Hash.slice(2) : sm3Hash;
      
      // SM3 哈希是 64 字符（256位），需要转换为 32 字节
      const paddedHash = cleanHash.padStart(64, '0').slice(0, 64);
      
      return '0x' + paddedHash;
    } catch (error) {
      logger.error('转换 SM3 哈希格式失败', { error: error.message, sm3Hash });
      throw error;
    }
  }

  /**
   * 存储审计哈希到区块链（异步非阻塞）- 使用 AuditStorage 合约
   * @param {string} sm3Hash - SM3 哈希值
   * @param {number} timestamp - 时间戳
   * @param {string} transactionType - 交易类型
   * @param {string|number} userId - 用户ID
   * @returns {Promise<Object>} 上链结果
   */
  storeAuditHash(sm3Hash, timestamp, transactionType, userId) {
    if (!this.isInitialized || !this.auditContract) {
      logger.warning('区块链服务或 AuditStorage 合约未初始化，跳过审计存证', { sm3Hash: sm3Hash.substring(0, 20) + '...' });
      return Promise.resolve({ success: false, skipped: true, error: 'Blockchain service or AuditStorage not initialized' });
    }

    if (this.auditHashSent.has(sm3Hash)) {
      logger.warning('审计哈希已发送过，跳过', { sm3Hash: sm3Hash.substring(0, 20) + '...' });
      return Promise.resolve({ success: false, skipped: true, reason: 'duplicate' });
    }

    this.auditHashSent.add(sm3Hash);

    logger.info('准备审计上链存证', { 
      sm3Hash: sm3Hash.substring(0, 20) + '...',
      transactionType,
      userId
    });

    // 转为 bytes32 格式（0x 前缀 + 64 位 hex）
    const hashBytes32 = sm3Hash.startsWith('0x') ? sm3Hash : '0x' + sm3Hash;

    return this.auditContract.storeAuditHash(
      hashBytes32,
      timestamp,
      transactionType,
      userId.toString()
    ).then(tx => tx.wait())
    .then(receipt => {
      logger.info('审计哈希上链存证成功', {
        sm3Hash: sm3Hash.substring(0, 20) + '...',
        blockchainTxHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
      });
      return {
        success: true,
        sm3Hash,
        blockchainTxHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
      };
    })
    .catch(error => {
      this.auditHashSent.delete(sm3Hash);
      logger.error('审计哈希上链存证失败', { error: error.message, sm3Hash: sm3Hash.substring(0, 20) + '...' });
      return { 
        success: false, 
        error: error.message 
      };
    });
  }

  /**
   * 注册用户公钥锚定到区块链（异步非阻塞）
   * @param {string|number} userId - 用户ID
   * @param {string} publicKey - SM2 公钥
   * @returns {Promise<Object>} 上链结果
   */
  registerUserOnChain(userId, publicKey) {
    if (!this.isInitialized || !this.auditContract) {
      logger.warning('区块链服务或 AuditStorage 合约未初始化，跳过用户注册', { userId });
      return Promise.resolve({ success: false, skipped: true });
    }

    try {
      const pkHash = this.generateSM3Hash(publicKey);
      const timestamp = Math.floor(Date.now() / 1000);
      
      logger.info('准备用户公钥锚定上链', { userId, pkHash: pkHash.substring(0, 20) + '...' });

      return this.storeAuditHash(pkHash, timestamp, 'REGISTER', userId)
        .then(result => {
          if (result.success) {
            logger.info('用户公钥锚定上链成功', { userId, pkHash: pkHash.substring(0, 20) + '...' });
          }
          return { ...result, pkHash };
        });
    } catch (error) {
      logger.error('用户公钥锚定上链失败', { error: error.message, userId });
      return Promise.resolve({ success: false, error: error.message });
    }
  }

  /**
   * 记录 ZKP 验证结果到区块链（异步非阻塞）
   * @param {string|number} proofId - 证明ID
   * @param {boolean} isValid - 是否有效
   * @param {string} proofHash - 证明哈希
   * @returns {Promise<Object>} 上链结果
   */
  recordZKPResult(proofId, isValid, proofHash) {
    if (!this.isInitialized || !this.zkpVerifierContract) {
      logger.warning('区块链服务或 ZKPVerifier 合约未初始化，跳过 ZKP 存证', { proofId });
      return Promise.resolve({ success: false, skipped: true });
    }

    const proofIdBytes32 = ethers.utils.formatBytes32String(proofId.toString().slice(0, 31));

    logger.info('准备 ZKP 验证结果上链', { 
      proofId, 
      isValid,
      proofHash: proofHash.substring(0, 20) + '...'
    });

    return this.zkpVerifierContract.recordProofResult(
      proofIdBytes32, isValid, proofHash
    ).then(tx => tx.wait())
    .then(receipt => {
      logger.info('ZKP 验证结果上链成功', {
        proofId,
        isValid,
        blockchainTxHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
      });
      return {
        success: true,
        blockchainTxHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber
      };
    })
    .catch(error => {
      logger.error('ZKP 验证结果上链失败', { error: error.message, proofId });
      return { 
        success: false, 
        error: error.message 
      };
    });
  }

  /**
   * 存储交易哈希到区块链（向后兼容 - 内部调用 AuditStorage）
   * @param {string} transactionId - 交易唯一标识符
   * @param {Object} transactionData - 交易数据
   * @param {string} transactionType - 交易类型
   * @param {string} userId - 用户ID
   * @returns {Promise<Object>} 上链结果
   */
  async storeTransactionHash(transactionId, transactionData, transactionType, userId) {
    // 如果未初始化，记录警告但不阻塞业务流程
    if (!this.isInitialized) {
      logger.warning('区块链服务未初始化，跳过链上存证', { transactionId });
      return { success: false, error: 'Blockchain service not initialized', skipped: true };
    }

    try {
      const sm3Hash = this.generateSM3Hash(transactionData);
      const timestamp = Math.floor(Date.now() / 1000);
      
      logger.info('准备交易哈希上链存证（向后兼容）', { 
        transactionId, 
        transactionType, 
        userId,
        sm3Hash: sm3Hash.substring(0, 20) + '...'
      });

      return this.storeAuditHash(sm3Hash, timestamp, transactionType, userId);
    } catch (error) {
      logger.error('交易哈希上链存证失败', { error: error.message, transactionId });
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  /**
   * 批量存储交易哈希
   * @param {Array} transactions - 交易数组
   * @returns {Promise<Array>} 上链结果数组
   */
  async storeTransactionHashesBatch(transactions) {
    if (!this.isInitialized) {
      logger.warning('区块链服务未初始化，跳过批量链上存证');
      return transactions.map(tx => {
        return { ...tx, blockchainResult: { success: false, skipped: true } };
      });
    }

    const results = [];
    
    for (const tx of transactions) {
      const result = await this.storeTransactionHash(
        tx.transactionId,
        tx.transactionData,
        tx.transactionType,
        tx.userId
      );
      
      results.push({
        ...tx,
        blockchainResult: result
      });
    }

    return results;
  }

  /**
   * 验证交易哈希（向后兼容 - 使用旧的 TransactionHashStorage 合约）
   * @param {string} transactionId - 交易唯一标识符
   * @param {Object} transactionData - 交易数据
   * @returns {Promise<Object>} 验证结果
   */
  async verifyTransactionHash(transactionId, transactionData) {
    if (!this.isInitialized || !this.contract) {
      logger.warning('区块链服务未初始化，无法验证交易哈希');
      return { success: false, error: 'Blockchain service not initialized' };
    }

    try {
      const calculatedHash = this.generateSM3Hash(transactionData);
      const calculatedHashBytes32 = this.convertSM3ToBytes32(calculatedHash);
      
      const txIdBytes32 = ethers.utils.formatBytes32String(transactionId.toString().slice(0, 31));
      
      const storedRecord = await this.contract.getTransactionHash(txIdBytes32);
      const storedHash = storedRecord.sm3Hash;
      
      const isValid = storedHash === calculatedHashBytes32;
      
      logger.info('交易哈希验证完成（旧合约）', {
        transactionId,
        isValid
      });

      return {
        success: true,
        isValid,
        storedHash,
        calculatedHash: calculatedHashBytes32,
        timestamp: storedRecord.timestamp.toNumber(),
        transactionType: storedRecord.transactionType,
        userId: storedRecord.userId
      };

    } catch (error) {
      logger.info('验证交易哈希: 链上无此记录', { transactionId });
      return { success: true, isValid: false, reason: '链上无此记录' };
    }
  }

  /**
   * 获取交易总数
   * @returns {Promise<number>} 交易总数
   */
  async getTransactionCount() {
    if (!this.isInitialized || !this.auditContract) {
      return 0;
    }

    try {
      const count = await this.auditContract.getTotalRecords();
      return count.toNumber();
    } catch (error) {
      logger.error('获取交易总数失败', { error: error.message });
      return 0;
    }
  }

  /**
   * 按哈希查询链上记录（兼容 FISCO BCOS 接口）
   */
  async getRecordByHash(sm3Hash) {
    if (!this.isInitialized || !this.auditContractAddress) return null;
    try {
      const hashBytes32 = sm3Hash.startsWith('0x') ? sm3Hash : '0x' + sm3Hash;
      const auditContract = new ethers.Contract(
        this.auditContractAddress,
        ['function getRecordByHash(bytes32) view returns (uint256, address, string, string)'],
        this.wallet
      );
      const result = await auditContract.getRecordByHash(hashBytes32);
      return {
        timestamp: result[0].toNumber(),
        submitter: result[1],
        operationType: result[2],
        userId: result[3]
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 按索引查询链上记录（兼容 FISCO BCOS 接口）
   */
  async getRecordByIndex(index) {
    if (!this.isInitialized || !this.auditContractAddress) return null;
    try {
      const auditContract = new ethers.Contract(
        this.auditContractAddress,
        ['function getRecordByIndex(uint256) view returns (bytes32, uint256, address, string, string)'],
        this.wallet
      );
      const result = await auditContract.getRecordByIndex(index);
      return {
        hashValue: result[0],  // bytes32 hex string
        timestamp: result[1].toNumber(),
        submitter: result[2],
        operationType: result[3],
        userId: result[4]
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取链上记录总数（兼容 FISCO BCOS 接口）
   */
  async getTotalRecords() {
    if (!this.isInitialized || !this.auditContractAddress) return 0;
    try {
      const auditContract = new ethers.Contract(
        this.auditContractAddress,
        ['function getTotalRecords() view returns (uint256)'],
        this.wallet
      );
      const count = await auditContract.getTotalRecords();
      return count.toNumber();
    } catch (error) {
      return 0;
    }
  }

  /**
   * 获取浏览器概览数据
   */
  async getExplorerData(limit = 20) {
    const totalRecords = await this.getTotalRecords();
    const recentRecords = [];
    const start = Math.max(0, totalRecords - limit);
    for (let i = start; i < totalRecords; i++) {
      const record = await this.getRecordByIndex(i);
      if (record) recentRecords.push({ index: i, ...record });
    }
    return { totalRecords, recentRecords };
  }

  /**
   * 链上验证 Groth16 ZKP 证明（通过 Verifier 合约）
   * @param {Object} proof - Groth16 证明对象 { pi_a, pi_b, pi_c }
   * @param {Array} publicSignals - 公共信号
   * @param {string} userAddress - 用户地址
   * @param {string} sm3Hash - SM3 哈希（bytes32）
   * @returns {Promise<Object>} 验证结果
   */
  async verifyZKPOnChain(proof, publicSignals, userAddress, sm3Hash) {
    try {
      if (!this.isInitialized || !this.verifierContract) {
        return { success: false, error: 'Verifier contract not available' };
      }
      if (!userAddress || !sm3Hash) {
        return { success: false, error: '缺少必要参数 userAddress 或 sm3Hash' };
      }

      const pA = [proof.pi_a[0], proof.pi_a[1]];
      const pB = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]];
      const pC = [proof.pi_c[0], proof.pi_c[1]];
      const pubSignals = publicSignals.map(s => s.toString());
      const sm3Bytes32 = sm3Hash.startsWith('0x') ? sm3Hash : '0x' + sm3Hash;

      const tx = await this.verifierContract.verifyProof(userAddress, pA, pB, pC, pubSignals, sm3Bytes32);
      const receipt = await tx.wait();
      return { success: true, blockchainTxHash: receipt.transactionHash };
    } catch (error) {
      logger.error('Hardhat 链上 ZKP 验证失败', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 更新 ZKP 链上验证状态
   * @param {string} proofId - 证明ID
   * @param {boolean} chainValid - 链上验证是否通过
   * @returns {Promise<Object>} 上链结果
   */
  async updateZKPChainStatus(proofId, chainValid) {
    try {
      if (!this.isInitialized || !this.zkpVerifierContract) {
        return { success: false, error: 'ZKPVerifier contract not available' };
      }
      const proofIdBytes32 = ethers.utils.formatBytes32String(proofId.toString().slice(0, 31));
      const tx = await this.zkpVerifierContract.updateChainStatus(proofIdBytes32, chainValid);
      const receipt = await tx.wait();
      return { success: true, blockchainTxHash: receipt.transactionHash };
    } catch (error) {
      logger.error('Hardhat ZKP 链上状态更新失败', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * 查询 ZKP 验证结果
   * @param {string} proofId - 证明ID
   * @returns {Promise<Object|null>} 验证结果或 null
   */
  async getZKPResult(proofId) {
    try {
      if (!this.isInitialized || !this.zkpVerifierContract) {
        return null;
      }
      const proofIdBytes32 = proofId.startsWith('0x') && proofId.length === 66
        ? proofId
        : '0x' + Buffer.from(proofId.toString().slice(0, 31)).toString('hex').padEnd(64, '0');
      const result = await this.zkpVerifierContract.getProofResult(proofIdBytes32);
      return {
        isValid: result[0],
        timestamp: result[1].toNumber(),
        submitter: result[2],
        proofHash: result[3],
        chainVerified: result[4],
        chainValid: result[5]
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取服务状态
   * @returns {Object} 服务状态信息
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      walletAddress: this.wallet ? this.wallet.address : null,
      network: LOCAL_CHAIN_CONFIG,
      contracts: {
        TransactionHashStorage: !!this.contract,
        AuditStorage: !!this.auditContract,
        ZKPVerifier: !!this.zkpVerifierContract,
        Verifier: !!this.verifierContract
      }
    };
  }
}

// 导出单例实例
module.exports = new BlockchainService();
