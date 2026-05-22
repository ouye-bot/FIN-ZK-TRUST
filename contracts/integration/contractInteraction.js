const ethers = require('ethers');
const fs = require('fs');
const path = require('path');

// 加载合约地址和ABI
const contractAddresses = JSON.parse(fs.readFileSync(path.join(__dirname, '../contract-address-local.json'), 'utf8'));
const verifierABI = JSON.parse(fs.readFileSync(path.join(__dirname, '../abi/Verifier.json'), 'utf8'));

// 连接到本地私链
const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

// 获取部署账户（使用Hardhat默认账户）
const deployerPrivateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const deployer = new ethers.Wallet(deployerPrivateKey, provider);

// 创建合约实例
const verifierContract = new ethers.Contract(contractAddresses.contracts.Verifier, verifierABI, deployer);

/**
 * 国密参数转换函数
 * @param {string} sm2PublicKey - SM2公钥
 * @returns {Buffer} - 转换后的公钥
 */
exports.convertSM2PublicKey = (sm2PublicKey) => {
  try {
    const cleanPublicKey = sm2PublicKey.startsWith('04') ? sm2PublicKey.substring(2) : sm2PublicKey;
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
    if (!proof.pi_a || !proof.pi_b || !proof.pi_c) {
      throw new Error('无效的证明格式');
    }

    const formattedProof = {
      a: proof.pi_a.slice(0, 2),
      b: proof.pi_b.slice(0, 2).map(pair => pair.slice(0, 2)),
      c: proof.pi_c.slice(0, 2)
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
 * 监听链上事件
 * @param {function} callback - 事件回调函数
 */
exports.listenToEvents = (callback) => {
  try {
    verifierContract.on('ProofVerifySuccess', (user, sm3Hash, timestamp) => {
      callback('ProofVerifySuccess', { user, sm3Hash, timestamp });
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
    console.log('已停止监听链上事件');
  } catch (error) {
    console.error('停止事件监听失败:', error);
    throw error;
  }
};

// 导出合约实例
exports.verifierContract = verifierContract;
exports.provider = provider;
exports.deployer = deployer;
