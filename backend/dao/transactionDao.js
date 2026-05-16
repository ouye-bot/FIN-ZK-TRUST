const { execute } = require('../config/database');
const { decryptFields, encryptFields } = require('../utils/sm4Crypto');

/**
 * 创建交易
 * @param {Object} transactionData - 交易数据
 * @returns {Promise<Object>} - 创建的交易
 */
exports.create = async (transactionData) => {
  const { user_id, type, amount, interest, total_amount, status, tx_hash, due_date, term } = transactionData;

  const amountData = { amount: Number(amount) };
  const interestData = { interest: Number(interest || 0) };
  const totalAmountData = { total_amount: Number(total_amount || 0) };
  encryptFields('transactions', amountData);
  encryptFields('transactions', interestData);
  encryptFields('transactions', totalAmountData);

  const sql = `
    INSERT INTO transactions (user_id, type, amount, interest, total_amount, status, tx_hash, due_date, term)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const result = await execute(sql, [
    user_id,
    type,
    amountData.amount,
    interestData.interest,
    totalAmountData.total_amount,
    status,
    tx_hash || null,
    due_date || null,
    term || null
  ]);
  return await exports.findById(result.insertId);
};

/**
 * 根据ID查找交易
 * @param {number} id - 交易ID
 * @returns {Promise<Object|null>} - 交易对象
 */
exports.findById = async (id) => {
  const sql = 'SELECT * FROM transactions WHERE id = ?';
  const results = await execute(sql, [id]);
  if (results.length > 0) {
    const transaction = {...results[0]};
    decryptFields('transactions', transaction);
    transaction.timestamp = transaction.created_at;
    // 确保数值字段正确转换
    transaction.amount = Number(transaction.amount);
    transaction.interest = Number(transaction.interest);
    transaction.total_amount = Number(transaction.total_amount);
    transaction.term = transaction.term !== null && transaction.term !== undefined ? Number(transaction.term) : null;
    return transaction;
  }
  return null;
};

/**
 * 根据用户ID查找交易
 * @param {number} userId - 用户ID
 * @param {Object} options - 选项
 * @returns {Promise<Array>} - 交易列表
 */
exports.findByUserId = async (userId, options = {}) => {
  const { limit, offset, type, status } = options;
  let sql = 'SELECT * FROM transactions WHERE user_id = ?';
  const params = [userId];
  
  if (type) {
    sql += ' AND type = ?';
    params.push(type);
  }
  
  if (status) {
    sql += ' AND status = ?';
    params.push(status);
  }
  
  sql += ' ORDER BY created_at DESC';
  
  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }
  
  if (offset) {
    sql += ' OFFSET ?';
    params.push(offset);
  }
  
  const results = await execute(sql, params);
  return results.map(row => {
    const transaction = {...row};
    decryptFields('transactions', transaction);
    transaction.timestamp = transaction.created_at;
    // 确保数值字段正确转换
    transaction.amount = Number(transaction.amount);
    transaction.interest = Number(transaction.interest);
    transaction.total_amount = Number(transaction.total_amount);
    transaction.term = transaction.term !== null && transaction.term !== undefined ? Number(transaction.term) : null;
    return transaction;
  });
};

/**
 * 根据类型查找交易
 * @param {string} type - 交易类型
 * @returns {Promise<Array>} - 交易列表
 */
exports.findByType = async (type) => {
  const sql = 'SELECT * FROM transactions WHERE type = ? ORDER BY created_at DESC';
  const results = await execute(sql, [type]);
  return results.map(row => {
    const transaction = {...row};
    decryptFields('transactions', transaction);
    transaction.timestamp = transaction.created_at;
    // 确保数值字段正确转换
    transaction.amount = Number(transaction.amount);
    transaction.interest = Number(transaction.interest);
    transaction.total_amount = Number(transaction.total_amount);
    return transaction;
  });
};

/**
 * 更新交易状态
 * @param {number} id - 交易ID
 * @param {string} status - 新状态
 * @param {string} tx_hash - 交易哈希
 * @returns {Promise<Object>} - 更新后的交易
 */
exports.updateStatus = async (id, status, tx_hash = null) => {
  const sql = 'UPDATE transactions SET status = ?, tx_hash = ? WHERE id = ?';
  await execute(sql, [status, tx_hash, id]);
  return await exports.findById(id);
};

/**
 * 通用更新交易方法
 * @param {number} id - 交易ID
 * @param {Object} updates - 要更新的字段对象
 * @returns {Promise<Object>} - 更新后的交易
 */
exports.update = async (id, updates) => {
  if (!updates || Object.keys(updates).length === 0) {
    return await exports.findById(id);
  }

  const fields = [];
  const params = [];

  for (const [field, value] of Object.entries(updates)) {
    fields.push(`${field} = ?`);
    
    if (['amount', 'interest', 'total_amount', 'paid_amount'].includes(field)) {
      params.push(Number(value));
    } else {
      params.push(value);
    }
  }

  params.push(id);

  const sql = `UPDATE transactions SET ${fields.join(', ')} WHERE id = ?`;
  await execute(sql, params);
  
  return await exports.findById(id);
};

/**
 * 根据状态查找交易
 * @param {string} status - 状态
 * @returns {Promise<Array>} - 交易列表
 */
exports.findByStatus = async (status) => {
  const sql = 'SELECT * FROM transactions WHERE status = ? ORDER BY created_at DESC';
  const results = await execute(sql, [status]);
  return results.map(row => {
    const transaction = {...row};
    decryptFields('transactions', transaction);
    transaction.timestamp = transaction.created_at;
    // 确保数值字段正确转换
    transaction.amount = Number(transaction.amount);
    transaction.interest = Number(transaction.interest);
    transaction.total_amount = Number(transaction.total_amount);
    return transaction;
  });
};