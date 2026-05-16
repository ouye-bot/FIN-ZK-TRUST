require('dotenv').config();
const { execute } = require('../config/database');
const { encrypt, decrypt, getSM4Key } = require('../utils/sm4Crypto');
const crypto = require('crypto');

const OLD_KEY = '00112233445566778899aabbccddeeff';
const OLD_MFA_KEY = '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';

function decryptWithKey(value, key) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  if (!value.includes(':')) {
    return value;
  }

  const parts = value.split(':');
  if (parts.length !== 3) {
    return value;
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const keyBuffer = Buffer.from(key, 'hex');
  const iv = Buffer.from(ivHex, 'hex');

  try {
    const expectedAuthTag = crypto.createHmac('sm3', keyBuffer).update(ivHex + encryptedHex).digest('hex');
    if (authTagHex !== expectedAuthTag) {
      return value;
    }

    const decipher = crypto.createDecipheriv('sm4-cbc', keyBuffer, iv);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    return value;
  }
}

async function rotateUsersKey() {
  console.log('开始轮换 users 表密钥...');

  const selectSql = 'SELECT id, balance, credit_score FROM users';
  const users = await execute(selectSql);

  let rotatedCount = 0;
  let skippedCount = 0;

  for (const user of users) {
    const updates = [];
    const params = [];

    if (user.balance !== undefined && user.balance !== null && String(user.balance).includes(':')) {
      const decrypted = decryptWithKey(user.balance, OLD_KEY);
      if (decrypted !== user.balance) {
        const encrypted = encrypt(decrypted);
        updates.push('balance = ?');
        params.push(encrypted);
      } else {
        skippedCount++;
      }
    } else {
      skippedCount++;
    }

    if (user.credit_score !== undefined && user.credit_score !== null && String(user.credit_score).includes(':')) {
      const decrypted = decryptWithKey(user.credit_score, OLD_KEY);
      if (decrypted !== user.credit_score) {
        const encrypted = encrypt(decrypted);
        updates.push('credit_score = ?');
        params.push(encrypted);
      } else {
        skippedCount++;
      }
    } else {
      skippedCount++;
    }

    if (updates.length > 0) {
      params.push(user.id);
      const updateSql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      await execute(updateSql, params);
      rotatedCount++;
    }
  }

  console.log(`users 表密钥轮换完成: ${rotatedCount} 条记录已轮换, ${skippedCount} 条记录跳过`);
  return { rotated: rotatedCount, skipped: skippedCount };
}

async function rotateTransactionsKey() {
  console.log('开始轮换 transactions 表密钥...');

  const selectSql = 'SELECT id, amount, interest, total_amount FROM transactions';
  const transactions = await execute(selectSql);

  let rotatedCount = 0;
  let skippedCount = 0;

  for (const tx of transactions) {
    const updates = [];
    const params = [];

    if (tx.amount !== undefined && tx.amount !== null && String(tx.amount).includes(':')) {
      const decrypted = decryptWithKey(tx.amount, OLD_KEY);
      if (decrypted !== tx.amount) {
        const encrypted = encrypt(decrypted);
        updates.push('amount = ?');
        params.push(encrypted);
      } else {
        skippedCount++;
      }
    } else {
      skippedCount++;
    }

    if (tx.interest !== undefined && tx.interest !== null && String(tx.interest).includes(':')) {
      const decrypted = decryptWithKey(tx.interest, OLD_KEY);
      if (decrypted !== tx.interest) {
        const encrypted = encrypt(decrypted);
        updates.push('interest = ?');
        params.push(encrypted);
      } else {
        skippedCount++;
      }
    } else {
      skippedCount++;
    }

    if (tx.total_amount !== undefined && tx.total_amount !== null && String(tx.total_amount).includes(':')) {
      const decrypted = decryptWithKey(tx.total_amount, OLD_KEY);
      if (decrypted !== tx.total_amount) {
        const encrypted = encrypt(decrypted);
        updates.push('total_amount = ?');
        params.push(encrypted);
      } else {
        skippedCount++;
      }
    } else {
      skippedCount++;
    }

    if (updates.length > 0) {
      params.push(tx.id);
      const updateSql = `UPDATE transactions SET ${updates.join(', ')} WHERE id = ?`;
      await execute(updateSql, params);
      rotatedCount++;
    }
  }

  console.log(`transactions 表密钥轮换完成: ${rotatedCount} 条记录已轮换, ${skippedCount} 条记录跳过`);
  return { rotated: rotatedCount, skipped: skippedCount };
}

