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
 * @param {string} [existingSalt] - 已有盐值（验证时传入），不传则自动生成
 * @returns {Object} - 包含哈希值和盐的对象
 */
exports.generateSaltedSM3Hash = (password, existingSalt) => {
  const salt = existingSalt !== undefined ? existingSalt : crypto.randomBytes(16).toString('hex');
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
  if (hash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
};

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST_SM3 = 'sm3';
const PBKDF2_DIGEST_FALLBACK = 'sha256';

// 检测 Node.js 是否支持 sm3 digest
let PBKDF2_DIGEST = PBKDF2_DIGEST_SM3;
try {
  crypto.pbkdf2Sync('test', 'salt', 1, 1, 'sm3');
} catch (e) {
  PBKDF2_DIGEST = PBKDF2_DIGEST_FALLBACK;
  logger.warning('Node.js 不支持 PBKDF2 sm3 digest，已降级为 sha256');
}

/**
 * 使用 PBKDF2 生成密码哈希（优先 sm3，不可用时降级 sha256）
 * @param {string} password - 原始密码
 * @returns {string} - 格式: pbkdf2:iterations:salt:hash（均为 hex）
 */
exports.generatePBKDF2Hash = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${derived.toString('hex')}`;
};

/**
 * 验证 PBKDF2 密码哈希（自动检测 digest）
 * @param {string} password - 原始密码
 * @param {string} storedHash - 存储的哈希（pbkdf2:iterations:salt:hash 格式）
 * @returns {boolean} - 验证结果
 */
exports.verifyPBKDF2Hash = (password, storedHash) => {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterations, salt, expectedHash] = parts;
  const iterCount = parseInt(iterations, 10);
  if (isNaN(iterCount) || iterCount < 10000) return false;

  // 优先尝试当前配置的 digest
  try {
    const derived = crypto.pbkdf2Sync(password, salt, iterCount, PBKDF2_KEYLEN, PBKDF2_DIGEST);
    const derivedHex = derived.toString('hex');
    if (derivedHex.length !== expectedHash.length) return false;
    if (crypto.timingSafeEqual(Buffer.from(derivedHex, 'hex'), Buffer.from(expectedHash, 'hex'))) return true;
  } catch (e) { /* digest 不支持，继续 fallback */ }

  // 如果主 digest 失败，尝试另一个
  const altDigest = PBKDF2_DIGEST === PBKDF2_DIGEST_SM3 ? PBKDF2_DIGEST_FALLBACK : PBKDF2_DIGEST_SM3;
  try {
    const derived = crypto.pbkdf2Sync(password, salt, iterCount, PBKDF2_KEYLEN, altDigest);
    const derivedHex = derived.toString('hex');
    if (derivedHex.length !== expectedHash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(derivedHex, 'hex'), Buffer.from(expectedHash, 'hex'));
  } catch (e) {
    return false;
  }
};

/**
 * 检测是否为 PBKDF2 格式的哈希
 * @param {string} hash - 存储的哈希值
 * @returns {boolean}
 */
exports.isPBKDF2Hash = (hash) => {
  return typeof hash === 'string' && hash.startsWith('pbkdf2:');
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

  // 不缓存签名验证结果——防重放应由 nonce 机制保证，缓存会允许签名在 TTL 内被重用
  try {
    const result = sm2.doVerifySignature(message, signature, publicKey, { der: false });
    return result;
  } catch (error) {
    logger.error('SM2 signature verification failed:', { error: error.message });
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

  // 签名不缓存——每次签名必须使用新 nonce，缓存会破坏 nonce 新鲜度
  try {
    const signature = sm2.doSignature(message, privateKey, { der: false });
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
  const obj = {};
  for (const key of keyOrder) {
    if (params.hasOwnProperty(key)) {
      obj[key] = params[key];
    }
  }
  return JSON.stringify(obj);
};

/**
 * 确定性 JSON 序列化（canonical JSON）
 * 按 key 排序后序列化，确保前后端签名原文一致
 * @param {any} data - 要序列化的数据
 * @returns {string} - 排序后的 JSON 字符串
 */
exports.canonicalStringify = (data) => {
  if (data === null || data === undefined) return JSON.stringify(data);
  if (typeof data !== 'object') return JSON.stringify(data);
  if (Array.isArray(data)) return '[' + data.map(exports.canonicalStringify).join(',') + ']';
  const keys = Object.keys(data).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + exports.canonicalStringify(data[k])).join(',') + '}';
};

// 测试专用：暴露缓存实例供性能测试清除（仅非生产环境）
if (process.env.NODE_ENV !== 'production') {
  exports._signatureCache = signatureCache;
  exports._hashCache = hashCache;
  exports._test_clearCache = () => {
    signatureCache.clear();
    hashCache.clear();
  };
}
