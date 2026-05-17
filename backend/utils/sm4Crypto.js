const crypto = require('crypto');
const logger = require('./logger');
const { getKey } = require('./keyManager');

let cachedKey = null;

function getSM4Key() {
  if (cachedKey) {
    return cachedKey;
  }

  const keyFromEnv = getKey('SM4_MASTER_KEY');
  if (!keyFromEnv) {
    throw new Error('SM4 主密钥未配置，系统无法启动');
  }

  const hexPattern = /^[0-9a-fA-F]{32}$/;
  if (!hexPattern.test(keyFromEnv)) {
    throw new Error('SM4_MASTER_KEY 格式错误：必须为32位十六进制字符串');
  }

  cachedKey = keyFromEnv.toLowerCase();
  return cachedKey;
}

function encrypt(plaintext) {
  const key = Buffer.from(getSM4Key(), 'hex');
  const plaintextStr = typeof plaintext === 'number' ? String(plaintext) : plaintext;
  const iv = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv('sm4-cbc', key, iv);
  let encrypted = cipher.update(plaintextStr, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = crypto.createHmac('sm3', key).update(iv.toString('hex') + encrypted).digest('hex');

  return `v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('SM4 解密失败：数据格式无效');
  }

  let hasVersion = false;
  let version = null;
  let dataPart = ciphertext;

  if (ciphertext.match(/^v\d+:/)) {
    hasVersion = true;
    const match = ciphertext.match(/^(v\d+):(.*)$/);
    if (match) {
      version = match[1];
      dataPart = match[2];
    }
  }

  if (!dataPart.includes(':')) {
    throw new Error('SM4 解密失败：数据格式无效');
  }

  const parts = dataPart.split(':');
  if (!hasVersion && parts.length !== 3) {
    logger.warning('SM4 解密失败，未知格式，返回原始值');
    throw new Error('SM4 解密失败：未知格式');
  }
  if (hasVersion && parts.length !== 3) {
    logger.warning('SM4 解密失败，版本化格式错误，返回原始值');
    throw new Error('SM4 解密失败：版本格式错误');
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = Buffer.from(getSM4Key(), 'hex');
  const iv = Buffer.from(ivHex, 'hex');

  const expectedAuthTag = crypto.createHmac('sm3', key).update(ivHex + encryptedHex).digest('hex');
  if (authTagHex !== expectedAuthTag) {
    logger.warning('SM4 解密失败（认证标签不匹配），返回原始值');
    throw new Error('SM4 解密失败：认证标签不匹配');
  }

  try {
    const decipher = crypto.createDecipheriv('sm4-cbc', key, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    logger.warning('SM4 解密失败，返回原始值', { error: error.message });
    throw new Error('SM4 解密失败：解密过程异常');
  }
}

function decryptWithVersion(ciphertext) {
  if (!ciphertext || typeof ciphertext !== 'string') {
    return { version: null, plaintext: ciphertext };
  }

  let version = null;
  let dataPart = ciphertext;

  if (ciphertext.match(/^v\d+:/)) {
    const match = ciphertext.match(/^(v\d+):(.*)$/);
    if (match) {
      version = match[1];
      dataPart = match[2];
    }
  }

  const plaintext = decrypt(ciphertext);
  return { version, plaintext };
}

function reEncrypt(data, oldKeyHex, newKeyHex) {
  if (!data || typeof data !== 'string') {
    return data;
  }

  if (!data.includes(':')) {
    return data;
  }

  let hasVersion = false;
  let dataPart = data;

  if (data.match(/^v\d+:/)) {
    hasVersion = true;
    dataPart = data.replace(/^v\d+:/, '');
  }

  const parts = dataPart.split(':');
  if (parts.length !== 3) {
    logger.warning('reEncrypt: 格式错误，返回原始值');
    return data;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;

  try {
    const oldKey = Buffer.from(oldKeyHex, 'hex');
    const expectedAuthTag = crypto.createHmac('sm3', oldKey).update(ivHex + encryptedHex).digest('hex');

    if (authTagHex !== expectedAuthTag) {
      logger.warning('reEncrypt: 旧密钥认证标签不匹配，返回原始值');
      return data;
    }

    const oldIv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv('sm4-cbc', oldKey, oldIv);
    let plaintext = decipher.update(encryptedHex, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    const newKey = Buffer.from(newKeyHex, 'hex');
    const newIv = crypto.randomBytes(16);
    const newCipher = crypto.createCipheriv('sm4-cbc', newKey, newIv);
    let newEncrypted = newCipher.update(plaintext, 'utf8', 'hex');
    newEncrypted += newCipher.final('hex');
    const newAuthTag = crypto.createHmac('sm3', newKey).update(newIv.toString('hex') + newEncrypted).digest('hex');

    return `v2:${newIv.toString('hex')}:${newAuthTag}:${newEncrypted}`;
  } catch (error) {
    logger.error('reEncrypt: 加密转换失败', { error: error.message });
    return data;
  }
}

function encryptFields(tableName, data) {
  if (tableName === 'users') {
    if (data.balance !== undefined && data.balance !== null) {
      data.balance = Number(data.balance);
      const encrypted = encrypt(String(data.balance));
      data.balance = encrypted;
    }
    if (data.credit_score !== undefined && data.credit_score !== null) {
      data.credit_score = Number(data.credit_score);
      const encrypted = encrypt(String(data.credit_score));
      data.credit_score = encrypted;
    }
  } else if (tableName === 'transactions') {
    if (data.amount !== undefined && data.amount !== null) {
      data.amount = Number(data.amount);
      const encrypted = encrypt(String(data.amount));
      data.amount = encrypted;
    }
    if (data.interest !== undefined && data.interest !== null) {
      data.interest = Number(data.interest);
      const encrypted = encrypt(String(data.interest));
      data.interest = encrypted;
    }
    if (data.total_amount !== undefined && data.total_amount !== null) {
      data.total_amount = Number(data.total_amount);
      const encrypted = encrypt(String(data.total_amount));
      data.total_amount = encrypted;
    }
  }
  return data;
}

function decryptFields(tableName, data) {
  if (!data) return data;

  if (tableName === 'users') {
    if (data.balance !== undefined && data.balance !== null) {
      try {
        const decrypted = decrypt(data.balance);
        data.balance = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 balance 解密失败: ${decryptError.message}`);
        data.balance = data.balance;
      }
    }
    if (data.credit_score !== undefined && data.credit_score !== null) {
      try {
        const decrypted = decrypt(data.credit_score);
        data.credit_score = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 credit_score 解密失败: ${decryptError.message}`);
        data.credit_score = data.credit_score;
      }
    }
  } else if (tableName === 'transactions') {
    if (data.amount !== undefined && data.amount !== null) {
      try {
        const decrypted = decrypt(data.amount);
        data.amount = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 amount 解密失败: ${decryptError.message}`);
        data.amount = data.amount;
      }
    }
    if (data.interest !== undefined && data.interest !== null) {
      try {
        const decrypted = decrypt(data.interest);
        data.interest = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 interest 解密失败: ${decryptError.message}`);
        data.interest = data.interest;
      }
    }
    if (data.total_amount !== undefined && data.total_amount !== null) {
      try {
        const decrypted = decrypt(data.total_amount);
        data.total_amount = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 total_amount 解密失败: ${decryptError.message}`);
        data.total_amount = data.total_amount;
      }
    }
  }
  return data;
}

exports.encrypt = encrypt;
exports.decrypt = decrypt;
exports.decryptWithVersion = decryptWithVersion;
exports.reEncrypt = reEncrypt;
exports.getSM4Key = getSM4Key;
exports.encryptFields = encryptFields;
exports.decryptFields = decryptFields;
