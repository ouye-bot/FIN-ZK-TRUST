const { execute } = require('../config/database');
const { encrypt, decrypt } = require('../utils/sm4Crypto');

function isEncrypted(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  return value.includes(':');
}

async function migrateUsers() {
  console.log('开始迁移 users 表...');

  const selectSql = 'SELECT id, balance, credit_score FROM users';
  const users = await execute(selectSql);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const user of users) {
    const updates = [];
    const params = [];

    if (user.balance !== undefined && user.balance !== null && !isEncrypted(String(user.balance))) {
      const encryptedBalance = encrypt(String(Number(user.balance)));
      updates.push('balance = ?');
      params.push(encryptedBalance);
    } else {
      skippedCount++;
    }

    if (user.credit_score !== undefined && user.credit_score !== null && !isEncrypted(String(user.credit_score))) {
      const encryptedCreditScore = encrypt(String(Number(user.credit_score)));
      updates.push('credit_score = ?');
      params.push(encryptedCreditScore);
    } else {
      skippedCount++;
    }

    if (updates.length > 0) {
      params.push(user.id);
      const updateSql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      await execute(updateSql, params);
      migratedCount++;
    }
  }

  console.log(`users 表迁移完成: ${migratedCount} 条记录已加密, ${skippedCount} 条记录已加密或无需迁移`);
  return { migrated: migratedCount, skipped: skippedCount };
}

async function migrateTransactions() {
  console.log('开始迁移 transactions 表...');

  const selectSql = 'SELECT id, amount, interest, total_amount FROM transactions';
  const transactions = await execute(selectSql);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const tx of transactions) {
    const updates = [];
    const params = [];

    if (tx.amount !== undefined && tx.amount !== null && !isEncrypted(String(tx.amount))) {
      const encryptedAmount = encrypt(String(Number(tx.amount)));
      updates.push('amount = ?');
      params.push(encryptedAmount);
    } else {
      skippedCount++;
    }

    if (tx.interest !== undefined && tx.interest !== null && !isEncrypted(String(tx.interest))) {
      const encryptedInterest = encrypt(String(Number(tx.interest)));
      updates.push('interest = ?');
      params.push(encryptedInterest);
    } else {
      skippedCount++;
    }

    if (tx.total_amount !== undefined && tx.total_amount !== null && !isEncrypted(String(tx.total_amount))) {
      const encryptedTotalAmount = encrypt(String(Number(tx.total_amount)));
      updates.push('total_amount = ?');
      params.push(encryptedTotalAmount);
    } else {
      skippedCount++;
    }

    if (updates.length > 0) {
      params.push(tx.id);
      const updateSql = `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`;
      await execute(updateSql, params);
      migratedCount++;
    }
  }

  console.log(`transactions 表迁移完成: ${migratedCount} 条记录已加密, ${skippedCount} 条记录已加密或无需迁移`);
  return { migrated: migratedCount, skipped: skippedCount };
}

async function main() {
  try {
    console.log('=== 历史数据加密迁移 ===');
    console.log('');

    const usersResult = await migrateUsers();
    console.log('');

    const transactionsResult = await migrateTransactions();
    console.log('');

    console.log('=== 迁移统计 ===');
    console.log(`Users: ${usersResult.migrated} 已迁移, ${usersResult.skipped} 已加密或无需处理`);
    console.log(`Transactions: ${transactionsResult.migrated} 已迁移, ${transactionsResult.skipped} 已加密或无需处理`);
    console.log('');

    const totalMigrated = usersResult.migrated + transactionsResult.migrated;
    if (totalMigrated === 0) {
      console.log('0 rows migrated - 所有数据已是加密格式');
    } else {
      console.log(`共 ${totalMigrated} 条记录被迁移`);
    }

    console.log('');
    console.log('=== 迁移完成 ===');

  } catch (error) {
    console.error('迁移过程中出错:', error);
  } finally {
    process.exit(0);
  }
}

main();