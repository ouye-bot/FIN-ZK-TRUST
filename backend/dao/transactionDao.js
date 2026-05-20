const { execute } = require('../config/database');
const { decryptFields, encryptFields, encrypt } = require('../utils/sm4Crypto');

/**
 * 创建交易
 * @param {Object} transactionData - 交易数据
 * @returns {Promise<Object>} - 创建的交易
 */
exports.create = async (transactionData, connection) => {
  const { user_id, type, amount, interest, total_amount, status, tx_hash, due_date, term } = transactionData;

  const exec = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : execute;

  const amountData = { amount: Number(amount) };
  const interestData = { interest: Number(interest || 0) };
  const totalAmountData = { total_amount: Number(total_amount || 0) };
  await encryptFields('transactions', amountData, user_id, connection);
  await encryptFields('transactions', interestData, user_id, connection);
  await encryptFields('transactions', totalAmountData, user_id, connection);

  const sql = `
    INSERT INTO transactions (user_id, type, amount, interest, total_amount, status, tx_hash, due_date, term)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const result = await exec(sql, [
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
  return await exports.findById(result.insertId, connection);
};

/**
 * 根据ID查找交易
 * @param {number} id - 交易ID
 * @param {Object} [connection] - 可选事务连接
 * @returns {Promise<Object|null>} - 交易对象
 */
exports.findById = async (id, connection) => {
  const exec = connection
    ? (sql, params) => connection.execute(sql, params).then(([rows]) => rows)
    : execute;
  const sql = 'SELECT * FROM transactions WHERE id = ?';
  const results = await exec(sql, [id]);
  if (results.length > 0) {
    const transaction = {...results[0]};
    await decryptFields('transactions', transaction, results[0].user_id);
    transaction.timestamp = transaction.created_at;
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
  const mapped = [];
  for (const row of results) {
    const transaction = {...row};
    await decryptFields('transactions', transaction, row.user_id);
    transaction.timestamp = transaction.created_at;
    transaction.amount = Number(transaction.amount);
    transaction.interest = Number(transaction.interest);
    transaction.total_amount = Number(transaction.total_amount);
    transaction.term = transaction.term !== null && transaction.term !== undefined ? Number(transaction.term) : null;
    mapped.push(transaction);
  }
  return mapped;
};

/**
 * 根据类型查找交易
 * @param {string} type - 交易类型
 * @returns {Promise<Array>} - 交易列表
 */
exports.findByType = async (type) => {
  const sql = 'SELECT * FROM transactions WHERE type = ? ORDER BY created_at DESC';
  const results = await execute(sql, [type]);
  const mapped = [];
  for (const row of results) {
    const transaction = {...row};
    await decryptFields('transactions', transaction, row.user_id);
    transaction.timestamp = transaction.created_at;

    transaction.amount = Number(transaction.amount);
    transaction.interest = Number(transaction.interest);
    transaction.total_amount = Number(transaction.total_amount);
    mapped.push(transaction);
  }
  return mapped;
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

  const existing = await execute('SELECT user_id FROM transactions WHERE id = ?', [id]);
  if (existing.length === 0) {
    throw new Error('交易不存在');
  }
  const userId = existing[0].user_id;

  const fields = [];
  const params = [];

  for (const [field, value] of Object.entries(updates)) {
    if (['amount', 'interest', 'total_amount', 'paid_amount'].includes(field)) {
      const aad = `transactions:${field}:${userId}`;
      const encrypted = await encrypt(String(Number(value)), userId, aad);
      fields.push(`${field} = ?`);
      params.push(encrypted);
    } else {
      fields.push(`${field} = ?`);
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
  const mapped = [];
  for (const row of results) {
    const transaction = {...row};
    await decryptFields('transactions', transaction, row.user_id);
    transaction.timestamp = transaction.created_at;
    transaction.amount = Number(transaction.amount);
    transaction.interest = Number(transaction.interest);
    transaction.total_amount = Number(transaction.total_amount);
    mapped.push(transaction);
  }
  return mapped;
};