const { execute, transaction } = require('../config/database');

/**
 * 获取资金池信息
 * @returns {Promise<Object>} - 资金池信息
 */
exports.getPool = async () => {
  const sql = 'SELECT * FROM fund_pool WHERE id = 1';
  const results = await execute(sql);
  if (results.length > 0) {
    const pool = results[0];
    // 旧字段类型转换
    pool.total_amount = Number(pool.total_amount);
    pool.available_amount = Number(pool.available_amount);
    pool.reserved_amount = Number(pool.reserved_amount);
    pool.total_interest_earned = Number(pool.total_interest_earned || 0);
    // 新字段类型转换
    pool.platform_capital = Number(pool.platform_capital || 0);
    pool.user_capital = Number(pool.user_capital || 0);
    pool.loaned_amount = Number(pool.loaned_amount || 0);
    return pool;
  }
  // 如果不存在，创建初始记录（兼容旧逻辑）
  await execute(`
    INSERT INTO fund_pool (id, total_amount, available_amount, reserved_amount, total_interest_earned,
      platform_capital, user_capital, loaned_amount)
    VALUES (1, 0, 0, 0, 0, 0, 0, 0)
  `);
  return {
    id: 1,
    total_amount: 0,
    available_amount: 0,
    reserved_amount: 0,
    total_interest_earned: 0,
    platform_capital: 0,
    user_capital: 0,
    loaned_amount: 0
  };
};

/**
 * 更新资金池信息
 * @param {Object} poolData - 资金池数据
 * @returns {Promise<Object>} - 更新后的资金池
 */
exports.updatePool = async (poolData) => {
  let { total_amount, available_amount, reserved_amount, total_interest_earned } = poolData;
  
  console.log('[poolDao] updatePool called with:', { total_amount, available_amount, reserved_amount, total_interest_earned });
  
  return await transaction(async (connection) => {
    // 锁定行
    const [results] = await connection.execute('SELECT * FROM fund_pool WHERE id = 1 FOR UPDATE');
    console.log('[poolDao] SELECT results:', results.length, 'rows');
    
    // 如果调用方未传入 total_interest_earned，保持数据库原值不变
    if (total_interest_earned === undefined) {
      if (results.length > 0) {
        total_interest_earned = Number(results[0].total_interest_earned) || 0;
      } else {
        total_interest_earned = 0;
      }
    }
    
    if (results.length === 0) {
      // 如果不存在，创建记录
      console.log('[poolDao] No existing row, INSERTING new record');
      await connection.execute(`
        INSERT INTO fund_pool (id, total_amount, available_amount, reserved_amount, total_interest_earned)
        VALUES (1, ?, ?, ?, ?)
      `, [
        Number(total_amount),
        Number(available_amount),
        Number(reserved_amount),
        Number(total_interest_earned)
      ]);
    } else {
      // 更新记录
      console.log('[poolDao] Existing row found, UPDATE it');
      await connection.execute(`
        UPDATE fund_pool 
        SET total_amount = ?, available_amount = ?, reserved_amount = ?, total_interest_earned = ? 
        WHERE id = 1
      `, [
        Number(total_amount),
        Number(available_amount),
        Number(reserved_amount),
        Number(total_interest_earned)
      ]);
    }
    
    // 返回更新后的资金池
    const [updatedResults] = await connection.execute('SELECT * FROM fund_pool WHERE id = 1');
    console.log('[poolDao] After update, pool:', updatedResults[0]);
    const pool = updatedResults[0];
    pool.total_amount = Number(pool.total_amount);
    pool.available_amount = Number(pool.available_amount);
    pool.reserved_amount = Number(pool.reserved_amount);
    pool.total_interest_earned = Number(pool.total_interest_earned || 0);
    return pool;
  });
};

/**
 * 更新资金池信息（V2 新模型）
 * @param {Object} poolData - 资金池数据
 * @returns {Promise<Object>} - 更新后的资金池
 */
exports.updatePoolV2 = async ({ platform_capital, user_capital, loaned_amount, total_interest_earned }) => {
  const pc = Number(platform_capital);
  const uc = Number(user_capital);
  const la = Number(loaned_amount);
  const total_amount = pc + uc;
  const available_amount = total_amount - la;
  const reserved_amount = la;

  return await transaction(async (connection) => {
    const [results] = await connection.execute('SELECT * FROM fund_pool WHERE id = 1 FOR UPDATE');

    let tie = total_interest_earned !== undefined ? Number(total_interest_earned) : Number(results[0]?.total_interest_earned || 0);

    await connection.execute(`
      UPDATE fund_pool
      SET platform_capital = ?, user_capital = ?, loaned_amount = ?,
          total_amount = ?, available_amount = ?, reserved_amount = ?, total_interest_earned = ?
      WHERE id = 1
    `, [pc, uc, la, total_amount, available_amount, reserved_amount, tie]);

    const [updatedResults] = await connection.execute('SELECT * FROM fund_pool WHERE id = 1');
    const pool = updatedResults[0];
    pool.total_amount = Number(pool.total_amount);
    pool.available_amount = Number(pool.available_amount);
    pool.reserved_amount = Number(pool.reserved_amount);
    pool.total_interest_earned = Number(pool.total_interest_earned || 0);
    pool.platform_capital = Number(pool.platform_capital || 0);
    pool.user_capital = Number(pool.user_capital || 0);
    pool.loaned_amount = Number(pool.loaned_amount || 0);
    return pool;
  });
};
