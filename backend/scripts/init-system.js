const { execute, transaction } = require('../config/database');
const { generateSM2KeyPair } = require('../utils/cryptoUtils');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');

const SYSTEM_INIT_SCRIPT = async () => {
  console.log('===== 开始初始化 FinZkTrust 系统 =====');
  
  try {
    // 1. 清空所有表数据
    console.log('1. 清空所有表数据...');
    await transaction(async (conn) => {
      await conn.execute('DELETE FROM token_blacklist');
      await conn.execute('DELETE FROM replay_nonces');
      await conn.execute('DELETE FROM credit_proofs');
      await conn.execute('DELETE FROM transactions');
      await conn.execute('DELETE FROM users');
      await conn.execute('DELETE FROM fund_pool');
      console.log('   ✓ 所有表数据已清空');
    });

    // 2. 初始化资金池
    console.log('2. 初始化资金池...');
    await transaction(async (conn) => {
      await conn.execute(
        'INSERT INTO fund_pool (id, total_amount, available_amount, reserved_amount, total_interest_earned) VALUES (1, 50000, 30000, 0, 0)'
      );
      console.log('   ✓ 资金池已设置');
      console.log('     - 总金额: 50,000 元');
      console.log('     - 可用金额: 30,000 元');
      console.log('     - 已借出金额: 0 元');
      console.log('     - 累计利息: 0 元');
    });

    // 3. 创建系统账户
    console.log('3. 创建系统账户...');
    await transaction(async (conn) => {
      const systemKeyPair = generateSM2KeyPair();
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync('system123456', salt);
      const systemId = Date.now();
      
      await conn.execute(
        `INSERT INTO users (id, username, password_hash, salt, sm2_public_key, balance, credit_score, role) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          systemId,
          'system',
          passwordHash,
          salt,
          systemKeyPair.publicKey,
          '0',
          '600',
          'admin'
        ]
      );
      console.log(`   ✓ 系统账户已创建 (ID: ${systemId})`);
    });

    // 4. 创建测试用户
    console.log('4. 创建测试用户...');
    const testUsers = [
      { username: 'test', password: 'test123456', balance: '10000', creditScore: '650' },
      { username: 'admin', password: 'admin123456', balance: '50000', creditScore: '750' }
    ];
    
    for (const user of testUsers) {
      await transaction(async (conn) => {
        const keyPair = generateSM2KeyPair();
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(user.password, salt);
        const userId = Date.now() + Math.random();
        
        await conn.execute(
          `INSERT INTO users (id, username, password_hash, salt, sm2_public_key, balance, credit_score, role) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId,
            user.username,
            passwordHash,
            salt,
            keyPair.publicKey,
            user.balance,
            user.creditScore,
            'user'
          ]
        );
        console.log(`   ✓ 测试用户 ${user.username} 已创建 (ID: ${userId})`);
        console.log(`     - 余额: ${user.balance} 元`);
        console.log(`     - 信用分: ${user.creditScore}`);
      });
    }

    console.log('\n===== 系统初始化完成 =====');
    console.log('\n📝 测试账号信息:');
    console.log('  系统管理员: system / system123456');
    console.log('  测试用户: test / test123456');
    console.log('  测试用户: admin / admin123456');
    console.log('\n💰 资金池状态:');
    console.log('  总金额: 50,000 元');
    console.log('  可用金额: 30,000 元');
    console.log('  已借出金额: 0 元');
    console.log('\n✅ 系统可以正常使用了！');
    
  } catch (error) {
    console.error('\n❌ 系统初始化失败:', error);
    throw error;
  } finally {
    process.exit(0);
  }
};

// 执行初始化
SYSTEM_INIT_SCRIPT();