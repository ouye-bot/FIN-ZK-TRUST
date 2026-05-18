/**
 * 区块链服务模块 - 适配 FISCO BCOS 联盟链
 * 国密SM3+联盟链不可篡改+ZK零知识隐私核验三合一安全架构
 *
 * FISCO BCOS 2.x 使用 Channel 协议进行交易签名（SM2），JSON-RPC 仅支持读操作。
 * 写操作通过调用 FISCO BCOS Java Console 子进程实现。
 *
 * 功能：
 * 1. 连接 FISCO BCOS 联盟链 (JSON-RPC for reads, Console for writes)
 * 2. 与 blockchainService.js 接口完全一致
 * 3. 仅存储交易数据的 SM3 哈希摘要，原始数据不上链
 * 4. 异步非阻塞处理，上链失败不打断主业务流程
 * 5. 支持多合约：AuditStorage、ZKPVerifier
 */

const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const { generateSM3Hash } = require('../utils/cryptoUtils');
const logger = require('../utils/logger');

// FISCO BCOS 配置
const FISCO_CONFIG = {
  rpcUrl: process.env.FISCO_BCOS_RPC_URL || 'http://127.0.0.1:8545',
  groupId: parseInt(process.env.FISCO_BCOS_GROUP_ID || '1'),
  chainId: parseInt(process.env.FISCO_BCOS_CHAIN_ID || '1'),
  consolePath: process.env.FISCO_BCOS_CONSOLE_PATH || path.join(require('os').homedir(), 'fisco-bcos-node/console'),
  name: 'FISCO BCOS Consortium'
};

// JSON-RPC 工具
function rpcCall(method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() });
    const url = new URL(FISCO_CONFIG.rpcUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname || '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message));
          else resolve(parsed.result);
        } catch (e) {
          reject(new Error(`RPC parse error: ${data.substring(0, 200)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(body);
    req.end();
  });
}

// 通过 FISCO BCOS Console 执行写操作
function consoleExec(groupId, command) {
  return new Promise((resolve, reject) => {
    const consoleDir = FISCO_CONFIG.consolePath;
    const javaArgs = `-Djdk.tls.namedGroups="SM2,secp256k1,x25519,secp256r1,secp384r1,secp521r1" -cp "apps/*:conf/:lib/*:classes/:accounts/" console.Console ${groupId}`;

    if (process.platform === 'win32') {
      // Windows: 写入临时脚本避免嵌套引号转义问题
      const tmpFile = path.join(require('os').tmpdir(), `fisco_cmd_${Date.now()}.sh`);
      const script = `#!/bin/bash\ncd "${consoleDir}" && printf '${command}\\nquit\\n' | java ${javaArgs} 2>&1`;
      fs.writeFileSync(tmpFile, script);

      const wslPath = tmpFile.replace(/\\/g, '/').replace(/^([A-Z]):/i, (_, d) => `/mnt/${d.toLowerCase()}`);
      const cmd = `wsl -e bash "${wslPath}"`;

      exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        try { fs.unlinkSync(tmpFile); } catch (_) {}
        if (error && !stdout) {
          reject(new Error(`Console exec failed: ${error.message}`));
          return;
        }
        resolve(stdout || stderr);
      });
    } else {
      const cmd = `cd "${consoleDir}" && printf '${command}\\nquit\\n' | java ${javaArgs} 2>&1`;
      exec(cmd, { timeout: 30000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(new Error(`Console exec failed: ${error.message}`));
          return;
        }
        resolve(stdout || stderr);
      });
    }
  });
}

// 从 console 输出中解析合约地址和交易哈希
function parseDeployResult(output) {
  const addressMatch = output.match(/contract address:\s*(0x[0-9a-fA-F]+)/);
  const txHashMatch = output.match(/transaction hash:\s*(0x[0-9a-fA-F]+)/);
  return {
    contractAddress: addressMatch ? addressMatch[1] : null,
    transactionHash: txHashMatch ? txHashMatch[1] : null
  };
}