async function migrateTotpSecrets() {
  console.log('开始轮换 users 表的 totp_secret...');

  const newKey = process.env.SM4_MASTER_KEY;

  if (OLD_MFA_KEY === newKey) {
    console.log('新旧密钥相同，无需轮换 totp_secret');
    return { migrated: 0, skipped: 0 };
  }

  const { sm4 } = require('sm-crypto');

  const selectSql = "SELECT id, totp_secret FROM users WHERE totp_secret IS NOT NULL AND totp_secret != ''";
  const users = await execute(selectSql);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const user of users) {
    try {
      const parts = user.totp_secret.split(':');
      if (parts.length !== 2) {
        console.warn(`用户 ${user.id} 的 totp_secret 格式异常，跳过`);
        skippedCount++;
        continue;
      }

      const ivHex = parts[0];
      const cipherHex = parts[1];

      const plainHex = sm4.decrypt(cipherHex, OLD_MFA_KEY, { iv: ivHex, mode: 'cbc' });
      const plaintext = Buffer.from(plainHex, 'hex').toString('utf8');

      const newIv = crypto.randomBytes(16);
      const newIvHex = newIv.toString('hex');
      const newPlainHex = Buffer.from(plaintext, 'utf8').toString('hex');
      const newCipherHex = sm4.encrypt(newPlainHex, newKey, { iv: newIvHex, mode: 'cbc' });
      const newEncrypted = `${newIvHex}:${newCipherHex}`;

      const updateSql = 'UPDATE users SET totp_secret = ? WHERE id = ?';
      await execute(updateSql, [newEncrypted, user.id]);
      migratedCount++;
    } catch (err) {
      console.error(`轮换用户 ${user.id} 的 totp_secret 失败:`, err.message);
      skippedCount++;
    }
  }

  console.log(`totp_secret 轮换完成: ${migratedCount} 条已迁移, ${skippedCount} 条跳过`);
  return { migrated: migratedCount, skipped: skippedCount };
}

async function main() {
  try {
    console.log('=== SM4 密钥轮换 ===');
    console.log('');
    console.log(`当前密钥: ${getSM4Key()}`);
    console.log(`旧密钥: ${OLD_KEY}`);
    console.log(`旧 MFA 密钥: ${OLD_MFA_KEY}`);
    console.log('');

    const usersResult = await rotateUsersKey();
    console.log('');

    const transactionsResult = await rotateTransactionsKey();
    console.log('');

    const totpResult = await migrateTotpSecrets();
    console.log('');

    console.log('=== 密钥轮换统计 ===');
    console.log(`Users: ${usersResult.rotated} 已轮换, ${usersResult.skipped} 已跳过`);
    console.log(`Transactions: ${transactionsResult.rotated} 已轮换, ${transactionsResult.skipped} 已跳过`);
    console.log(`Totp Secrets: ${totpResult.migrated} 已迁移, ${totpResult.skipped} 已跳过`);
    console.log('');

    const totalRotated = usersResult.rotated + transactionsResult.rotated + totpResult.migrated;
    console.log(`共 ${totalRotated} 条记录完成密钥轮换`);

    console.log('');
    console.log('=== 密钥轮换完成 ===');

  } catch (error) {
    console.error('密钥轮换过程中出错:', error);
  } finally {
    process.exit(0);
  }
}

main();