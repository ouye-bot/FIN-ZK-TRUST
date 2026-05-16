const { execute } = require('../config/database');

const migrateMfaFields = async () => {
  try {
    console.log('开始迁移 MFA 字段...');

    try {
      await execute(`ALTER TABLE users ADD COLUMN totp_secret VARCHAR(500) DEFAULT NULL`);
      console.log('totp_secret 字段添加成功');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('totp_secret 字段已存在');
      } else {
        throw error;
      }
    }

    try {
      await execute(`ALTER TABLE users ADD COLUMN totp_enabled BOOLEAN DEFAULT FALSE`);
      console.log('totp_enabled 字段添加成功');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('totp_enabled 字段已存在');
      } else {
        throw error;
      }
    }

    try {
      await execute(`ALTER TABLE users ADD COLUMN backup_codes_hashed TEXT DEFAULT NULL`);
      console.log('backup_codes_hashed 字段添加成功');
    } catch (error) {
      if (error.code === 'ER_DUP_FIELDNAME') {
        console.log('backup_codes_hashed 字段已存在');
      } else {
        throw error;
      }
    }

    console.log('MFA 字段迁移完成');
    process.exit(0);
  } catch (error) {
    console.error('迁移 MFA 字段时出错:', error);
    process.exit(1);
  }
};

migrateMfaFields();