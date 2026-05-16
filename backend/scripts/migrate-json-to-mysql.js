const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// 数据目录
const dataDir = path.join(__dirname, '../data');

// 先创建数据库
const createDatabase = async () => {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '123456'
  };
  
  const tempPool = mysql.createPool(config);
  const connection = await tempPool.getConnection();
  
  try {
    await connection.execute('CREATE DATABASE IF NOT EXISTS finzktrust CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    console.log('数据库 finzktrust 创建成功');
  } finally {
    connection.release();
    await tempPool.end();
  }
};

// 读取JSON文件
const readJsonFile = (filename) => {
  const filePath = path.join(dataDir, filename);
  if (!fs.existsSync(filePath)) {
    console.log(`文件 ${filename} 不存在，返回空数组`);
    return [];
  }
  const data = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(data);
};

// 创建表结构
const createTables = async () => {
  console.log('开始创建表结构...');
  
  // 创建users表
  await execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT PRIMARY KEY AUTO_INCREMENT,
      username VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      sm2_public_key TEXT NOT NULL,
      balance DECIMAL(20,2) DEFAULT 0,
      credit_score INT DEFAULT 0,
      role VARCHAR(50) DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('users表创建成功');
  
  // 创建transactions表
  await execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      type VARCHAR(50) NOT NULL,
      amount DECIMAL(20,2) NOT NULL,
      interest DECIMAL(20,2) DEFAULT 0,
      total_amount DECIMAL(20,2) DEFAULT 0,
      status VARCHAR(50) NOT NULL,
      tx_hash VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_status (status),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('transactions表创建成功');
  
  // 创建fund_pool表
  await execute(`
    CREATE TABLE IF NOT EXISTS fund_pool (
      id INT PRIMARY KEY AUTO_INCREMENT,
      total_amount DECIMAL(20,2) DEFAULT 0,
      available_amount DECIMAL(20,2) DEFAULT 0,
      reserved_amount DECIMAL(20,2) DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('fund_pool表创建成功');
  
  // 创建credit_proofs表
  await execute(`
    CREATE TABLE IF NOT EXISTS credit_proofs (
      id INT PRIMARY KEY AUTO_INCREMENT,
      user_id INT NOT NULL,
      proof_id VARCHAR(255) UNIQUE NOT NULL,
      verification_code VARCHAR(255) NOT NULL,
      sm3_hash VARCHAR(255) NOT NULL,
      proof_data TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user_id (user_id),
      INDEX idx_proof_id (proof_id),
      INDEX idx_expires_at (expires_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('credit_proofs表创建成功');
};

// 迁移用户数据
const migrateUsers = async () => {
  console.log('开始迁移用户数据...');
  const users = readJsonFile('users.json');
  
  for (const user of users) {
    await execute(`
      INSERT INTO users (username, password_hash, sm2_public_key, balance, credit_score)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        password_hash = VALUES(password_hash),
        sm2_public_key = VALUES(sm2_public_key),
        balance = VALUES(balance),
        credit_score = VALUES(credit_score)
    `, [user.username, user.passwordHash, user.sm2PublicKey, user.balance || 0, user.creditScore || 600]);
  }
  
  console.log(`迁移了 ${users.length} 个用户`);
  return users.length;
};

// 迁移资金池数据
const migratePool = async () => {
  console.log('开始迁移资金池数据...');
  const pool = readJsonFile('pool.json');
  
  if (pool) {
    const totalAmount = pool.originalPool?.currentBalance + (pool.userPool?.totalBalance || 0);
    const availableAmount = pool.userPool?.totalBalance || 0;
    const reservedAmount = pool.originalPool?.currentBalance || 0;
    
    await execute(`
      INSERT INTO fund_pool (id, total_amount, available_amount, reserved_amount)
      VALUES (1, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        total_amount = VALUES(total_amount),
        available_amount = VALUES(available_amount),
        reserved_amount = VALUES(reserved_amount)
    `, [totalAmount, availableAmount, reservedAmount]);
    
    console.log('资金池数据迁移成功');
    return 1;
  }
  
  console.log('资金池数据不存在，初始化默认值');
  await execute(`
    INSERT INTO fund_pool (id, total_amount, available_amount, reserved_amount)
    VALUES (1, 10000, 10000, 0)
    ON DUPLICATE KEY UPDATE
      total_amount = VALUES(total_amount),
      available_amount = VALUES(available_amount),
      reserved_amount = VALUES(reserved_amount)
  `);
  return 1;
};

// 迁移交易数据
const migrateTransactions = async () => {
  console.log('开始迁移交易数据...');
  const transactions = readJsonFile('transactions.json');
  
  for (const tx of transactions) {
    // 确定用户ID
    let userId = tx.toUserId || tx.fromUserId;
    if (userId === 'pool') {
      userId = 1; // 系统账户
    }
    
    await execute(`
      INSERT INTO transactions (user_id, type, amount, interest, total_amount, status, tx_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        type = VALUES(type),
        amount = VALUES(amount),
        interest = VALUES(interest),
        total_amount = VALUES(total_amount),
        status = VALUES(status),
        tx_hash = VALUES(tx_hash)
    `, [userId, tx.type, tx.amount, tx.interest || 0, tx.totalRepay || tx.totalRepayment || (tx.amount + (tx.interest || 0)), tx.status, tx.hash]);
  }
  
  console.log(`迁移了 ${transactions.length} 条交易`);
  return transactions.length;
};

// 迁移信用证明数据
const migrateCreditProofs = async () => {
  console.log('开始迁移信用证明数据...');
  const proofs = readJsonFile('credit_proofs.json');
  
  for (const proof of proofs) {
    await execute(`
      INSERT INTO credit_proofs (user_id, proof_id, verification_code, sm3_hash, proof_data, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        verification_code = VALUES(verification_code),
        sm3_hash = VALUES(sm3_hash),
        proof_data = VALUES(proof_data),
        expires_at = VALUES(expires_at)
    `, [proof.userId, proof.id, proof.verificationCode, proof.hash, JSON.stringify({
      userId: proof.userId,
      creditScore: proof.creditScore,
      signature: proof.signature,
      zkProof: proof.zkProof,
      timestamp: proof.timestamp
    }), new Date(proof.expiresAt)]);
  }
  
  console.log(`迁移了 ${proofs.length} 个信用证明`);
  return proofs.length;
};

// 验证迁移结果
const verifyMigration = async () => {
  console.log('开始验证迁移结果...');
  
  const [usersCount] = await execute('SELECT COUNT(*) FROM users');
  const [transactionsCount] = await execute('SELECT COUNT(*) FROM transactions');
  const [poolCount] = await execute('SELECT COUNT(*) FROM fund_pool');
  const [proofsCount] = await execute('SELECT COUNT(*) FROM credit_proofs');
  
  console.log('迁移结果验证：');
  console.log(`- 用户数: ${usersCount[0]['COUNT(*)']}`);
  console.log(`- 交易数: ${transactionsCount[0]['COUNT(*)']}`);
  console.log(`- 资金池记录: ${poolCount[0]['COUNT(*)']}`);
  console.log(`- 信用证明数: ${proofsCount[0]['COUNT(*)']}`);
};

// 主函数
const main = async () => {
  try {
    // 1. 先创建数据库
    await createDatabase();
    
    // 2. 导入数据库连接
    const { execute, transaction } = require('../config/database');
    
    // 3. 创建表结构
    console.log('开始创建表结构...');
    
    // 先删除现有表，以便重新创建
    try {
      await execute('DROP TABLE IF EXISTS credit_proofs');
      await execute('DROP TABLE IF EXISTS transactions');
      await execute('DROP TABLE IF EXISTS fund_pool');
      await execute('DROP TABLE IF EXISTS users');
      console.log('已删除现有表');
    } catch (error) {
      console.error('删除表时出错:', error);
    }
    
    // 创建users表
    await execute(`
      CREATE TABLE users (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        sm2_public_key TEXT NOT NULL,
        balance DECIMAL(20,2) DEFAULT 0,
        credit_score INT DEFAULT 0,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_username (username)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('users表创建成功');
    
    // 创建transactions表
    await execute(`
      CREATE TABLE transactions (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        type VARCHAR(50) NOT NULL,
        amount DECIMAL(20,2) NOT NULL,
        interest DECIMAL(20,2) DEFAULT 0,
        total_amount DECIMAL(20,2) DEFAULT 0,
        status VARCHAR(50) NOT NULL,
        tx_hash VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_created_at (created_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('transactions表创建成功');
    
    // 创建fund_pool表
    await execute(`
      CREATE TABLE fund_pool (
        id INT PRIMARY KEY AUTO_INCREMENT,
        total_amount DECIMAL(20,2) DEFAULT 0,
        available_amount DECIMAL(20,2) DEFAULT 0,
        reserved_amount DECIMAL(20,2) DEFAULT 0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('fund_pool表创建成功');
    
    // 创建credit_proofs表
    await execute(`
      CREATE TABLE credit_proofs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        proof_id VARCHAR(255) UNIQUE NOT NULL,
        verification_code VARCHAR(255) NOT NULL,
        sm3_hash VARCHAR(255) NOT NULL,
        proof_data TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_proof_id (proof_id),
        INDEX idx_expires_at (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('credit_proofs表创建成功');
    
    // 4. 迁移用户数据
    console.log('开始迁移用户数据...');
    const users = readJsonFile('users.json');
    
    for (const user of users) {
      await execute(`
        INSERT INTO users (username, password_hash, sm2_public_key, balance, credit_score)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          password_hash = VALUES(password_hash),
          sm2_public_key = VALUES(sm2_public_key),
          balance = VALUES(balance),
          credit_score = VALUES(credit_score)
      `, [user.username, user.passwordHash || '', user.sm2PublicKey || '', user.balance || 0, user.creditScore || 600]);
    }
    
    console.log(`迁移了 ${users.length} 个用户`);
    const userCount = users.length;
    
    // 5. 迁移资金池数据
    console.log('开始迁移资金池数据...');
    const pool = readJsonFile('pool.json');
    
    if (pool) {
      const totalAmount = pool.originalPool?.currentBalance + (pool.userPool?.totalBalance || 0);
      const availableAmount = pool.userPool?.totalBalance || 0;
      const reservedAmount = pool.originalPool?.currentBalance || 0;
      
      await execute(`
        INSERT INTO fund_pool (id, total_amount, available_amount, reserved_amount)
        VALUES (1, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          total_amount = VALUES(total_amount),
          available_amount = VALUES(available_amount),
          reserved_amount = VALUES(reserved_amount)
      `, [totalAmount, availableAmount, reservedAmount]);
      
      console.log('资金池数据迁移成功');
    } else {
      console.log('资金池数据不存在，初始化默认值');
      await execute(`
        INSERT INTO fund_pool (id, total_amount, available_amount, reserved_amount)
        VALUES (1, 10000, 10000, 0)
        ON DUPLICATE KEY UPDATE
          total_amount = VALUES(total_amount),
          available_amount = VALUES(available_amount),
          reserved_amount = VALUES(reserved_amount)
      `);
    }
    const poolCount = 1;
    
    // 6. 迁移交易数据
    console.log('开始迁移交易数据...');
    const transactions = readJsonFile('transactions.json');
    
    for (const tx of transactions) {
      // 确定用户ID
      let userId = 1; // 默认系统账户
      if (tx.toUserId && !isNaN(tx.toUserId)) {
        userId = parseInt(tx.toUserId);
      } else if (tx.fromUserId && !isNaN(tx.fromUserId)) {
        userId = parseInt(tx.fromUserId);
      }
      
      // 检查用户是否存在，如果不存在则创建
      const users = await execute('SELECT id FROM users WHERE id = ?', [userId]);
      if (users.length === 0) {
        // 创建默认用户
        await execute(`
          INSERT INTO users (id, username, password_hash, sm2_public_key)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            username = VALUES(username),
            password_hash = VALUES(password_hash),
            sm2_public_key = VALUES(sm2_public_key)
        `, [userId, `user_${userId}`, '', '']);
        console.log(`创建了用户 ${userId}`);
      }
      
      await execute(`
        INSERT INTO transactions (user_id, type, amount, interest, total_amount, status, tx_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          type = VALUES(type),
          amount = VALUES(amount),
          interest = VALUES(interest),
          total_amount = VALUES(total_amount),
          status = VALUES(status),
          tx_hash = VALUES(tx_hash)
      `, [userId, tx.type || 'unknown', tx.amount || 0, tx.interest || 0, tx.totalRepay || tx.totalRepayment || (tx.amount || 0) + (tx.interest || 0), tx.status || 'pending', tx.hash || null]);
    }
    
    console.log(`迁移了 ${transactions.length} 条交易`);
    const transactionCount = transactions.length;
    
    // 7. 迁移信用证明数据
    console.log('开始迁移信用证明数据...');
    const proofs = readJsonFile('credit_proofs.json');
    
    for (const proof of proofs) {
      let userId = parseInt(proof.userId);
      
      // 检查用户是否存在，如果不存在则创建
      const users = await execute('SELECT id FROM users WHERE id = ?', [userId]);
      if (users.length === 0) {
        // 创建默认用户
        await execute(`
          INSERT INTO users (id, username, password_hash, sm2_public_key)
          VALUES (?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            username = VALUES(username),
            password_hash = VALUES(password_hash),
            sm2_public_key = VALUES(sm2_public_key)
        `, [userId, `user_${userId}`, '', '']);
        console.log(`创建了用户 ${userId}`);
      }
      
      await execute(`
        INSERT INTO credit_proofs (user_id, proof_id, verification_code, sm3_hash, proof_data, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          verification_code = VALUES(verification_code),
          sm3_hash = VALUES(sm3_hash),
          proof_data = VALUES(proof_data),
          expires_at = VALUES(expires_at)
      `, [userId, proof.id || '', proof.verificationCode || '', proof.hash || '', JSON.stringify({
        userId: proof.userId || userId,
        creditScore: proof.creditScore || 0,
        signature: proof.signature || '',
        zkProof: proof.zkProof || {},
        timestamp: proof.timestamp || Date.now()
      }), new Date(proof.expiresAt || Date.now())]);
    }
    
    console.log(`迁移了 ${proofs.length} 个信用证明`);
    const proofCount = proofs.length;
    
    // 8. 验证迁移结果
    console.log('开始验证迁移结果...');
    
    const usersCount = await execute('SELECT COUNT(*) FROM users');
    const transactionsCount = await execute('SELECT COUNT(*) FROM transactions');
    const poolCountResult = await execute('SELECT COUNT(*) FROM fund_pool');
    const proofsCount = await execute('SELECT COUNT(*) FROM credit_proofs');
    
    console.log('迁移结果验证：');
    console.log(`- 用户数: ${usersCount[0]['COUNT(*)']}`);
    console.log(`- 交易数: ${transactionsCount[0]['COUNT(*)']}`);
    console.log(`- 资金池记录: ${poolCountResult[0]['COUNT(*)']}`);
    console.log(`- 信用证明数: ${proofsCount[0]['COUNT(*)']}`);
    
    console.log('\n数据迁移完成！');
    console.log(`总计迁移：`);
    console.log(`- ${userCount} 个用户`);
    console.log(`- ${poolCount} 条资金池记录`);
    console.log(`- ${transactionCount} 条交易`);
    console.log(`- ${proofCount} 个信用证明`);
    
  } catch (error) {
    console.error('数据迁移失败:', error);
  }
};

// 执行主函数
main();
