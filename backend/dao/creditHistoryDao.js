const { execute } = require('../config/database');

/**
 * 创建信用历史记录
 */
exports.create = async ({ user_id, score, change_amount, reason, transaction_id = null }) => {
  const sql = `
    INSERT INTO credit_history (user_id, score, change_amount, reason, transaction_id)
    VALUES (?, ?, ?, ?, ?)
  `;
  const result = await execute(sql, [user_id, score, change_amount, reason, transaction_id]);
  return { id: result.insertId, user_id, score, change_amount, reason, transaction_id };
};

/**
 * 查询用户信用历史
 */
exports.findByUserId = async (userId, limit = 50) => {
  const sql = 'SELECT * FROM credit_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ?';
  return await execute(sql, [userId, limit]);
};
