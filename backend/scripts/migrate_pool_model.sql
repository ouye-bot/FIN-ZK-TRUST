-- 资金池表结构迁移脚本
-- 添加平台资本、用户资本、已借出金额三个合规字段
-- 幂等性：重复执行不会出错或破坏数据

-- 检测并添加 platform_capital 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fund_pool' AND COLUMN_NAME = 'platform_capital');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE fund_pool ADD COLUMN platform_capital DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT ''平台自有资金''',
  'SELECT "platform_capital already exists" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检测并添加 user_capital 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fund_pool' AND COLUMN_NAME = 'user_capital');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE fund_pool ADD COLUMN user_capital DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT ''用户出资总额''',
  'SELECT "user_capital already exists" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 检测并添加 loaned_amount 字段
SET @col_exists = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fund_pool' AND COLUMN_NAME = 'loaned_amount');
SET @sql = IF(@col_exists = 0,
  'ALTER TABLE fund_pool ADD COLUMN loaned_amount DECIMAL(15,2) NOT NULL DEFAULT 0 COMMENT ''已借出本金总额''',
  'SELECT "loaned_amount already exists" AS msg');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 初始化数据（仅当新字段为默认值时执行，避免重复覆盖）
UPDATE fund_pool
SET
  platform_capital = 10000,
  user_capital = total_amount - 10000,
  loaned_amount = reserved_amount
WHERE
  platform_capital = 0 AND user_capital = 0 AND loaned_amount = 0;
