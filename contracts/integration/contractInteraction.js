const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

// 加载合约地址和ABI
const contractAddresses = JSON.parse(fs.readFileSync(path.join(__dirname, '../contract-address-local.json'), 'utf8'));
const verifierABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../abi/Verifier.json'), 'utf8'));
const finZkTrustABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../abi/FinZkTrust.json'), 'utf8'));

// 连接到本地私链
const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

// 获取部署账户（使用Hardhat默认账户）
const deployerPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const deployer = new ethers.Wallet(deployerPrivateKey, provider);

// 创建合约实例
const verifierContract = new ethers.Contract(contractAddresses.verifier, verifierABI, deployer);
const finZkTrustContract = new ethers.Contract(contractAddresses.finZkTrust, finZkTrustABI, deployer);

/**
 * 国密参数转换函数
 * @param {string} sm2PublicKey - SM2公钥
 * @returns {Buffer} - 转换后的公钥
 */
exports.convertSM2PublicKey = (sm2PublicKey) => {
  try {
    // 移除前缀04（如果存在）
    const cleanPublicKey = sm2PublicKey.startsWith('04') ? sm2PublicKey.substring(2) : sm2PublicKey;
    // 转换为Buffer
    return Buffer.from(cleanPublicKey, 'hex');
  } catch (error) {
    console.error('SM2公钥转换失败:', error);
    throw error;
  }
};

/**
 * SM3哈希转换函数
 * @param {string} sm3Hash - SM3哈希值
 * @returns {string} - 转换后的哈希值
 */
exports.convertSM3Hash = (sm3Hash) => {
  try {
    // 确保哈希值是64字符的十六进制字符串
    if (sm3Hash.length !== 64) {
      throw new Error('SM3哈希值长度必须为64字符');
    }
    return sm3Hash;
  } catch (error) {
    console.error('SM3哈希转换失败:', error);
    throw error;
  }
};

/**
 * ZK证明参数格式化函数
 * @param {object} proof - 原始证明对象
 * @returns {object} - 格式化后的证明对象
 */
exports.formatZKProof = (proof) => {
  try {
    // 确保proof对象结构正确
    if (!proof.pi_a || !proof.pi_b || !proof.pi_c) {
      throw new Error('无效的证明格式');
    }

    // 格式化证明参数以适配Solidity合约
    const formattedProof = {
      a: proof.pi_a.slice(0, 2), // 只取前2个元素
      b: proof.pi_b.slice(0, 2).map(pair => pair.slice(0, 2)), // 确保pi_b只有2个元素，每个元素只有2个元素
      c: proof.pi_c.slice(0, 2) // 只取前2个元素
    };

    return formattedProof;
  } catch (error) {
    console.error('ZK证明参数格式化失败:', error);
    throw error;
  }
};

/**
 * 验证零知识证明
 * @param {address} user - 用户地址
 * @param {object} proof - 零知识证明
 * @param {array} publicSignals - 公开信号
 * @param {string} sm3Hash - SM3哈希值
 * @returns {Promise<boolean>} - 验证结果
 */
exports.verifyZKProof = async (user, proof, publicSignals, sm3Hash) => {
  try {
    const formattedProof = exports.formatZKProof(proof);
    const result = await verifierContract.verifyProof(
      user,
      formattedProof.a,
      formattedProof.b,
      formattedProof.c,
      publicSignals,
      sm3Hash
    );
    return result;
  } catch (error) {
    console.error('零知识证明验证失败:', error);
    throw error;
  }
};

/**
 * 初始化用户信息
 * @param {string} sm2PublicKey - SM2公钥
 * @param {number} creditScore - 信用评分
 * @returns {Promise<object>} - 交易结果
 */
exports.initializeUser = async (sm2PublicKey, creditScore) => {
  try {
    const tx = await finZkTrustContract.initializeUser(sm2PublicKey, creditScore);
    const receipt = await tx.wait();
    return receipt;
  } catch (error) {
    console.error('用户初始化失败:', error);
    throw error;
  }
};

/**
 * 借款
 * @param {number} amount - 借款金额
 * @param {number} duration - 借款期限（秒）
 * @param {object} proof - 零知识证明
 * @param {array} publicSignals - 公开信号
 * @param {string} sm3Hash - SM3哈希值
 * @returns {Promise<object>} - 交易结果
 */
