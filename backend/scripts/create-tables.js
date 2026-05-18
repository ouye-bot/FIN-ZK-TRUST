const { execute } = require('../config/database');

// 创建数据库表
const createTables = async () => {
  try {
    console.log('开始创建数据库表...');
    
    // 创建users表
    await execute(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        salt VARCHAR(255) NOT NULL,
        sm2_public_key TEXT NOT NULL,
        balance TEXT,
        credit_score TEXT,
        role VARCHAR(50) DEFAULT 'user',
        totp_secret VARCHAR(500) DEFAULT NULL,
        totp_enabled BOOLEAN DEFAULT FALSE,
        backup_codes_hashed TEXT DEFAULT NULL,
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
        user_id BIGINT NOT NULL,
        type VARCHAR(50) NOT NULL,
        amount TEXT,
        interest TEXT,
        total_amount TEXT,
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
        total_interest_earned DECIMAL(20,2) DEFAULT 0.00 COMMENT '平台已赚取的总利息收入',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('fund_pool表创建成功');

    // 兼容 MySQL 5.7/8.0：先检查字段是否存在，再决定是否添加
    const addColumnIfNotExists = async (table, column, definition) => {
      const rows = await execute(`
        SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
      `, [table, column]);
      if (rows[0].cnt === 0) {
        await execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`${table}.${column} 字段已添加`);
      } else {
        console.log(`${table}.${column} 字段已存在，跳过`);
      }
    };

    // 为已有表添加新字段（幂等操作）
    await addColumnIfNotExists('fund_pool', 'total_interest_earned', "DECIMAL(20,2) DEFAULT 0.00 COMMENT '平台已赚取的总利息收入'");
    await addColumnIfNotExists('fund_pool', 'platform_capital', "DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '平台自有资金'");
    await addColumnIfNotExists('fund_pool', 'user_capital', "DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '用户出资总额'");
    await addColumnIfNotExists('fund_pool', 'loaned_amount', "DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT '已借出本金总额'");
    console.log('fund_pool表新字段迁移完成');

    // 初始化新字段数据（幂等：仅当新字段为默认值时执行）
    try {
      await execute(`
        UPDATE fund_pool
        SET platform_capital = 10000,
            user_capital = total_amount - 10000,
            loaned_amount = reserved_amount
        WHERE platform_capital = 0 AND user_capital = 0 AND loaned_amount = 0
      `);
      console.log('fund_pool表新字段数据初始化完成');
    } catch (e) {
      console.log('fund_pool表新字段数据初始化跳过:', e.message);
    }

    // 为transactions表添加term字段（幂等操作）
    await addColumnIfNotExists('transactions', 'term', "INT DEFAULT NULL COMMENT '投资期限(天)'");
    console.log('transactions表字段检查完成');

    // 创建credit_proofs表
    await execute(`
      CREATE TABLE IF NOT EXISTS credit_proofs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        proof_id VARCHAR(255) UNIQUE NOT NULL,
        verification_code VARCHAR(255) NOT NULL,
        sm3_hash VARCHAR(255) NOT NULL,
        proof_data TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        zk_proof TEXT DEFAULT NULL COMMENT 'snarkjs proof JSON (pi_a, pi_b, pi_c)',
        public_signals TEXT DEFAULT NULL COMMENT 'publicSignals array JSON',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_proof_id (proof_id),
        INDEX idx_expires_at (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('credit_proofs表创建成功');

    // 为credit_proofs表添加ZKP持久化字段（幂等操作）
    await addColumnIfNotExists('credit_proofs', 'zk_proof', "TEXT DEFAULT NULL COMMENT 'snarkjs proof JSON (pi_a, pi_b, pi_c)'");
    await addColumnIfNotExists('credit_proofs', 'public_signals', "TEXT DEFAULT NULL COMMENT 'publicSignals array JSON'");
    console.log('credit_proofs表ZKP持久化字段迁移完成');
    
    // 创建replay_nonces表
    await execute(`
      CREATE TABLE IF NOT EXISTS replay_nonces (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        nonce VARCHAR(64) NOT NULL UNIQUE,
        expires_at BIGINT NOT NULL COMMENT '过期时间戳（毫秒）',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('replay_nonces表创建成功');
    
    // 创建token_blacklist表
    await execute(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        jti VARCHAR(64) NOT NULL UNIQUE,
        expires_at BIGINT NOT NULL COMMENT '过期时间戳（毫秒）',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('token_blacklist表创建成功');
    
    // 创建user_keys表（Round 4：每用户独立 DEK）
    await execute(`
      CREATE TABLE IF NOT EXISTS user_keys (
        user_id       BIGINT PRIMARY KEY,
        encrypted_dek TEXT NOT NULL COMMENT 'DEK 被 Master Key 加密后的密文（SM4-CBC + HMAC-SM3 格式）',
        created_at    BIGINT NOT NULL COMMENT '创建时间戳',
        rotated_at    BIGINT DEFAULT NULL COMMENT '最近一次密钥轮换时间戳',
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('user_keys表创建成功');
    
    console.log('所有表创建完成');
  } catch (error) {
    console.error('创建表时出错:', error);
  } finally {
    process.exit(0);
  }
};

// 执行创建表操作
createTables();