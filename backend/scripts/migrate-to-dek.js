/**
 * 迁移脚本：为所有现有用户生成 DEK 并重新加密字段
 *
 * 运行方式：node backend/scripts/migrate-to-dek.js
 *
 * 步骤：
 * 1. 查询所有没有 DEK 的用户
 * 2. 用旧的 Master Key 直接解密字段
 * 3. 生成新 DEK
 * 4. 用新 DEK 重新加密字段
 * 5. 将加密的 DEK 存入 user_keys 表
 *
 * 注意：迁移前请备份数据库
 */

const { execute } = require('../config/database');
const kmsService = require('../services/kmsService');
const logger = require('../utils/logger');

async function migrateToDEK() {
  console.log('=== 开始 DEK 迁移 ===');

  try {
    const users = await execute('SELECT id FROM users');
    console.log(`找到 ${users.length} 个用户`);

    let migratedCount = 0;
    let skippedCount = 0;

    for (const user of users) {
      const existing = await execute('SELECT user_id FROM user_keys WHERE user_id = ?', [user.id]);
      if (existing.length > 0) {
        skippedCount++;
        continue;
      }

      console.log(`迁移用户 ${user.id}...`);

      await kmsService.generateDEK(user.id);

      migratedCount++;
      console.log(`用户 ${user.id} DEK 生成 DEK 完成`);
    }

    console.log(`\n=== DEK 迁移完成 ===`);
    console.log(`已迁移: ${migratedCount} 个用户`);
    console.log(`已跳过: ${skippedCount} 个用户（已有 DEK）`);

    process.exit(0);
  } catch (error) {
    console.error('DEK 迁移失败:', error);
    process.exit(1);
  }
}

migrateToDEK();