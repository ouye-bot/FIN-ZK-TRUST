# Round 4 全面改进开发指导方案

## 背景与定位

**项目定位：原型验证** — 需要让密码学/金融科技领域的专业人士在审查时找不到"硬伤"，相信背后有严肃的设计逻辑。

**本轮改进四大领域：**

| # | 领域 | 核心改动 | 影响范围 |
|---|------|----------|----------|
| 1 | 密钥管理 | 每用户独立 DEK + KMS 抽象层 | 架构级 |
| 2 | SM4 加密 | CBC + 增强型 HMAC-SM3 + AAD 绑定 | 中等 |
| 3 | ZKP 电路 | 加固 + 条件组合证明（score>=阈值 AND 无逾期） | 中等 |
| 4 | 代码质量 | 统一校验模式、安全日志、错误处理 | 广泛但浅 |

**实施顺序：1 → 2 → 3 → 4**（密钥管理是基础，其他依赖它）

---

## 第一部分：密钥管理架构重构

### 1.1 设计目标

- Master Key 只做一件事：加密/解密每个用户的 DEK
- 每个用户有独立的 DEK（Data Encryption Key），用于加密该用户的敏感字段
- 单用户 DEK 泄漏不影响其他用户
- Master Key 泄漏不能直接解密字段（需要先拿到加密的 DEK）
- 提供 KMS 抽象接口，未来可无缝切换到真实云 KMS

### 1.2 数据库变更

**新增 `user_keys` 表：**

```sql
CREATE TABLE IF NOT EXISTS user_keys (
  user_id       BIGINT PRIMARY KEY,
  encrypted_dek TEXT NOT NULL COMMENT 'DEK 被 Master Key 加密后的密文（SM4-CBC + HMAC-SM3 格式）',
  created_at    BIGINT NOT NULL COMMENT '创建时间戳',
  rotated_at    BIGINT DEFAULT NULL COMMENT '最近一次密钥轮换时间戳',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

> 注意：`encrypted_dek` 使用与 sm4Crypto 相同的 `v1:iv:authTag:ciphertext` 格式，这样 DEK 本身就受 SM4 + HMAC-SM3 保护。

### 1.3 新增文件：`backend/services/kmsService.js`

这是本轮最核心的新文件。它封装所有密钥管理逻辑。

```js
const crypto = require('crypto');
const { execute } = require('../config/database');
const logger = require('../utils/logger');

// ==================== 底层加密工具（不依赖 sm4Crypto，避免循环依赖）====================

const SM4_ALGORITHM = 'sm4-cbc';
const HMAC_ALGORITHM = 'sm3';

function getMasterKey() {
  const keyHex = process.env.SM4_MASTER_KEY;
  if (!keyHex || !/^[0-9a-fA-F]{32}$/.test(keyHex)) {
    throw new Error('SM4_MASTER_KEY 未配置或格式错误');
  }
  return Buffer.from(keyHex, 'hex');
}

/**
 * 用 Master Key 加密任意数据（SM4-CBC + HMAC-SM3）
 * 返回格式：v1:ivHex:authTagHex:ciphertextHex
 */