exports.borrow = async (amount, duration, proof, publicSignals, sm3Hash) => {
  try {
    const formattedProof = exports.formatZKProof(proof);
    const tx = await finZkTrustContract.borrow(
      amount,
      duration,
      formattedProof.a,
      formattedProof.b,
      formattedProof.c,
      publicSignals,
      sm3Hash
    );
    const receipt = await tx.wait();
    return receipt;
  } catch (error) {
    console.error('借款失败:', error);
    throw error;
  }
};

/**
 * 出资
 * @param {number} amount - 出资金额
 * @param {number} term - 出资期限（秒）
 * @returns {Promise<object>} - 交易结果
 */
exports.invest = async (amount, term) => {
  try {
    const tx = await finZkTrustContract.invest(amount, term, {
      value: amount
    });
    const receipt = await tx.wait();
    return receipt;
  } catch (error) {
    console.error('出资失败:', error);
    throw error;
  }
};

/**
 * 赎回
 * @param {number} amount - 赎回金额
 * @returns {Promise<object>} - 交易结果
 */
exports.redeem = async (amount) => {
  try {
    const tx = await finZkTrustContract.redeem(amount);
    const receipt = await tx.wait();
    return receipt;
  } catch (error) {
    console.error('赎回失败:', error);
    throw error;
  }
};

/**
 * 记录交易哈希
 * @param {string} hash - 交易哈希
 * @param {string} transactionType - 交易类型
 * @returns {Promise<object>} - 交易结果
 */
exports.recordTransactionHash = async (hash, transactionType) => {
  try {
    const tx = await finZkTrustContract.recordTransactionHash(hash, transactionType);
    const receipt = await tx.wait();
    return receipt;
  } catch (error) {
    console.error('交易哈希记录失败:', error);
    throw error;
  }
};

/**
 * 查询资金池余额
 * @returns {Promise<array>} - 资金池余额 [originalPool, userPool]
 */
exports.getPoolBalances = async () => {
  try {
    const balances = await finZkTrustContract.getPoolBalances();
    return balances;
  } catch (error) {
    console.error('查询资金池余额失败:', error);
    throw error;
  }
};

/**
 * 查询用户信息
 * @param {string} user - 用户地址
 * @returns {Promise<object>} - 用户信息
 */
exports.getUserInfo = async (user) => {
  try {
    const userInfo = await finZkTrustContract.getUserInfo(user);
    return userInfo;
  } catch (error) {
    console.error('查询用户信息失败:', error);
    throw error;
  }
};

/**
 * 监听链上事件
 * @param {function} callback - 事件回调函数
 */
exports.listenToEvents = (callback) => {
  try {
    // 监听ProofVerifySuccess事件
    verifierContract.on('ProofVerifySuccess', (user, sm3Hash, timestamp) => {
      callback('ProofVerifySuccess', { user, sm3Hash, timestamp });
    });

    // 监听UserInitialized事件
    finZkTrustContract.on('UserInitialized', (user, sm2PublicKey, creditScore, loanLimit) => {
      callback('UserInitialized', { user, sm2PublicKey, creditScore, loanLimit });
    });

    // 监听LoanCreated事件
    finZkTrustContract.on('LoanCreated', (borrower, amount, duration, interestRate) => {
      callback('LoanCreated', { borrower, amount, duration, interestRate });
    });

    // 监听InvestmentCreated事件
    finZkTrustContract.on('InvestmentCreated', (investor, amount, term) => {
      callback('InvestmentCreated', { investor, amount, term });
    });

    // 监听InvestmentRedeemed事件
    finZkTrustContract.on('InvestmentRedeemed', (investor, amount, interest) => {
      callback('InvestmentRedeemed', { investor, amount, interest });
    });

    // 监听TransactionHashRecorded事件
    finZkTrustContract.on('TransactionHashRecorded', (hash, user, transactionType) => {
      callback('TransactionHashRecorded', { hash, user, transactionType });
    });

    console.log('已开始监听链上事件');
  } catch (error) {
    console.error('事件监听设置失败:', error);
    throw error;
  }
};

/**
 * 停止监听链上事件
 */
exports.stopListeningToEvents = () => {
  try {
    verifierContract.removeAllListeners();
    finZkTrustContract.removeAllListeners();
    console.log('已停止监听链上事件');
  } catch (error) {
    console.error('停止事件监听失败:', error);
    throw error;
  }
};

// 导出合约实例
exports.verifierContract = verifierContract;
exports.finZkTrustContract = finZkTrustContract;
exports.provider = provider;
exports.deployer = deployer;