const kmsService = require('../services/kmsService');
const logger = require('./logger');

function buildAAD(tableName, fieldName, recordId) {
  return `${tableName}:${fieldName}:${recordId}`;
}

async function encrypt(plaintext, userId, aad = '', connection) {
  const dek = await kmsService.getDEK(userId, connection);
  return kmsService.encryptWithDEK(dek, plaintext, aad);
}

async function decrypt(ciphertext, userId, aad = '', connection) {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('SM4 解密失败：数据格式无效');
  }
  const dek = await kmsService.getDEK(userId, connection);
  return kmsService.decryptWithDEK(dek, ciphertext, aad);
}

async function encryptFields(tableName, data, userId, connection) {
  if (tableName === 'users') {
    if (data.balance !== undefined && data.balance !== null) {
      const aad = buildAAD('users', 'balance', userId);
      data.balance = await encrypt(String(Number(data.balance)), userId, aad, connection);
    }
    if (data.credit_score !== undefined && data.credit_score !== null) {
      const aad = buildAAD('users', 'credit_score', userId);
      data.credit_score = await encrypt(String(Number(data.credit_score)), userId, aad, connection);
    }
  } else if (tableName === 'transactions') {
    if (data.amount !== undefined && data.amount !== null) {
      const aad = buildAAD('transactions', 'amount', userId);
      data.amount = await encrypt(String(Number(data.amount)), userId, aad, connection);
    }
    if (data.interest !== undefined && data.interest !== null) {
      const aad = buildAAD('transactions', 'interest', userId);
      data.interest = await encrypt(String(Number(data.interest)), userId, aad, connection);
    }
    if (data.total_amount !== undefined && data.total_amount !== null) {
      const aad = buildAAD('transactions', 'total_amount', userId);
      data.total_amount = await encrypt(String(Number(data.total_amount)), userId, aad, connection);
    }
  }
  return data;
}

async function decryptFields(tableName, data, userId, connection) {
  if (!data) return data;

  if (tableName === 'users') {
    if (data.balance !== undefined && data.balance !== null) {
      try {
        const aad = buildAAD('users', 'balance', userId);
        const decrypted = await decrypt(data.balance, userId, aad, connection);
        data.balance = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 balance 解密失败: ${decryptError.message}`);
        data._decryptFailed = true;
        data._decryptErrors = data._decryptErrors || [];
        data._decryptErrors.push({ field: 'balance', error: decryptError.message });
        data.balance = null;
      }
    }
    if (data.credit_score !== undefined && data.credit_score !== null) {
      try {
        const aad = buildAAD('users', 'credit_score', userId);
        const decrypted = await decrypt(data.credit_score, userId, aad, connection);
        data.credit_score = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 credit_score 解密失败: ${decryptError.message}`);
        data._decryptFailed = true;
        data._decryptErrors = data._decryptErrors || [];
        data._decryptErrors.push({ field: 'credit_score', error: decryptError.message });
        data.credit_score = null;
      }
    }
  } else if (tableName === 'transactions') {
    if (data.amount !== undefined && data.amount !== null) {
      try {
        const aad = buildAAD('transactions', 'amount', userId);
        const decrypted = await decrypt(data.amount, userId, aad, connection);
        data.amount = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 amount 解密失败: ${decryptError.message}`);
        data._decryptFailed = true;
        data._decryptErrors = data._decryptErrors || [];
        data._decryptErrors.push({ field: 'amount', error: decryptError.message });
        data.amount = null;
      }
    }
    if (data.interest !== undefined && data.interest !== null) {
      try {
        const aad = buildAAD('transactions', 'interest', userId);
        const decrypted = await decrypt(data.interest, userId, aad, connection);
        data.interest = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 interest 解密失败: ${decryptError.message}`);
        data._decryptFailed = true;
        data._decryptErrors = data._decryptErrors || [];
        data._decryptErrors.push({ field: 'interest', error: decryptError.message });
        data.interest = null;
      }
    }
    if (data.total_amount !== undefined && data.total_amount !== null) {
      try {
        const aad = buildAAD('transactions', 'total_amount', userId);
        const decrypted = await decrypt(data.total_amount, userId, aad, connection);
        data.total_amount = Number(decrypted);
      } catch (decryptError) {
        logger.warning(`字段 total_amount 解密失败: ${decryptError.message}`);
        data._decryptFailed = true;
        data._decryptErrors = data._decryptErrors || [];
        data._decryptErrors.push({ field: 'total_amount', error: decryptError.message });
        data.total_amount = null;
      }
    }
  }
  return data;
}

module.exports = {
  encrypt,
  decrypt,
  encryptFields,
  decryptFields
};