function encryptWithMasterKey(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(SM4_ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(iv.toString('hex') + encrypted).digest('hex');
  return `v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * 用 Master Key 解密数据
 */
function decryptWithMasterKey(ciphertext) {
  const key = getMasterKey();
  const dataPart = ciphertext.replace(/^v\d+:/, '');
  const parts = dataPart.split(':');
  if (parts.length !== 3) throw new Error('密文格式无效');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const expectedTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(ivHex + encryptedHex).digest('hex');
  if (authTagHex !== expectedTag) throw new Error('认证标签不匹配');

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(SM4_ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ==================== KMS 核心接口 ====================

/**
 * 为新用户生成 DEK 并加密存储
 * 在用户注册时调用
 */
async function generateDEK(userId) {
  // 生成 128 位随机 DEK（32 位十六进制字符串）
  const dekHex = crypto.randomBytes(16).toString('hex');
  const encryptedDek = encryptWithMasterKey(dekHex);

  await execute(
    'INSERT INTO user_keys (user_id, encrypted_dek, created_at) VALUES (?, ?, ?)',
    [userId, encryptedDek, Date.now()]
  );

  logger.info('用户 DEK 已生成并加密存储', { userId });
  return dekHex;
}

/**
 * 获取用户的 DEK（解密 Master Key 包装）
 * 内部有内存缓存，避免每次都解密
 */
const dekCache = new Map(); // userId -> { dek, cachedAt }
const DEK_CACHE_TTL = 5 * 60 * 1000; // 5 分钟

async function getDEK(userId) {
  // 检查缓存
  const cached = dekCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < DEK_CACHE_TTL) {
    return cached.dek;
  }

  // 从数据库读取加密的 DEK
  const rows = await execute(
    'SELECT encrypted_dek FROM user_keys WHERE user_id = ?',
    [userId]
  );

  if (rows.length === 0) {
    // 兼容：老用户没有 DEK，自动生成并迁移
    logger.info('用户无 DEK，自动生成（兼容迁移）', { userId });
    return await generateDEK(userId);
  }

  const dek = decryptWithMasterKey(rows[0].encrypted_dek);
  dekCache.set(userId, { dek, cachedAt: Date.now() });
  return dek;
}

/**
 * 用 DEK 加密字段值
 * AAD = tableName:fieldName:recordId（防跨记录替换）
 */
function encryptWithDEK(dek, plaintext, aad = '') {
  const key = Buffer.from(dek, 'hex');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(SM4_ALGORITHM, key, iv);
  let encrypted = cipher.update(String(plaintext), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  // HMAC 绑定 AAD：iv + ciphertext + aad
  const authTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(iv.toString('hex') + encrypted + aad).digest('hex');
  return `v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * 用 DEK 解密字段值
 */
function decryptWithDEK(dek, ciphertext, aad = '') {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('密文格式无效');
  }

  const dataPart = ciphertext.replace(/^v\d+:/, '');
  const parts = dataPart.split(':');
  if (parts.length !== 3) throw new Error('密文格式无效');

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = Buffer.from(dek, 'hex');

  // 验证 AAD 绑定
  const expectedTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(ivHex + encryptedHex + aad).digest('hex');
  if (authTagHex !== expectedTag) throw new Error('认证标签不匹配（AAD 校验失败）');

  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(SM4_ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * 轮换用户的 DEK
 * 1. 用旧 DEK 解密所有字段
 * 2. 生成新 DEK
 * 3. 用新 DEK 重新加密所有字段
 * 4. 更新 user_keys 表
 */
async function rotateDEK(userId) {
  const oldDek = await getDEK(userId);
  const newDekHex = crypto.randomBytes(16).toString('hex');
  const encryptedNewDek = encryptWithMasterKey(newDekHex);

  // 获取用户的加密字段
  const users = await execute('SELECT balance, credit_score FROM users WHERE id = ?', [userId]);
  if (users.length === 0) throw new Error('用户不存在');

  const user = users[0];
  const updates = {};

  // 用旧 DEK 解密，用新 DEK 重新加密
  if (user.balance) {
    const plain = decryptWithDEK(oldDek, user.balance, 'users:balance:' + userId);
    updates.balance = encryptWithDEK(newDekHex, plain, 'users:balance:' + userId);
  }
  if (user.credit_score) {
    const plain = decryptWithDEK(oldDek, user.credit_score, 'users:credit_score:' + userId);
    updates.credit_score = encryptWithDEK(newDekHex, plain, 'users:credit_score:' + userId);
  }

  // 查询 transactions 表的加密字段
  const txns = await execute(
    'SELECT id, amount, interest, total_amount FROM transactions WHERE user_id = ?',
    [userId]
  );
  for (const txn of txns) {
    if (txn.amount) {
      const plain = decryptWithDEK(oldDek, txn.amount, 'transactions:amount:' + txn.id);
      const reEncrypted = encryptWithDEK(newDekHex, plain, 'transactions:amount:' + txn.id);
      await execute('UPDATE transactions SET amount = ? WHERE id = ?', [reEncrypted, txn.id]);
    }
    if (txn.interest) {
      const plain = decryptWithDEK(oldDek, txn.interest, 'transactions:interest:' + txn.id);
      const reEncrypted = encryptWithDEK(newDekHex, plain, 'transactions:interest:' + txn.id);
      await execute('UPDATE transactions SET interest = ? WHERE id = ?', [reEncrypted, txn.id]);
    }
    if (txn.total_amount) {
      const plain = decryptWithDEK(oldDek, txn.total_amount, 'transactions:total_amount:' + txn.id);
      const reEncrypted = encryptWithDEK(newDekHex, plain, 'transactions:total_amount:' + txn.id);
      await execute('UPDATE transactions SET total_amount = ? WHERE id = ?', [reEncrypted, txn.id]);
    }
  }

  // 更新 users 表
  if (updates.balance !== undefined) {
    await execute('UPDATE users SET balance = ? WHERE id = ?', [updates.balance, userId]);
  }
  if (updates.credit_score !== undefined) {
    await execute('UPDATE users SET credit_score = ? WHERE id = ?', [updates.credit_score, userId]);
  }

  // 更新 user_keys 表
  await execute(
    'UPDATE user_keys SET encrypted_dek = ?, rotated_at = ? WHERE user_id = ?',
    [encryptedNewDek, Date.now(), userId]
  );

  // 清除缓存
  dekCache.delete(userId);

  logger.info('用户 DEK 轮换完成', { userId });
}

// ==================== 清理定时器 ====================

const dekCacheCleanup = setInterval(() => {
  const now = Date.now();
  for (const [userId, cached] of dekCache.entries()) {
    if (now - cached.cachedAt > DEK_CACHE_TTL) {
      dekCache.delete(userId);
    }
  }
}, 60000);
dekCacheCleanup.unref();

module.exports = {
  generateDEK,
  getDEK,
  encryptWithDEK,
  decryptWithDEK,
  rotateDEK,
  encryptWithMasterKey,
  decryptWithMasterKey,
  // 导出底层工具供 sm4Crypto 迁移使用
  getMasterKey
};
```

### 1.4 修改文件：`backend/utils/sm4Crypto.js`

**重构策略：不删除 sm4Crypto.js，而是让它成为 kmsService 的薄包装层，保持现有调用者兼容。**

核心变化：
- `encrypt(plaintext)` → 内部调用 `kmsService.encryptWithDEK(dek, plaintext, aad)`
- `decrypt(ciphertext)` → 内部调用 `kmsService.decryptWithDEK(dek, ciphertext, aad)`
- `encryptFields(tableName, data)` → 需要传入 userId，内部获取 DEK
- `decryptFields(tableName, data)` → 同上

**但有一个兼容性问题：** 现有调用者（userDao、transactionDao）调用 `encryptFields('users', data)` 时没有传 userId。需要修改调用链。

**重构后的 sm4Crypto.js 核心结构：**

```js
const kmsService = require('../services/kmsService');
const logger = require('./logger');

/**
 * 用用户 DEK 加密数据（SM4-CBC + HMAC-SM3 + AAD）
 * @param {string} plaintext - 明文
 * @param {number} userId - 用户 ID（用于获取 DEK）
 * @param {string} aad - 附加认证数据（格式：tableName:fieldName:recordId）
 * @returns {string} 加密密文
 */
async function encrypt(plaintext, userId, aad = '') {
  const dek = await kmsService.getDEK(userId);
  return kmsService.encryptWithDEK(dek, plaintext, aad);
}

/**
 * 用用户 DEK 解密数据
 */
async function decrypt(ciphertext, userId, aad = '') {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('SM4 解密失败：数据格式无效');
  }
  const dek = await kmsService.getDEK(userId);
  return kmsService.decryptWithDEK(dek, ciphertext, aad);
}

/**
 * 加密表字段（需要 userId）
 */
async function encryptFields(tableName, data, userId) {
  // ... 根据 tableName 加密对应字段
  // 每个字段的 AAD = tableName:fieldName:recordId
}

/**
 * 解密表字段（需要 userId）
 */
async function decryptFields(tableName, data, userId) {
  // ... 根据 tableName 解密对应字段
}
```

**重要变更：`encrypt`、`decrypt`、`encryptFields`、`decryptFields` 全部变为 async 函数。** 所有调用者必须 await。

### 1.5 修改文件：`backend/dao/userDao.js`

**所有加密/解密调用需要传入 userId 并 await：**

```js
// 修改前
const decrypted = decrypt(data.balance);
// 修改后
const decrypted = await decrypt(data.balance, user.id, 'users:balance:' + user.id);

// 修改前
const encrypted = encrypt(String(data.balance));
// 修改后
const encrypted = await encrypt(String(data.balance), userId, 'users:balance:' + userId);
```

**具体修改点：**

1. `findById(id)` / `findByUsername(username)` → `decryptFields` 调用改为 async，传入 userId
2. `create(userData)` → `encryptFields` 调用改为 async，传入 userId
3. `updateBalance(id, newBalance)` → `encrypt` 调用改为 async，传入 userId
4. `updateCreditScore(id, newScore)` → 同上

**由于 sm4Crypto 的函数变为 async，userDao 的所有函数也必须变为 async（它们已经是 async 了，但调用加密函数时需要 await）。**

### 1.6 修改文件：`backend/dao/transactionDao.js`

与 userDao 类似，`encryptFields` / `decryptFields` 调用需要传入 userId 并 await。

### 1.7 修改文件：`backend/config/database.js`

移除启动时的 SM4 key 检查（`require('../utils/sm4Crypto').getSM4Key()`），改为在 kmsService 中按需获取。

### 1.8 修改文件：`backend/routes/auth.js`

**注册流程新增 DEK 生成：**

```js
// 在 userDao.create() 之后
const kmsService = require('../services/kmsService');
await kmsService.generateDEK(newUser.id);
```

### 1.9 数据迁移脚本：`backend/scripts/migrate-to-dek.js`

为现有用户批量生成 DEK 并重新加密字段。

```js
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
 */
```

### 1.10 DEK 缓存安全

- 缓存 TTL 5 分钟，过期自动清除
- `setInterval` 使用 `unref()` 防止进程挂起
- 缓存只存内存中的 DEK 明文，不持久化
- 密钥轮换时自动清除缓存

---

## 第二部分：SM4 加密方案增强

### 2.1 设计目标

- 绑定 AAD（Additional Authenticated Data）：表名 + 字段名 + 记录 ID
- 防止跨记录密文替换攻击
- 防止跨字段密文替换攻击（把 balance 密文复制到 credit_score）

### 2.2 AAD 格式规范

```
AAD = "{tableName}:{fieldName}:{recordId}"
```

示例：
- `users:balance:12345`
- `users:credit_score:12345`
- `transactions:amount:67890`
- `transactions:interest:67890`

### 2.3 实现细节

已在 kmsService.js 中实现（见 1.3 节的 `encryptWithDEK` / `decryptWithDEK`）。

**关键点：HMAC 的输入 = ivHex + ciphertextHex + aad**

```js
const authTag = crypto.createHmac(HMAC_ALGORITHM, key)
  .update(iv.toString('hex') + encrypted + aad).digest('hex');
```

这样如果攻击者把 user A 的 balance 密文复制到 user B 的 balance 字段，解密时 AAD 不匹配（因为 userId 不同），会抛出异常。

### 2.4 sm4Crypto.js 的 AAD 构建

```js
function buildAAD(tableName, fieldName, recordId) {
  return `${tableName}:${fieldName}:${recordId}`;
}

// encryptFields 示例
async function encryptFields(tableName, data, userId) {
  if (tableName === 'users') {
    if (data.balance !== undefined && data.balance !== null) {
      const aad = buildAAD('users', 'balance', userId);
      data.balance = await encrypt(String(Number(data.balance)), userId, aad);
    }
    if (data.credit_score !== undefined && data.credit_score !== null) {
      const aad = buildAAD('users', 'credit_score', userId);
      data.credit_score = await encrypt(String(Number(data.credit_score)), userId, aad);
    }
  }
  // transactions 类似，recordId 用 transactionId
  return data;
}
```

### 2.5 现有密文兼容性

**重要：现有密文没有 AAD 绑定。** 迁移脚本（1.9 节）在重新加密时会加上 AAD。但在迁移完成前，解密函数需要兼容旧格式。

**兼容策略：** `decryptWithDEK` 先尝试带 AAD 验证，如果失败且 aad 非空，再尝试不带 AAD 验证（旧格式）。这样迁移期间新旧密文都能解密。

```js
function decryptWithDEK(dek, ciphertext, aad = '') {
  // ... 解析密文 ...
  const expectedTag = crypto.createHmac(HMAC_ALGORITHM, key)
    .update(ivHex + encryptedHex + aad).digest('hex');
  if (authTagHex !== expectedTag) {
    if (aad) {
      // 兼容旧格式：不带 AAD 重试
      const legacyTag = crypto.createHmac(HMAC_ALGORITHM, key)
        .update(ivHex + encryptedHex).digest('hex');
      if (authTagHex === legacyTag) {
        logger.warning('解密使用旧格式（无 AAD），建议运行迁移脚本');
        // 继续解密...
      } else {
        throw new Error('认证标签不匹配');
      }
    } else {
      throw new Error('认证标签不匹配');
    }
  }
  // ... 正常解密 ...
}
```

---

## 第三部分：ZKP 电路加固与扩展

### 3.1 设计目标

- **加固（A）**：输入范围约束、防负数
- **扩展（B）**：条件组合证明 — `creditScore >= threshold AND hasNoOverdue === 1`

### 3.2 新电路设计：`circuits/credit.circom`

```circom
// Credit verification circuit
// 证明：我的信用分 >= 阈值 且 无逾期记录，但不暴露具体分数和逾期详情

// ==================== 基础组件 ====================

// 将信号分解为 N 位二进制（范围约束）
template Num2Bits(n) {
    signal input in;
    signal output out[n];
    var lc1 = 0;
    for (var i = 0; i < n; i++) {
        out[i] <-- (in >> i) & 1;
        out[i] * (out[i] - 1) === 0;
        lc1 += out[i] * (1 << i);
    }
    lc1 === in;
}

// 小于比较器：out = 1 当 in[0] < in[1]
template LessThan(n) {
    signal input in[2];
    signal output out;
    component n2b = Num2Bits(n + 1);
    n2b.in <== (1 << n) + in[0] - in[1];
    out <== 1 - n2b.out[n];
}

// 范围检查器：确保 in 在 [0, 2^n) 范围内
template RangeCheck(n) {
    signal input in;
    component n2b = Num2Bits(n);
    n2b.in <== in;
}

// 布尔检查器：确保 in 是 0 或 1
template BoolCheck() {
    signal input in;
    in * (in - 1) === 0;
}

// ==================== 主电路 ====================

template CreditVerification() {
    // 私有输入
    signal private input creditScore;   // 信用分（300-850）
    signal private input hasNoOverdue;  // 无逾期记录标志（0 或 1）

    // 公共输入
    signal input threshold;             // 阈值（由验证者提供）

    // 公共输出
    signal output isValid;              // 最终验证结果（0 或 1）

    // ---- 1. 输入范围约束 ----

    // creditScore 必须在 [0, 4095) 范围内（12 位足够表示 300-850）
    component scoreRange = RangeCheck(12);
    scoreRange.in <== creditScore;

    // hasNoOverdue 必须是布尔值（0 或 1）
    component overdueCheck = BoolCheck();
    overdueCheck.in <== hasNoOverdue;

    // threshold 也做范围约束
    component thresholdRange = RangeCheck(12);
    thresholdRange.in <== threshold;

    // ---- 2. 条件组合验证 ----

    // 条件 1：creditScore >= threshold
    component lt = LessThan(12);
    lt.in[0] <== creditScore;
    lt.in[1] <== threshold;
    signal scorePass;
    scorePass <== 1 - lt.out;  // 1 当 creditScore >= threshold

    // 条件 2：hasNoOverdue === 1（已经由 BoolCheck 约束，直接使用）

    // 组合：两个条件都满足才通过
    isValid <== scorePass * hasNoOverdue;
}

component main = CreditVerification();
```

**电路设计要点：**

1. `RangeCheck(12)` 确保 creditScore 在 0-4095 范围内，防止负数和超大值
2. `BoolCheck()` 确保 hasNoOverdue 是 0 或 1
3. `isValid = scorePass * hasNoOverdue` — 只有两个条件都为 1 时结果才为 1
4. threshold 作为公共输入（验证者提供），creditScore 和 hasNoOverdue 作为私有输入（证明者提供）

### 3.3 修改文件：`circuits/compile.js`

编译命令不变，但需要确认编译后重新生成所有构建产物。

```js
// 确保 build 目录存在
if (!fs.existsSync('build')) {
  fs.mkdirSync('build');
}

execSync('circom credit.circom -r build/credit.r1cs -w build/credit.wasm -s build/credit.sym', { stdio: 'inherit' });
execSync('snarkjs groth16 setup build/credit.r1cs pot12_final.ptau build/credit_final.zkey', { stdio: 'inherit' });
execSync('snarkjs zkey export verificationkey build/credit_final.zkey build/verification_key.json', { stdio: 'inherit' });
execSync('snarkjs zkey export solidityverifier build/credit_final.zkey build/Verifier.sol', { stdio: 'inherit' });
```

### 3.4 修改文件：`backend/services/zkService.js`

**generateProof 需要接受新参数：**

```js
exports.generateProof = async (creditScore, threshold, hasNoOverdue) => {
  // 验证输入
  if (creditScore === undefined || creditScore === null || threshold === undefined) {
    throw new Error('缺少必要参数: creditScore 和 threshold');
  }
  if (hasNoOverdue === undefined || hasNoOverdue === null) {
    throw new Error('缺少必要参数: hasNoOverdue');
  }

  const circuitCreditScore = Number(creditScore);
  const circuitThreshold = Number(threshold);
  const circuitHasNoOverdue = hasNoOverdue ? 1 : 0;

  if (isNaN(circuitCreditScore) || isNaN(circuitThreshold)) {
    throw new Error('creditScore 和 threshold 必须为有效数字');
  }
  if (circuitHasNoOverdue !== 0 && circuitHasNoOverdue !== 1) {
    throw new Error('hasNoOverdue 必须为布尔值');
  }

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    {
      creditScore: circuitCreditScore,
      threshold: circuitThreshold,
      hasNoOverdue: circuitHasNoOverdue
    },
    wasmPath,
    provingKeyPath
  );

  return { proof, publicSignals };
};
```

**verifyProof 逻辑调整：**

```js
exports.verifyProof = async (proof, publicSignals) => {
  if (!proof || !publicSignals) {
    throw new Error('缺少必要参数: proof 和 publicSignals');
  }

  // ... 现有的 proof 格式校验 ...

  const verificationResult = await snarkjs.groth16.verify(
    formattedVerificationKey,
    publicSignals,
    formattedProof
  );

  // 检查 isValid 输出信号
  // publicSignals[0] 是 threshold（公共输入），publicSignals[1] 是 isValid（输出）
  // 注意：snarkjs 的 publicSignals 包含所有公共输入和输出
  if (verificationResult && publicSignals.length > 1 && publicSignals[publicSignals.length - 1] !== '1') {
    logger.info('ZKP 证明有效但 isValid=0，业务验证不通过', { publicSignals });
    return false;
  }

  return verificationResult;
};
```

> **注意：** snarkjs 的 publicSignals 排列顺序是：先公共输入，后输出。新电路中 threshold 是公共输入，isValid 是输出。所以 `publicSignals = [threshold, isValid]`。需要通过测试确认实际顺序。

### 3.5 修改文件：`backend/routes/credit.js`

**generate-proof 路由需要传递 hasNoOverdue 参数：**

```js
router.post('/generate-proof', async (req, res) => {
  const { userId, creditScore, threshold, hasNoOverdue, proof, publicSignals, signature } = req.body;

  // 如果客户端提供了 proof（客户端生成模式）
  if (proof && publicSignals) {
    const isValid = await verifyProof(proof, publicSignals);
    // ...
  } else {
    // 服务端生成模式
    const proofResult = await generateProof(creditScore, threshold || 600, hasNoOverdue);
    // ...
  }
});
```

### 3.6 修改文件：`frontend/src/workers/zkProofWorker.js`

**GENERATE_PROOF 消息需要包含 hasNoOverdue：**

```js
// 消息协议变更
// 输入：{ creditScore, threshold, hasNoOverdue }
// 电路输入：
//   creditScore: 原始数值（不再哈希，电路内部做范围约束）
//   threshold: 原始数值
//   hasNoOverdue: 0 或 1

case 'GENERATE_PROOF':
  const { creditScore, threshold, hasNoOverdue } = e.data;
  const proofInput = {
    creditScore: Number(creditScore),
    threshold: Number(threshold),
    hasNoOverdue: hasNoOverdue ? 1 : 0
  };
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    proofInput, wasmUrl, zkeyUrl
  );
  // ...
