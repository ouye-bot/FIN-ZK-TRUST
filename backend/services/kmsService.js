const crypto = require('crypto');
const { execute } = require('../config/database');
const logger = require('../utils/logger');

const SM4_ALGORITHM = 'sm4-cbc';
const HMAC_ALGORITHM = 'sm3';

function timingSafeCompare(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// 从 DEK 派生独立的加密密钥和 HMAC 密钥（密钥分离）
function deriveEncKey(dek) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(dek, 'hex'), '', 'sm4-encryption', 16));
}

function deriveHmacKey(dek) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(dek, 'hex'), '', 'sm3-hmac', 16));
}

function getMasterKey() {
  const keyHex = process.env.SM4_MASTER_KEY;
  if (!keyHex || !/^[0-9a-fA-F]{32}$/.test(keyHex)) {
    throw new Error('SM4_MASTER_KEY 未配置或格式错误');
  }
  return Buffer.from(keyHex, 'hex');
}

function encryptWithMasterKey(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(SM4_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(iv.toString('hex') + encrypted).digest('hex');
  return `v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptWithMasterKey(ciphertext) {
  const key = getMasterKey();
  const dataPart = ciphertext.replace(/^v\d+:/, '');
  const parts = dataPart.split(':');
  if (parts.length !== 3) throw new Error('密文格式无效');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const expectedTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(ivHex + encryptedHex).digest('hex');
  if (!timingSafeCompare(authTagHex, expectedTag)) throw new Error('认证标签不匹配');

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(SM4_ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function generateDEK(userId, connection) {
  const exec = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : execute;

  // 使用 INSERT IGNORE 防止 TOCTOU 竞态：并发调用时只有一个成功
  const dekHex = crypto.randomBytes(16).toString('hex');
  const encryptedDek = encryptWithMasterKey(dekHex);

  try {
    await exec(
      'INSERT IGNORE INTO user_keys (user_id, encrypted_dek, created_at) VALUES (?, ?, ?)',
      [userId, encryptedDek, Date.now()]
    );
  } catch (e) {
    // INSERT IGNORE 忽略重复键错误
  }

  // 无论插入是否成功，都从数据库读取（确保返回正确的 DEK）
  const rows = await exec('SELECT encrypted_dek FROM user_keys WHERE user_id = ?', [userId]);
  if (rows.length === 0) {
    throw new Error('DEK 生成失败');
  }

  logger.info('用户 DEK 已就绪', { userId });
  return decryptWithMasterKey(rows[0].encrypted_dek);
}

const dekCache = new Map();
const DEK_CACHE_TTL = 5 * 60 * 1000;

async function getDEK(userId, connection) {
  const cached = dekCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < DEK_CACHE_TTL) {
    return cached.dek;
  }

  const exec = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : execute;

  const rows = await exec(
    'SELECT encrypted_dek FROM user_keys WHERE user_id = ?',
    [userId]
  );

  if (rows.length === 0) {
    logger.info('用户无 DEK，自动生成（兼容迁移）', { userId });
    return await generateDEK(userId, connection);
  }

  const dek = decryptWithMasterKey(rows[0].encrypted_dek);
  dekCache.set(userId, { dek, cachedAt: Date.now() });
  return dek;
}

function encryptWithDEK(dek, plaintext, aad = '') {
  const encKey = deriveEncKey(dek);
  const hmacKey = deriveHmacKey(dek);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(SM4_ALGORITHM, encKey, iv);
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = crypto.createHmac(HMAC_ALGORITHM, hmacKey)
    .update(iv.toString('hex') + encrypted + aad).digest('hex');
  return `v2:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptWithDEK(dek, ciphertext, aad = '') {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('密文格式无效');
  }

  const versionMatch = ciphertext.match(/^(v\d+):/);
  const version = versionMatch ? versionMatch[1] : 'v1';
  const dataPart = ciphertext.replace(/^v\d+:/, '');
  const parts = dataPart.split(':');
  if (parts.length !== 3) throw new Error('密文格式无效');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');

  // v2: 密钥分离（encKey + hmacKey），v1: 单一密钥
  let encKey, hmacKey;
  if (version === 'v2') {
    encKey = deriveEncKey(dek);
    hmacKey = deriveHmacKey(dek);
  } else {
    encKey = Buffer.from(dek, 'hex');
    hmacKey = encKey;
  }

  const expectedTag = crypto.createHmac(HMAC_ALGORITHM, hmacKey)
    .update(ivHex + encryptedHex + aad).digest('hex');
  if (!timingSafeCompare(authTagHex, expectedTag)) {
    if (version === 'v2') throw new Error('认证标签不匹配');
    // v1 旧格式兼容：尝试无 AAD
    if (aad) {
      const legacyTag = crypto.createHmac(HMAC_ALGORITHM, hmacKey)
        .update(ivHex + encryptedHex).digest('hex');
      if (timingSafeCompare(authTagHex, legacyTag)) {
        logger.error('SECURITY: 解密降级为v1无AAD模式，AAD绑定被跳过，需尽快迁移数据到v2格式', { aad });
      } else {
        throw new Error('认证标签不匹配（AAD 校验失败）');
      }
    } else {
      throw new Error('认证标签不匹配');
    }
  }

  const decipher = crypto.createDecipheriv(SM4_ALGORITHM, encKey, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function rotateDEK(userId) {
  const { transaction } = require('../config/database');

  await transaction(async (connection) => {
    // 锁定用户密钥行，防止并发轮换
    const [keyRows] = await connection.execute(
      'SELECT encrypted_dek FROM user_keys WHERE user_id = ? FOR UPDATE', [userId]
    );
    if (keyRows.length === 0) throw new Error('用户密钥不存在');

    const oldDek = await getDEK(userId, connection);
    const newDekHex = crypto.randomBytes(16).toString('hex');
    const encryptedNewDek = encryptWithMasterKey(newDekHex);

    const [users] = await connection.execute('SELECT balance, credit_score FROM users WHERE id = ? FOR UPDATE', [userId]);
    if (users.length === 0) throw new Error('用户不存在');

    const user = users[0];

    if (user.balance) {
      const plain = decryptWithDEK(oldDek, user.balance, 'users:balance:' + userId);
      const reEncrypted = encryptWithDEK(newDekHex, plain, 'users:balance:' + userId);
      await connection.execute('UPDATE users SET balance = ? WHERE id = ?', [reEncrypted, userId]);
    }
    if (user.credit_score) {
      const plain = decryptWithDEK(oldDek, user.credit_score, 'users:credit_score:' + userId);
      const reEncrypted = encryptWithDEK(newDekHex, plain, 'users:credit_score:' + userId);
      await connection.execute('UPDATE users SET credit_score = ? WHERE id = ?', [reEncrypted, userId]);
    }

    const [txns] = await connection.execute(
      'SELECT id, amount, interest, total_amount FROM transactions WHERE user_id = ?', [userId]
    );
    for (const txn of txns) {
      for (const field of ['amount', 'interest', 'total_amount']) {
        if (txn[field]) {
          const plain = decryptWithDEK(oldDek, txn[field], `transactions:${field}:${txn.id}`);
          const reEncrypted = encryptWithDEK(newDekHex, plain, `transactions:${field}:${txn.id}`);
          await connection.execute(`UPDATE transactions SET ${field} = ? WHERE id = ?`, [reEncrypted, txn.id]);
        }
      }
    }

    await connection.execute(
      'UPDATE user_keys SET encrypted_dek = ?, rotated_at = ? WHERE user_id = ?',
      [encryptedNewDek, Date.now(), userId]
    );
  });

  dekCache.delete(userId);
  logger.info('用户 DEK 轮换完成（原子事务）', { userId });
}

const dekCacheCleanup = setInterval(() => {
  const now = Date.now();
  for (const [userId, cached] of dekCache.entries()) {
    if (now - cached.cachedAt > DEK_CACHE_TTL) {
      dekCache.delete(userId);
    }
  }
}, 60000);
dekCacheCleanup.unref();

module.exports = {
  generateDEK,
  getDEK,
  encryptWithDEK,
  decryptWithDEK,
  rotateDEK,
  encryptWithMasterKey,
  decryptWithMasterKey
};