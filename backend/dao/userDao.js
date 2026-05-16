const { execute, transaction } = require('../config/database');
const { decryptFields, encryptFields } = require('../utils/sm4Crypto');

/**
 * 根据用户名查找用户
 * @param {string} username - 用户名
 * @returns {Promise<Object|null>} - 用户对象
 */
exports.findByUsername = async (username) => {
  const sql = 'SELECT * FROM users WHERE username = ?';
  const results = await execute(sql, [username]);
  const user = results.length > 0 ? results[0] : null;
  if (user) {
    decryptFields('users', user);
  }
  return user;
};

/**
 * 根据ID查找用户
 * @param {number} id - 用户ID
 * @returns {Promise<Object|null>} - 用户对象
 */
exports.findById = async (id) => {
  const sql = 'SELECT * FROM users WHERE id = ?';
  const results = await execute(sql, [id]);
  const user = results.length > 0 ? results[0] : null;
  if (user) {
    decryptFields('users', user);
  }
  return user;
};

/**
 * 创建用户
 * @param {Object} userData - 用户数据
 * @returns {Promise<Object>} - 创建的用户
 */
exports.create = async (userData) => {
  const { username, password_hash, salt, sm2_public_key } = userData;
  const initialBalance = 0;
  const initialCreditScore = 600;

  const balanceData = { balance: initialBalance };
  const creditScoreData = { credit_score: initialCreditScore };
  encryptFields('users', balanceData);
  encryptFields('users', creditScoreData);

  const sql = `
    INSERT INTO users (username, password_hash, salt, sm2_public_key, balance, credit_score, role)
    VALUES (?, ?, ?, ?, ?, ?, 'user')
  `;
  const result = await execute(sql, [
    username,
    password_hash,
    salt || '',
    sm2_public_key,
    balanceData.balance,
    creditScoreData.credit_score
  ]);
  return await exports.findById(result.insertId);
};

/**
 * 更新用户余额
 * @param {number} id - 用户ID
 * @param {number} newBalance - 新余额
 * @returns {Promise<Object>} - 更新后的用户
 */
exports.updateBalance = async (id, newBalance) => {
  const balanceData = { balance: Number(newBalance) };
  encryptFields('users', balanceData);
  const sql = 'UPDATE users SET balance = ? WHERE id = ?';
  await execute(sql, [balanceData.balance, id]);
  return await exports.findById(id);
};

/**
 * 更新用户信用分
 * @param {number} id - 用户ID
 * @param {number} newScore - 新信用分
 * @returns {Promise<Object>} - 更新后的用户
 */
exports.updateCreditScore = async (id, newScore) => {
  const creditScoreData = { credit_score: Number(newScore) };
  encryptFields('users', creditScoreData);
  const sql = 'UPDATE users SET credit_score = ? WHERE id = ?';
  await execute(sql, [creditScoreData.credit_score, id]);
  return await exports.findById(id);
};

/**
 * 更新 TOTP 密钥（加密后的）
 * @param {number} id - 用户ID
 * @param {string} encryptedSecret - 加密后的 TOTP 密钥
 * @returns {Promise<void>}
 */
exports.updateTotpSecret = async (id, encryptedSecret) => {
  const sql = 'UPDATE users SET totp_secret = ? WHERE id = ?';
  await execute(sql, [encryptedSecret, id]);
};

/**
 * 启用 TOTP 并存储备用码哈希
 * @param {number} id - 用户ID
 * @param {string} hashedBackupCodes - JSON 格式的备用码哈希数组
 * @returns {Promise<void>}
 */
exports.enableTotp = async (id, hashedBackupCodes) => {
  const sql = 'UPDATE users SET totp_enabled = TRUE, backup_codes_hashed = ? WHERE id = ?';
  await execute(sql, [hashedBackupCodes, id]);
};

/**
 * 禁用 TOTP
 * @param {number} id - 用户ID
 * @returns {Promise<void>}
 */
exports.disableTotp = async (id) => {
  const sql = 'UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, backup_codes_hashed = NULL WHERE id = ?';
  await execute(sql, [id]);
};

/**
 * 获取用户的 TOTP 数据
 * @param {number} id - 用户ID
 * @returns {Promise<Object>} - 包含 totp_secret, totp_enabled, backup_codes_hashed
 */
exports.getTotpData = async (id) => {
  const sql = 'SELECT totp_secret, totp_enabled, backup_codes_hashed FROM users WHERE id = ?';
  const results = await execute(sql, [id]);
  if (results.length === 0) {
    return null;
  }
  return {
    totpSecret: results[0].totp_secret,
    totpEnabled: results[0].totp_enabled || false,
    backupCodesHashed: results[0].backup_codes_hashed
  };
};

/**
 * 更新单个备用码哈希（使用后移除）
 * @param {number} id - 用户ID
 * @param {Array<string>} remainingHashedCodes - 剩余的备用码哈希数组
 * @returns {Promise<void>}
 */
exports.updateBackupCodes = async (id, remainingHashedCodes) => {
  const sql = 'UPDATE users SET backup_codes_hashed = ? WHERE id = ?';
  await execute(sql, [JSON.stringify(remainingHashedCodes), id]);
};