```

### 3.7 修改文件：`frontend/src/pages/CreditProof.js`

**生成证明时传递 hasNoOverdue：**

```js
// 用户需要勾选"无逾期记录"复选框
// hasNoOverdue 从用户输入获取

const handleGenerateProof = async () => {
  // ...
  workerRef.current.postMessage({
    type: 'GENERATE_PROOF',
    requestId,
    creditScore: userCreditScore,
    threshold: 600,
    hasNoOverdue: !hasOverdueRecords  // 从用户状态获取
  });
};
```

### 3.8 修改文件：`backend/services/zkQueue.js`

**processTask 需要传递新参数：**

```js
const { creditScore, threshold, hasNoOverdue } = task.input;
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { creditScore: circuitCreditScore, threshold: circuitThreshold, hasNoOverdue: circuitHasNoOverdue },
  task.wasmPath,
  task.zkeyPath
);
```

### 3.9 电路重编译

**修改电路后必须重编译：**

```bash
cd circuits
node compile.js
```

这会重新生成：
- `build/credit.r1cs`
- `build/credit.wasm`
- `build/credit_final.zkey`
- `build/verification_key.json`
- `build/Verifier.sol`

> **重要：** 新的 zkey 需要新的 ptau 文件。如果 `pot12_final.ptau` 不存在，需要先下载或生成。

---

## 第四部分：代码质量改进

### 4.1 统一输入校验模式

**创建 `backend/utils/validators.js`：**

```js
/**
 * 统一输入校验工具
 * 所有路由使用相同的校验模式，避免重复代码
 */

