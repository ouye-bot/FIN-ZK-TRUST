require('dotenv').config();
const crypto = require('crypto');
const { transaction, execute } = require('../config/database');
const { reEncrypt } = require('../utils/sm4Crypto');
const { generateRandomHex, hashKey, getKey } = require('../utils/keyManager');

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const newKeyIndex = args.indexOf('--new-key');
let newKeyProvided = newKeyIndex !== -1 ? args[newKeyIndex + 1] : null;

async function rotateKey() {
  console.log('=== 开始 SM4 密钥轮换 ===');
  console.log(`模式: ${isDryRun ? 'DRY-RUN（仅统计）' : '实际执行'}`);

  try {
    const oldKey = getKey('SM4_MASTER_KEY');
    if (!oldKey) {
      console.error('错误：当前 SM4_MASTER_KEY 未配置');
      process.exit(1);
    }

    let newKey = newKeyProvided;
    if (!newKey) {
      newKey = generateRandomHex(32);
      console.log(`已生成新密钥 (SHA256): ${hashKey(newKey).substring(0, 32)}...`);
    } else {
      if (!/^[0-9a-fA-F]{32}$/.test(newKey)) {
        console.error('错误：提供的新密钥不是32位十六进制字符串');
        process.exit(1);
      }
      console.log(`使用用户提供的新密钥 (SHA256): ${hashKey(newKey).substring(0, 32)}...`);
    }

    let usersCount = 0;
    let transactionsCount = 0;

    if (isDryRun) {
      const [users] = await execute('SELECT COUNT(*) AS count FROM users WHERE balance IS NOT NULL OR credit_score IS NOT NULL');
      usersCount = users[0].count;
      
      const [tx] = await execute('SELECT COUNT(*) AS count FROM transactions WHERE amount IS NOT NULL OR interest IS NOT NULL OR total_amount IS NOT NULL');
      transactionsCount = tx[0].count;

      console.log('\n=== DRY-RUN 统计结果 ===');
      console.log(`将受影响的 users 表记录: ${usersCount}`);
      console.log(`将受影响的 transactions 表记录: ${transactionsCount}`);
      console.log('========================\n');
      
      console.log('新密钥值（请保存并更新 .env）:');
      console.log(`SM4_MASTER_KEY=${newKey}`);
      console.log('\nDRY-RUN 完成，数据未修改');
      return;
    }

    await transaction(async (conn) => {
      console.log('开始处理 users 表...');
      const [users] = await conn.execute('SELECT id, balance, credit_score FROM users');
      
      for (const user of users) {
        const updates = {};
        let hasUpdate = false;

        if (user.balance && typeof user.balance === 'string' && user.balance.includes(':')) {
          const reencrypted = reEncrypt(user.balance, oldKey, newKey);
          if (reencrypted !== user.balance) {
            updates.balance = reencrypted;
            hasUpdate = true;
          }
        }

        if (user.credit_score && typeof user.credit_score === 'string' && user.credit_score.includes(':')) {
          const reencrypted = reEncrypt(user.credit_score, oldKey, newKey);
          if (reencrypted !== user.credit_score) {
            updates.credit_score = reencrypted;
            hasUpdate = true;
          }
        }

        if (hasUpdate) {
          const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
          const values = Object.values(updates);
          await conn.execute(`UPDATE users SET ${setClauses} WHERE id = ?`, [...values, user.id]);
          usersCount++;
        }
      }
      console.log(`users 表处理完成，更新记录: ${usersCount}`);

      console.log('开始处理 transactions 表...');
      const [transactions] = await conn.execute('SELECT id, amount, interest, total_amount FROM transactions');

      for (const tx of transactions) {
        const updates = {};
        let hasUpdate = false;

        if (tx.amount && typeof tx.amount === 'string' && tx.amount.includes(':')) {
          const reencrypted = reEncrypt(tx.amount, oldKey, newKey);
          if (reencrypted !== tx.amount) {
            updates.amount = reencrypted;
            hasUpdate = true;
          }
        }

        if (tx.interest && typeof tx.interest === 'string' && tx.interest.includes(':')) {
          const reencrypted = reEncrypt(tx.interest, oldKey, newKey);
          if (reencrypted !== tx.interest) {
            updates.interest = reencrypted;
            hasUpdate = true;
          }
        }

        if (tx.total_amount && typeof tx.total_amount === 'string' && tx.total_amount.includes(':')) {
          const reencrypted = reEncrypt(tx.total_amount, oldKey, newKey);
          if (reencrypted !== tx.total_amount) {
            updates.total_amount = reencrypted;
            hasUpdate = true;
          }
        }

        if (hasUpdate) {
          const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
          const values = Object.values(updates);
          await conn.execute(`UPDATE transactions SET ${setClauses} WHERE id = ?`, [...values, tx.id]);
          transactionsCount++;
        }
      }
      console.log(`transactions 表处理完成，更新记录: ${transactionsCount}`);
    });

    console.log('\n=== 轮换完成 ===');
    console.log(`users 表更新: ${usersCount} 条`);
    console.log(`transactions 表更新: ${transactionsCount} 条`);
    console.log('');

    console.log('请立即更新 .env 文件中的密钥：');
    console.log(`SM4_MASTER_KEY=${newKey}`);
    console.log('');
    console.log('更新后请重启应用使新密钥生效');

    const auditLog = {
      timestamp: new Date().toISOString(),
      oldKeySHA256: hashKey(oldKey),
      newKeySHA256: hashKey(newKey),
      affectedTables: ['users', 'transactions'],
      usersCount,
      transactionsCount
    };

    console.log('审计日志:', auditLog);

  } catch (error) {
    console.error('\n密钥轮换失败:', error.message);
    console.error('堆栈:', error.stack);
    process.exit(1);
  }
}

rotateKey();
