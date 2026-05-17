const crypto = require('crypto');
const { execute } = require('../config/database');
const logger = require('../utils/logger');

const SM4_ALGORITHM = 'sm4-cbc';
const HMAC_ALGORITHM = 'sm3';

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
  if (authTagHex !== expectedTag) throw new Error('认证标签不匹配');

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(SM4_ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function generateDEK(userId) {
  const existing = await execute('SELECT encrypted_dek FROM user_keys WHERE user_id = ?', [userId]);
  if (existing.length > 0) {
    logger.info('DEK 已存在，跳过生成', { userId });
    return decryptWithMasterKey(existing[0].encrypted_dek);
  }

  const dekHex = crypto.randomBytes(16).toString('hex');
  const encryptedDek = encryptWithMasterKey(dekHex);

  await execute(
    'INSERT INTO user_keys (user_id, encrypted_dek, created_at) VALUES (?, ?, ?)',
    [userId, encryptedDek, Date.now()]
  );

  logger.info('用户 DEK 已生成并加密存储', { userId });
  return dekHex;
}

const dekCache = new Map();
const DEK_CACHE_TTL = 5 * 60 * 1000;

async function getDEK(userId) {
  const cached = dekCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < DEK_CACHE_TTL) {
    return cached.dek;
  }

  const rows = await execute(
    'SELECT encrypted_dek FROM user_keys WHERE user_id = ?',
    [userId]
  );

  if (rows.length === 0) {
    logger.info('用户无 DEK，自动生成（兼容迁移）', { userId });
    return await generateDEK(userId);
  }

  const dek = decryptWithMasterKey(rows[0].encrypted_dek);
  dekCache.set(userId, { dek, cachedAt: Date.now() });
  return dek;
}

function encryptWithDEK(dek, plaintext, aad = '') {
  const key = Buffer.from(dek, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(SM4_ALGORITHM, key, iv);
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(iv.toString('hex') + encrypted + aad).digest('hex');
  return `v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decryptWithDEK(dek, ciphertext, aad = '') {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('密文格式无效');
  }

  const dataPart = ciphertext.replace(/^v\d+:/, '');
  const parts = dataPart.split(':');
  if (parts.length !== 3) throw new Error('密文格式无效');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = Buffer.from(dek, 'hex');

  const expectedTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(ivHex + encryptedHex + aad).digest('hex');
  if (authTagHex !== expectedTag) {
    if (aad) {
      const legacyTag = crypto.createHmac(HMAC_ALGORITHM, key)
        .update(ivHex + encryptedHex).digest('hex');
      if (authTagHex === legacyTag) {
        logger.warning('解密使用旧格式（无 AAD），建议运行迁移脚本', { aad });
      } else {
        throw new Error('认证标签不匹配（AAD 校验失败）');
      }
    } else {
      throw new Error('认证标签不匹配');
    }
  }

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(SM4_ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

async function rotateDEK(userId) {
  const oldDek = await getDEK(userId);
  const newDekHex = crypto.randomBytes(16).toString('hex');
  const encryptedNewDek = encryptWithMasterKey(newDekHex);

  const users = await execute('SELECT balance, credit_score FROM users WHERE id = ?', [userId]);
  if (users.length === 0) throw new Error('用户不存在');

  const user = users[0];
  const updates = {};

  if (user.balance) {
    const plain = decryptWithDEK(oldDek, user.balance, 'users:balance:' + userId);
    updates.balance = encryptWithDEK(newDekHex, plain, 'users:balance:' + userId);
  }
  if (user.credit_score) {
    const plain = decryptWithDEK(oldDek, user.credit_score, 'users:credit_score:' + userId);
    updates.credit_score = encryptWithDEK(newDekHex, plain, 'users:credit_score:' + userId);
  }

  const txns = await execute(
    'SELECT id, amount, interest, total_amount FROM transactions WHERE user_id = ?',
    [userId]
  );
  for (const txn of txns) {
    if (txn.amount) {
      const plain = decryptWithDEK(oldDek, txn.amount, 'transactions:amount:' + txn.id);
      const reEncrypted = encryptWithDEK(newDekHex, plain, 'transactions:amount:' + txn.id);
      await execute('UPDATE transactions SET amount = ? WHERE id = ?', [reEncrypted, txn.id]);
    }
    if (txn.interest) {
      const plain = decryptWithDEK(oldDek, txn.interest, 'transactions:interest:' + txn.id);
      const reEncrypted = encryptWithDEK(newDekHex, plain, 'transactions:interest:' + txn.id);
      await execute('UPDATE transactions SET interest = ? WHERE id = ?', [reEncrypted, txn.id]);
    }
    if (txn.total_amount) {
      const plain = decryptWithDEK(oldDek, txn.total_amount, 'transactions:total_amount:' + txn.id);
      const reEncrypted = encryptWithDEK(newDekHex, plain, 'transactions:total_amount:' + txn.id);
      await execute('UPDATE transactions SET total_amount = ? WHERE id = ?', [reEncrypted, txn.id]);
    }
  }

  if (updates.balance !== undefined) {
    await execute('UPDATE users SET balance = ? WHERE id = ?', [updates.balance, userId]);
  }
  if (updates.credit_score !== undefined) {
    await execute('UPDATE users SET credit_score = ? WHERE id = ?', [updates.credit_score, userId]);
  }

  await execute(
    'UPDATE user_keys SET encrypted_dek = ?, rotated_at = ? WHERE user_id = ?',
    [encryptedNewDek, Date.now(), userId]
  );

  dekCache.delete(userId);

  logger.info('用户 DEK 轮换完成', { userId });
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
  decryptWithMasterKey,
  getMasterKey
};