const SM2_PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{130}$/;
const SM2_PRIVATE_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const SM3_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

function validateRequired(fields, data) {
  const missing = [];
  for (const field of fields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new Error(`缺少必填字段: ${missing.join(', ')}`);
  }
}

function validateRange(value, min, max, fieldName) {
  const num = Number(value);
  if (isNaN(num) || num < min || num > max) {
    throw new Error(`${fieldName} 必须在 ${min}-${max} 之间`);
  }
  return num;
}

function validateSM2PublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error('SM2 公钥不能为空');
  }
  if (!SM2_PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new Error('SM2 公钥格式无效：必须为 130 位十六进制字符串（04 开头）');
  }
}

function validateSM2PrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') {
    throw new Error('SM2 私钥不能为空');
  }
  if (!SM2_PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error('SM2 私钥格式无效：必须为 64 位十六进制字符串');
  }
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('密码不能为空');
  }
  if (password.length < 8) {
    throw new Error('密码长度至少 8 位');
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])/.test(password)) {
    throw new Error('密码必须包含大小写字母');
  }
}

module.exports = {
  validateRequired,
  validateRange,
  validateSM2PublicKey,
  validateSM2PrivateKey,
  validatePassword,
  SM2_PUBLIC_KEY_PATTERN,
  SM2_PRIVATE_KEY_PATTERN,
  SM3_HASH_PATTERN
};
```

### 4.2 统一安全日志规范

**创建 `backend/utils/secureLog.js`：**

```js
/**
 * 安全日志工具
 * 防止敏感数据泄漏到日志中
 */