// 从 console call 输出中解析返回值
function parseCallResult(output) {
  const outputMatch = output.match(/Return values:\s*\[([^\]]*)\]/);
  if (outputMatch) return outputMatch[1].trim();
  // Fallback: look for output after "Return:" or hex value
  const hexMatch = output.match(/(0x[0-9a-fA-F]+)/);
  return hexMatch ? hexMatch[1] : null;
}

class BlockchainServiceFisco {
  constructor() {
    this.provider = null; // 仅用于 JSON-RPC 读操作
    this.auditContractAddress = null;
    this.zkpVerifierContractAddress = null;
    this.auditAbi = null;
    this.zkpVerifierAbi = null;
    this.isInitialized = false;
    this.auditHashSent = new Set();
    this.networkName = 'fisco-bcos';
  }

  /**
   * 初始化 FISCO BCOS 区块链服务
   */
  async initialize() {
    try {
      logger.info('开始初始化 FISCO BCOS 区块链服务...', { config: FISCO_CONFIG });

      // 1. 验证 JSON-RPC 连接
      const version = await rpcCall('getClientVersion');
      logger.info('FISCO BCOS 节点连接成功', {
        version: version['FISCO-BCOS Version'],
        chainId: version['Chain Id'],
        rpcUrl: FISCO_CONFIG.rpcUrl
      });

      // 2. 加载合约地址和 ABI
      await this.loadContracts();

      this.isInitialized = true;
      logger.info('FISCO BCOS 区块链服务初始化完成');
      return true;
    } catch (error) {
      logger.error('FISCO BCOS 区块链服务初始化失败', { error: error.message });
      this.isInitialized = false;
      return false;
    }
  }

  /**
   * 加载合约配置
   */
  async loadContracts() {
    try {
      const addressesPath = path.join(__dirname, '../contract-addresses.json');
      if (!fs.existsSync(addressesPath)) {
        logger.warning('合约地址文件不存在');
        return;
      }

      const addresses = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
      const fiscoContracts = addresses['fisco-bcos']?.contracts;

      if (fiscoContracts) {
        this.auditContractAddress = fiscoContracts.AuditStorage;
        this.zkpVerifierContractAddress = fiscoContracts.ZKPVerifier;
      }

      // 加载 ABI（用于编码 call 数据）
      const auditArtifactPath = path.join(__dirname, '../../contracts/artifacts/contracts/AuditStorage.sol/AuditStorage.json');
      const zkpArtifactPath = path.join(__dirname, '../../contracts/artifacts/contracts/ZKPVerifier.sol/ZKPVerifier.json');

      if (fs.existsSync(auditArtifactPath)) {
        const artifact = JSON.parse(fs.readFileSync(auditArtifactPath, 'utf8'));
        this.auditAbi = artifact.abi;
      }

      if (fs.existsSync(zkpArtifactPath)) {
        const artifact = JSON.parse(fs.readFileSync(zkpArtifactPath, 'utf8'));
        this.zkpVerifierAbi = artifact.abi;
      }

      logger.info('FISCO BCOS 合约配置加载完成', {
        AuditStorage: this.auditContractAddress,
        ZKPVerifier: this.zkpVerifierContractAddress
      });
    } catch (error) {
      logger.error('加载 FISCO BCOS 合约配置失败', { error: error.message });
    }
  }

