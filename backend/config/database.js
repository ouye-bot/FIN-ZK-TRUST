const mysql = require('mysql2/promise');

// 数据库配置
const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '123456',
  database: process.env.DB_NAME || 'finzktrust',
  waitForConnections: true,
  connectionLimit: 10,     // 8 进程 × 10 连接 = 80 总连接，仅占 MySQL 上限 500 的 16%
  queueLimit: 200,         // 允许最多 200 个请求排队（模块4单进程200并发全部排队）
  connectTimeout: 5000,    // 获取连接超时 5 秒
  idleTimeout: 30000,      // 空闲连接 30 秒后释放
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
};

// 先创建数据库
const createDatabase = async () => {
  try {
    // 不指定数据库连接
    const tempConfig = { ...config };
    delete tempConfig.database;
    
    const tempPool = mysql.createPool(tempConfig);
    const connection = await tempPool.getConnection();
    
    // 创建数据库
    await connection.execute(`CREATE DATABASE IF NOT EXISTS ${config.database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`数据库 ${config.database} 创建成功`);
    
    connection.release();
    tempPool.end();
  } catch (error) {
    console.error('创建数据库失败:', error);
  }
};

// 执行数据库创建
createDatabase();

// 验证 SM4 密钥加载
try {
  const { getSM4Key } = require('../utils/sm4Crypto');
  getSM4Key();
  console.log('SM4 密钥加载成功');
} catch (e) {
  console.warn('SM4 密钥未配置');
}

// 创建连接池
const pool = mysql.createPool(config);

/**
 * 执行SQL语句
 * @param {string} sql - SQL语句
 * @param {Array} params - 参数数组
 * @returns {Promise<Array>} - 结果数组
 */
exports.execute = async (sql, params = []) => {
  let connection;
  try {
    connection = await pool.getConnection();
    const [results] = await connection.execute(sql, params);
    return results;
  } catch (error) {
    console.error('数据库执行错误:', error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/**
 * 执行事务
 * @param {Function} callback - 事务回调函数
 * @returns {Promise<any>} - 事务结果
 */
exports.transaction = async (callback) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    if (connection) {
      await connection.rollback();
    }
    console.error('事务执行错误:', error);
    throw error;
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

exports.pool = pool;