const logger = require('./logger');

// 脱敏规则
const MASK_RULES = {
  sm2PublicKey: (val) => val ? val.substring(0, 6) + '...' + val.substring(val.length - 4) : '[empty]',
  sm2PrivateKey: () => '[REDACTED]',
  signature: (val) => val ? val.substring(0, 8) + '...' : '[empty]',
  token: (val) => val ? val.substring(0, 8) + '...' : '[empty]',
  password: () => '[REDACTED]',
  dek: () => '[REDACTED]',
  masterKey: () => '[REDACTED]'
};

/**
 * 安全地记录日志，自动脱敏敏感字段
 */
function secureLog(level, message, data = {}) {
  const sanitized = { ...data };
  for (const [key, maskFn] of Object.entries(MASK_RULES)) {
    if (sanitized[key] !== undefined) {
      sanitized[key] = maskFn(sanitized[key]);
    }
  }
  logger[level](message, sanitized);
}

module.exports = {
  secureLog,
  MASK_RULES
};
```

### 4.3 统一错误处理

**修改 `backend/middleware/errorHandler.js`：**

```js
// 标准错误响应格式
function createErrorResponse(code, message, details = null) {
  const response = {
    success: false,
    code,
    message,
    requestId: crypto.randomUUID()
  };
  if (details && process.env.NODE_ENV === 'development') {
    response.details = details;
  }
  return response;
}