  /**
   * 通过 Console 执行合约只读调用
   * FISCO BCOS 2.x 的 JSON-RPC call 不支持直接合约调用，统一走 Console
   */
  async contractCall(contractName, methodName, params = []) {
    try {
      const contractAddress = this.getContractAddress(contractName);
      if (!contractAddress) throw new Error(`合约 ${contractName} 地址未配置`);

      const paramStr = params.map(p => {
        if (typeof p === 'string' && p.startsWith('0x') && p.length === 66) return `"${p}"`;
        if (typeof p === 'boolean') return p ? 'true' : 'false';
        if (typeof p === 'number') return String(p);
        return `"${p}"`;
      }).join(' ');

      const command = `call ${contractName} ${contractAddress} ${methodName} ${paramStr}`.trim();
      logger.info('执行 FISCO BCOS Console 只读调用', { command });

      const output = await consoleExec(FISCO_CONFIG.groupId, command);

      if (output.includes('Undefined command') || output.includes('error:')) {
        throw new Error('Console 命令执行失败: ' + output.substring(0, 200));
      }

      // 解析 Return values
      const returnMatch = output.match(/Return values?:\s*\(?([^)\n]*)\)?/);
      if (!returnMatch) throw new Error('无法解析返回值: ' + output.substring(0, 200));

      const rawValue = returnMatch[1].trim();
      return rawValue;
    } catch (error) {
      logger.error(`合约只读调用 ${contractName}.${methodName} 失败`, { error: error.message });
      throw error;
    }
  }

  /**
   * 获取合约地址
   */
  getContractAddress(contractName) {
    const map = {
      'AuditStorage': this.auditContractAddress,
      'ZKPVerifier': this.zkpVerifierContractAddress
    };
    return map[contractName] || null;
  }

  /**
   * 通过 Console 执行合约写操作
   */
  async contractSend(contractName, methodName, params = []) {
    try {
      const contractAddress = this.getContractAddress(contractName);
      if (!contractAddress) throw new Error(`合约 ${contractName} 地址未配置`);

      const paramStr = params.map(p => {
        if (typeof p === 'string' && p.startsWith('0x') && p.length === 66) return `"${p}"`; // bytes32
        if (typeof p === 'boolean') return p ? 'true' : 'false';
        if (typeof p === 'number') return String(p);
        return `"${p}"`;
      }).join(' ');

      const command = `call ${contractName} ${contractAddress} ${methodName} ${paramStr}`;
      logger.info('执行 FISCO BCOS Console 写操作', { command });

      const output = await consoleExec(FISCO_CONFIG.groupId, command);

      // 解析交易哈希和区块号
      const txHashMatch = output.match(/transaction hash:\s*(0x[0-9a-fA-F]+)/);
      const blockMatch = output.match(/currentBlockNumber:\s*(\d+)/i) || output.match(/blockNumber:\s*(\d+)/i);
      const txHash = txHashMatch ? txHashMatch[1] : null;

      // 检查错误（排除正常输出中的关键词）
      const hasError = output.includes('Undefined command') ||
        output.includes('revert') ||
        (output.includes('Error') && !output.includes('transaction executed successfully'));
      if (hasError) {
        const errorMsg = output.match(/(?:error|Error|revert|Undefined).*?(?:\n|$)/i);
        throw new Error(errorMsg ? errorMsg[0].trim() : 'Transaction failed');
      }

      return {
        success: true,
        transactionHash: txHash,
        blockNumber: blockMatch ? parseInt(blockMatch[1]) : null,
        network: 'fisco-bcos'
      };
    } catch (error) {
      logger.error(`合约写操作 ${contractName}.${methodName} 失败`, { error: error.message });
      throw error;
    }
  }

  /**
   * 生成 SM3 哈希
   */
  generateSM3Hash(data) {
    try {
      if (Array.isArray(data)) {
        return data.map(item => {
          const dataStr = typeof item === 'string' ? item : JSON.stringify(item);
          return generateSM3Hash(dataStr);
        });
      }
      const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
      return generateSM3Hash(dataStr);
    } catch (error) {
      logger.error('生成 SM3 哈希失败', { error: error.message });
      throw error;
    }
  }

  /**
   * 将 SM3 哈希转换为 bytes32 格式
   */
  convertSM3ToBytes32(sm3Hash) {
    const cleanHash = sm3Hash.startsWith('0x') ? sm3Hash.slice(2) : sm3Hash;
    return '0x' + cleanHash.padStart(64, '0').slice(0, 64);
  }

  /**
   * 存储审计哈希到 FISCO BCOS（异步非阻塞）
   */
  storeAuditHash(sm3Hash, timestamp, transactionType, userId) {
    if (!this.isInitialized || !this.auditContractAddress) {
      logger.warning('FISCO BCOS 服务或 AuditStorage 未初始化，跳过审计存证', {
        sm3Hash: sm3Hash.substring(0, 20) + '...'
      });
      return Promise.resolve({ success: false, skipped: true, error: 'Service not initialized' });
    }

    if (this.auditHashSent.has(sm3Hash)) {
      logger.warning('审计哈希已发送，跳过重复', { sm3Hash: sm3Hash.substring(0, 20) + '...' });
      return Promise.resolve({ success: false, skipped: true, reason: 'duplicate' });
    }

    this.auditHashSent.add(sm3Hash);

    logger.info('准备审计上链存证 (FISCO BCOS)', {
      sm3Hash: sm3Hash.substring(0, 20) + '...',
      transactionType,
      userId
    });

    return this.contractSend('AuditStorage', 'storeAuditHash', [
      sm3Hash, timestamp, transactionType, userId.toString()
    ])
      .then(result => {
        logger.info('审计哈希上链存证成功 (FISCO BCOS)', {
          sm3Hash: sm3Hash.substring(0, 20) + '...',
          blockchainTxHash: result.transactionHash,
          blockNumber: result.blockNumber
        });
        return {
          success: true,
          sm3Hash,
          blockchainTxHash: result.transactionHash,
          blockNumber: result.blockNumber,
          network: 'fisco-bcos'
        };
      })
      .catch(error => {
        this.auditHashSent.delete(sm3Hash);
        logger.error('审计哈希上链存证失败 (FISCO BCOS)', {
          error: error.message,
          sm3Hash: sm3Hash.substring(0, 20) + '...'
        });
        return { success: false, error: error.message };
      });
  }

  /**
   * 注册用户公钥锚定到 FISCO BCOS（异步非阻塞）
   */
  registerUserOnChain(userId, publicKey) {
    if (!this.isInitialized || !this.auditContractAddress) {
      logger.warning('FISCO BCOS 服务未初始化，跳过用户注册', { userId });
      return Promise.resolve({ success: false, skipped: true });
    }

    try {
      const pkHash = this.generateSM3Hash(publicKey);
      const timestamp = Math.floor(Date.now() / 1000);

      logger.info('准备用户公钥锚定上链 (FISCO BCOS)', {
        userId,
        pkHash: pkHash.substring(0, 20) + '...'
      });

      return this.storeAuditHash(pkHash, timestamp, 'REGISTER', userId).then(result => {
        if (result.success) {
          logger.info('用户公钥锚定上链成功 (FISCO BCOS)', { userId });
        }
        return { ...result, pkHash };
      });
    } catch (error) {
      logger.error('用户公钥锚定上链失败 (FISCO BCOS)', { error: error.message, userId });
      return Promise.resolve({ success: false, error: error.message });
    }
  }

  /**
   * 记录 ZKP 验证结果到 FISCO BCOS（异步非阻塞）
   */
  recordZKPResult(proofId, isValid, proofHash) {
    if (!this.isInitialized || !this.zkpVerifierContractAddress) {
      logger.warning('FISCO BCOS 服务或 ZKPVerifier 未初始化，跳过 ZKP 存证', { proofId });
      return Promise.resolve({ success: false, skipped: true });
    }

    const proofIdBytes32 = ethers.utils.formatBytes32String(proofId.toString().slice(0, 31));

    logger.info('准备 ZKP 验证结果上链 (FISCO BCOS)', {
      proofId,
      isValid,
      proofHash: proofHash.substring(0, 20) + '...'
    });

    return this.contractSend('ZKPVerifier', 'recordProofResult', [
      proofIdBytes32, isValid, proofHash
    ])
      .then(result => {
        logger.info('ZKP 验证结果上链成功 (FISCO BCOS)', {
          proofId,
          isValid,
          blockchainTxHash: result.transactionHash,
          blockNumber: result.blockNumber
        });
        return {
          success: true,
          blockchainTxHash: result.transactionHash,
          blockNumber: result.blockNumber,
          network: 'fisco-bcos'
        };
      })
      .catch(error => {
        logger.error('ZKP 验证结果上链失败 (FISCO BCOS)', { error: error.message, proofId });
        return { success: false, error: error.message };
      });
  }

  /**
   * 存储交易哈希（向后兼容）
   */
  async storeTransactionHash(transactionId, transactionData, transactionType, userId) {
    if (!this.isInitialized) {
      logger.warning('FISCO BCOS 服务未初始化，跳过链上存证', { transactionId });
      return { success: false, error: 'Service not initialized', skipped: true };
    }

    try {
      const sm3Hash = this.generateSM3Hash(transactionData);
      const timestamp = Math.floor(Date.now() / 1000);
      return this.storeAuditHash(sm3Hash, timestamp, transactionType, userId);
    } catch (error) {
      logger.error('交易哈希上链存证失败 (FISCO BCOS)', { error: error.message, transactionId });
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量存储交易哈希
   */
  async storeTransactionHashesBatch(transactions) {
    if (!this.isInitialized) {
      return transactions.map(tx => ({
        ...tx,
        blockchainResult: { success: false, skipped: true }
      }));
    }

    const results = [];
    for (const tx of transactions) {
      const result = await this.storeTransactionHash(
        tx.transactionId, tx.transactionData, tx.transactionType, tx.userId
      );
      results.push({ ...tx, blockchainResult: result });
    }
    return results;
  }

  /**
   * 验证交易哈希（FISCO BCOS 模式下通过 AuditStorage 查询）
   */
  async verifyTransactionHash(transactionId, transactionData) {
    if (!this.isInitialized || !this.auditContractAddress) {
      return { success: false, error: 'Service not initialized' };
    }

    const sm3Hash = this.generateSM3Hash(transactionData);
    try {
      const result = await this.contractCall('AuditStorage', 'getRecordByHash', [sm3Hash]);

      if (!result || result === '0' || result === '') {
        return { success: true, isValid: false, reason: '链上无此记录', storedHash: sm3Hash };
      }

      // FISCO BCOS Console 返回的是 tuple: (timestamp, submitter, operationType, userId)
      // result 格式如: "1234567890,0xabc...,loan,user123"
      return {
        success: true,
        isValid: true,
        storedHash: sm3Hash,
        chainRecord: result
      };
    } catch (error) {
      // getRecordByHash 在记录不存在时 revert → 走到这里
      logger.info('验证交易哈希: 链上无此记录', { transactionId });
      return { success: true, isValid: false, reason: '链上无此记录', storedHash: sm3Hash };
    }
  }

  /**
   * 获取审计记录总数
   */
  async getTransactionCount() {
    if (!this.isInitialized || !this.auditContractAddress) return 0;

    try {
      const result = await this.contractCall('AuditStorage', 'getTotalRecords');
      return parseInt(result) || 0;
    } catch (error) {
      logger.error('获取交易总数失败 (FISCO BCOS)', { error: error.message });
      return 0;
    }
  }

  /**
   * 获取服务状态
   */
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      walletAddress: null, // FISCO BCOS 使用 Channel 协议，无本地钱包地址
      network: FISCO_CONFIG,
      networkName: this.networkName,
      contracts: {
        AuditStorage: !!this.auditContractAddress,
        ZKPVerifier: !!this.zkpVerifierContractAddress
      }
    };
  }
}

module.exports = new BlockchainServiceFisco();
