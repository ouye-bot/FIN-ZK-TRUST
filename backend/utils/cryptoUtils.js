const { sm2, sm3 } = require('sm-crypto');
const crypto = require('crypto');
const logger = require('./logger');

// 通用LRU缓存基类
class LRUCache {
  constructor(capacity = 1000, ttl = 3600000) {
    this.capacity = capacity;
    this.ttl = ttl;
    this.cache = new Map();
    this.keys = [];
    this.expiry = new Map();
  }

  get(key) {
    const now = Date.now();
    if (this.expiry.has(key) && this.expiry.get(key) < now) {
      this.cache.delete(key);
      this.expiry.delete(key);
      const index = this.keys.indexOf(key);
      if (index > -1) {
        this.keys.splice(index, 1);
      }
      return null;
    }

    if (this.cache.has(key)) {
      this._updateAccessOrder(key);
      return this.cache.get(key);
    }
    return null;
  }

  set(key, value) {
    const now = Date.now();
    if (this.cache.has(key)) {
      this.cache.set(key, value);
      this.expiry.set(key, now + this.ttl);
      this._updateAccessOrder(key);
    } else {
      if (this.keys.length >= this.capacity) {
        const oldestKey = this.keys.pop();
        this.cache.delete(oldestKey);
        this.expiry.delete(oldestKey);
      }
      this.cache.set(key, value);
      this.expiry.set(key, now + this.ttl);
      this.keys.unshift(key);
    }
  }

  _updateAccessOrder(key) {
    const index = this.keys.indexOf(key);
    if (index > -1) {
      this.keys.splice(index, 1);
      this.keys.unshift(key);
    }
  }

  clear() {
    this.cache.clear();
    this.keys = [];
    this.expiry.clear();
  }

  get size() {
    return this.cache.size;
  }
}

// 哈希计算缓存
class HashCache extends LRUCache {
  constructor(capacity = 5000) {
    super(capacity);
  }
}

// 签名验证缓存
class SignatureCache extends LRUCache {
  constructor(capacity = 5000) {
    super(capacity);
    this.hitCount = 0;
    this.totalCount = 0;
  }

  get(key) {
    this.totalCount++;
    const value = super.get(key);
    if (value !== null) {
      this.hitCount++;
    }
    return value;
  }

  getHitRate() {
    return this.totalCount > 0 ? (this.hitCount / this.totalCount) * 100 : 0;
  }

  clear() {
    super.clear();
    this.hitCount = 0;
    this.totalCount = 0;
  }
}

// 初始化缓存实例
const hashCache = new HashCache(5000);
const signatureCache = new SignatureCache(5000);

// 定期记录缓存命中率
const cacheLogInterval = setInterval(() => {
  const hitRate = signatureCache.getHitRate();
  logger.info('Signature cache hit rate:', { hitRate: `${hitRate.toFixed(2)}%`, size: signatureCache.size, totalCount: signatureCache.totalCount, hitCount: signatureCache.hitCount });
}, 60000); // 每分钟记录一次
cacheLogInterval.unref();

// SM2 密钥格式校验
const SM2_PRIVATE_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const SM2_PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{130}$/;

function validateSM2PrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') {
    throw new Error('SM2 私钥不能为空');
  }
  if (!SM2_PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error('SM2 私钥格式无效：必须为64位十六进制字符串');
  }
}

function validateSM2PublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error('SM2 公钥不能为空');
  }
  if (!SM2_PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new Error('SM2 公钥格式无效：必须为130位十六进制字符串');
  }
}

/**
 * 生成带盐的SM3哈希
 * @param {string} password - 原始密码
 * @returns {Object} - 包含哈希值和盐的对象
 */
exports.generateSaltedSM3Hash = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const saltedPassword = password + salt;
  const hash = sm3(saltedPassword);
  return { hash, salt };
};

/**
 * 验证SM3哈希
 * @param {string} password - 原始密码
 * @param {string} storedHash - 存储的哈希值
 * @param {string} salt - 盐值
 * @returns {boolean} - 验证结果
 */
exports.verifySM3Hash = (password, storedHash, salt) => {
  const saltedPassword = password + salt;
  const hash = sm3(saltedPassword);
  return hash === storedHash;
};

/**
 * 验证SM2签名
 * @param {string} message - 原始消息
 * @param {string} signature - 签名
 * @param {string} publicKey - SM2公钥
 * @returns {boolean} - 验证结果
 */
exports.verifySM2Signature = (message, signature, publicKey) => {
  if (!message || typeof message !== 'string') {
    throw new Error('验签消息不能为空');
  }
  if (!signature || typeof signature !== 'string') {
    throw new Error('签名不能为空');
  }
  validateSM2PublicKey(publicKey);

  const cacheKey = `sm2_verify::${message}::${signature}::${publicKey}`;
  const cachedResult = signatureCache.get(cacheKey);
  
  if (cachedResult !== null) {
    return cachedResult;
  }
  
  try {
    const result = sm2.doVerifySignature(message, signature, publicKey, { der: false });
    logger.info('SM2 signature verification completed', { result });
    signatureCache.set(cacheKey, result);
    return result;
  } catch (error) {
    logger.error('SM2 signature verification failed:', { error: error.message });
    signatureCache.set(cacheKey, false);
    return false;
  }
};

/**
 * 生成SM3哈希
 * @param {string} data - 要哈希的数据
 * @returns {string} - 哈希值
 */
exports.generateSM3Hash = (data) => {
  const cacheKey = `sm3_${data}`;
  const cachedHash = hashCache.get(cacheKey);
  
  if (cachedHash) {
    return cachedHash;
  }
  
  const hash = sm3(data);
  hashCache.set(cacheKey, hash);
  return hash;
};

/**
 * 生成SM2密钥对
 * @returns {Object} - 包含公钥和私钥的对象
 */
exports.generateSM2KeyPair = () => {
  try {
    const keyPair = sm2.generateKeyPairHex();
    logger.info('SM2 key pair generated successfully');
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey
    };
  } catch (error) {
    logger.error('SM2 key pair generation failed:', { error: error.message });
    throw error;
  }
};

/**
 * 使用SM2私钥签名
 * @param {string} message - 要签名的消息
 * @param {string} privateKey - SM2私钥
 * @returns {string} - 签名
 */
exports.signWithSM2 = (message, privateKey) => {
  if (!message || typeof message !== 'string') {
    throw new Error('签名消息不能为空');
  }
  validateSM2PrivateKey(privateKey);

  const cacheKey = `sm2_sign::${message}`;
  const cachedSignature = signatureCache.get(cacheKey);

  if (cachedSignature !== null) {
    return cachedSignature;
  }

  try {
    const signature = sm2.doSignature(message, privateKey, { der: false });
    logger.info('SM2 signature generated successfully');
    signatureCache.set(cacheKey, signature);
    return signature;
  } catch (error) {
    logger.error('SM2 signature generation failed:', { error: error.message });
    throw error;
  }
};

/**
 * 按固定协议构造签名原文，确保与前端完全一致
 * 规则：字段按指定顺序排列，数值转为数字类型，字符串加引号，无空格
 * @param {Object} params - 包含各字段的对象
 * @param {string[]} keyOrder - 字段顺序
 * @returns {string} - JSON 字符串
 */
exports.buildSignatureData = (params, keyOrder) => {
  const parts = [];
  for (const key of keyOrder) {
    if (params.hasOwnProperty(key)) {
      const value = params[key];
      if (typeof value === 'string') {
        parts.push(`"${key}":"${value}"`);
      } else {
        parts.push(`"${key}":${value}`);
      }
    }
  }
  return `{${parts.join(',')}}`;
};