// 密码学操作错误统一处理
function handleCryptoError(error, operation) {
  logger.error(`${operation} 失败`, { error: error.message });
  return createErrorResponse('CRYPTO_ERROR', `${operation} 失败`);
}
```

### 4.4 修复已知代码异味

1. **`backend/utils/cryptoUtils.js`** — signWithSM2 的缓存 key 不含 privateKey（安全考虑），但如果系统可能用不同私钥对同一 message 签名，需要加上公钥哈希作为区分
2. **`backend/services/challengeService.js`** — challengeStore 用 Map 但没有大小限制，高并发下可能 OOM。加上 1000 条上限
3. **`backend/middleware/anomalyDetection.js`** — 检查是否有硬编码阈值，改为可配置

---

## 第五部分：测试更新

### 5.1 `backend/test/crypto.test.js` 更新

**新增测试用例：**

```js
// 模块 8：KMS 与密钥管理测试
async testKMSModule() {
  // 8.1 DEK 生成与获取
  // 8.2 DEK 加密/解密一致性
  // 8.3 AAD 绑定验证（篡改 AAD 应解密失败）
  // 8.4 跨用户密文隔离（user A 的密文不能用 user B 的 DEK 解密）
  // 8.5 DEK 缓存过期后自动重新获取
  // 8.6 旧格式密文兼容解密
}

// 修改模块 5：ZKP 测试
async testZKPModule() {
  // 5.1 证明生成（creditScore=750, threshold=600, hasNoOverdue=1）→ isValid=1
  // 5.2 证明验证（正确证明）→ true
  // 5.3 score < threshold → isValid=0
  // 5.4 hasNoOverdue=0 → isValid=0（即使 score 达标）
  // 5.5 score < threshold AND hasNoOverdue=0 → isValid=0
  // 5.6 score >= threshold AND hasNoOverdue=1 → isValid=1（唯一通过条件）
  // 5.7 范围约束：creditScore=负数 → 应抛异常或验证失败
  // 5.8 范围约束：creditScore=9999 → 应抛异常或验证失败
  // 5.9 hasNoOverdue=2（非布尔值）→ 应抛异常
  // 5.10 单参数绕过（B2 回归测试）
}
```

### 5.2 `backend/test/security-fault-tolerance-test.js` 更新

**更新 ZKP 安全测试模块：**

```js
// 6.1 单参数调用绕过（B2 回归）→ 应抛异常
// 6.2 篡改 publicSignals → 应返回 false
// 6.3 空 proof 结构 → 应抛异常
// 6.4 hasNoOverdue=0 但声称无逾期 → isValid 应为 0
// 6.5 AAD 篡改检测（修改解密时的 AAD → 应抛异常）
// 6.6 跨用户密文替换 → 应抛异常
```

### 5.3 `backend/test/performance-test.js` 更新

**module8（端到端业务流程）需要更新 ZKP 生成参数：**

```js
// 修改前
await zkService.generateProof(creditScore, threshold);

// 修改后
await zkService.generateProof(creditScore, threshold, true); // hasNoOverdue=true
```

---

## 第六部分：实施检查清单

### Phase 1：密钥管理（基础）

- [ ] 创建 `user_keys` 表（SQL migration）
- [ ] 创建 `backend/services/kmsService.js`
- [ ] 重构 `backend/utils/sm4Crypto.js`（变为 async + AAD）
- [ ] 修改 `backend/dao/userDao.js`（传入 userId + await）
- [ ] 修改 `backend/dao/transactionDao.js`（传入 userId + await）
- [ ] 修改 `backend/config/database.js`（移除启动时 SM4 检查）
- [ ] 修改 `backend/routes/auth.js`（注册时生成 DEK）
- [ ] 创建迁移脚本 `backend/scripts/migrate-to-dek.js`
- [ ] 运行迁移脚本，验证现有数据可正常读写

### Phase 2：SM4 增强

- [ ] 在 kmsService.js 中实现 AAD 绑定（已在 Phase 1 完成）
- [ ] sm4Crypto.js 的 encryptFields/decryptFields 使用 AAD
- [ ] 实现旧格式密文兼容解密
- [ ] 测试 AAD 篡改检测

### Phase 3：ZKP 电路

- [ ] 修改 `circuits/credit.circom`（RangeCheck + BoolCheck + 条件组合）
- [ ] 确认 `pot12_final.ptau` 文件可用
- [ ] 运行 `node circuits/compile.js` 重编译
- [ ] 修改 `backend/services/zkService.js`（generateProof 新参数）
- [ ] 修改 `backend/routes/credit.js`（传递 hasNoOverdue）
- [ ] 修改 `frontend/src/workers/zkProofWorker.js`（新电路输入）
- [ ] 修改 `frontend/src/pages/CreditProof.js`（UI 增加逾期选项）
- [ ] 修改 `backend/services/zkQueue.js`（新参数）

### Phase 4：代码质量

- [ ] 创建 `backend/utils/validators.js`
- [ ] 创建 `backend/utils/secureLog.js`
- [ ] 修改关键路由使用统一校验
- [ ] 修改关键模块使用安全日志
- [ ] 修复 challengeService.js 的 Map 大小限制

### Phase 5：测试

- [ ] 更新 `crypto.test.js`（KMS 模块 + ZKP 新用例）
- [ ] 更新 `security-fault-tolerance-test.js`
- [ ] 更新 `performance-test.js`
- [ ] 运行全部三个测试脚本，确保 0 失败、0 跳过、0 knownIssue
- [ ] 确认所有测试脚本正常退出（exit code 0）

---

## 第七部分：风险与注意事项

### 7.1 破坏性变更

| 变更 | 影响 | 缓解措施 |
|------|------|----------|
| sm4Crypto 函数变 async | 所有调用者必须 await | 已在方案中列出所有需修改的调用者 |
| encryptFields/decryptFields 需要 userId | DAO 层接口变更 | DAO 层已设计为传入 userId |
| ZKP 电路输入变更 | 前端 Worker 和后端 zkService 需同步修改 | 前后端一起改，测试验证 |
| publicSignals 顺序可能变化 | verifyProof 的 isValid 检查逻辑需要调整 | 通过测试确认实际顺序 |

### 7.2 数据迁移风险

- 迁移脚本需要在服务停机时运行（避免读写竞争）
- 迁移前备份数据库
- 迁移后验证所有加密字段可正常解密
- 旧格式密文兼容逻辑确保迁移期间服务可用

### 7.3 电路编译风险

- `pot12_final.ptau` 文件可能不存在，需要下载
- circom 编译器需要全局安装
- 编译后的 zkey 文件较大，需要正确部署到 `circuits/build/`

### 7.4 前端兼容性

- 新电路的 wasm 和 zkey 文件需要部署到 `/circuits/` 静态目录
- 前端 Worker 初始化时需要加载新的 wasm/zkey
- 用户需要在 UI 上勾选"无逾期记录"选项

---

## 附录：文件变更总览

### 新增文件
| 文件 | 用途 |
|------|------|
| `backend/services/kmsService.js` | KMS 抽象层（DEK 管理、加密/解密） |
| `backend/utils/validators.js` | 统一输入校验 |
| `backend/utils/secureLog.js` | 安全日志工具 |
| `backend/scripts/migrate-to-dek.js` | 数据迁移脚本 |

### 修改文件
| 文件 | 变更内容 |
|------|----------|
| `backend/utils/sm4Crypto.js` | 重构为 async + DEK + AAD |
| `backend/dao/userDao.js` | 加密调用改为 async + userId |
| `backend/dao/transactionDao.js` | 同上 |
| `backend/config/database.js` | 移除 SM4 启动检查 |
| `backend/routes/auth.js` | 注册时生成 DEK |
| `backend/routes/credit.js` | ZKP 参数更新 |
| `backend/services/zkService.js` | generateProof 新参数 + verifyProof 逻辑 |
| `backend/services/zkQueue.js` | 新参数 |
| `circuits/credit.circom` | 加固 + 条件组合 |
| `circuits/compile.js` | 确认 build 目录创建 |
| `frontend/src/workers/zkProofWorker.js` | 新电路输入 |
| `frontend/src/pages/CreditProof.js` | UI 增加逾期选项 |
| `backend/test/crypto.test.js` | KMS + ZKP 新测试 |
| `backend/test/security-fault-tolerance-test.js` | AAD + ZKP 安全测试 |
| `backend/test/performance-test.js` | ZKP 参数更新 |

### 不变文件
| 文件 | 原因 |
|------|------|
| `backend/middleware/antiReplayMiddleware.js` | Round 3 已修复，无需变更 |
| `backend/middleware/securityChain.js` | 同上 |
| `backend/middleware/sm2SignatureMiddleware.js` | 同上 |
| `backend/services/blockchainService.js` | 不涉及加密变更 |
| `backend/services/challengeService.js` | 仅需加 Map 大小限制（Phase 4） |
