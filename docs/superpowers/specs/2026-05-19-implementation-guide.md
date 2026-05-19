# FinZkTrust 全面加固实施指导方案

> **版本**: v1.0  
> **日期**: 2026-05-19  
> **目标读者**: 执行实施的编程 AI  
> **审查人**: 架构 AI（会话结束后全方位审查）

---

## 一、原则要求与标准规划

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **不引入新依赖** | 使用现有 Node.js crypto、mysql2、snarkjs 等，不安装新包 |
| **向后兼容** | 环境变量不设置时给出明确错误，而不是静默失败 |
| **国密合规** | 所有密码操作使用 SM2/SM3/SM4（HKDF 用 SHA256 是可接受的例外） |
| **最小改动** | 只改必须改的，不做无关重构 |
| **每改必测** | 每个修复点必须有对应的测试用例验证 |
| **事务内读写** | 所有涉及资金的操作必须在事务内完成读取和写入 |

### 1.2 质量标准

- **代码质量**: 无 `console.log` 调试语句（使用 `logger`），无未使用的变量/导入
- **安全性**: 所有密钥操作必须使用 `crypto.timingSafeEqual`，禁止 `Math.random()` 用于安全场景
- **健壮性**: 所有异步操作必须有错误处理，资金操作必须有事务保护
- **可测试性**: 每个修复必须能被独立测试验证

### 1.3 执行红线（绝对禁止）

| 红线 | 后果 |
|------|------|
| **禁止修改未列出的文件** | 除非发现新的安全漏洞且记录在案 |
| **禁止引入新 npm 依赖** | 包括 bcrypt、express-validator 等 |
| **禁止删除现有测试** | 只能添加或修改 |
| **禁止修改数据库 schema** | 除非任务明确要求 |
| **禁止修改 .env 文件中的真实密钥** | 只能修改 .env.example |
| **禁止在代码中硬编码密钥** | 所有密钥必须从环境变量读取 |
| **禁止跳过事务** | 任何涉及资金池或用户余额的操作必须使用事务 |
| **禁止使用 `===` 比较密文/哈希** | 必须使用 `crypto.timingSafeEqual` |

---

## 二、系统当前状态（实施前必须理解）

### 2.1 技术栈

- **后端**: Node.js + Express + MySQL (mysql2)
- **前端**: React + Material-UI
- **区块链**: FISCO BCOS 4.x 联盟链（JSON-RPC + Console 子进程）
- **密码库**: gm-crypto (SM2/SM4)、sm-crypto (SM3)、snarkjs (ZKP)
- **认证**: JWT (access + refresh token)
- **数据库**: MySQL 8.x，使用 `execute()` 和 `transaction()` 函数

### 2.2 关键架构

- **区块链服务路由**: `backend/services/blockchainService.js` 是代理模块，根据 `BLOCKCHAIN_NETWORK` 环境变量动态选择 `blockchainServiceFisco.js` 或 `blockchainServiceHardhat.js`
- **认证流程**: `backend/middleware/securityChain.js` 全局解析 JWT，设置 `req.user`，但不拒绝无 token 请求（由各路由自行检查）
- **密钥管理**: `backend/utils/keyManager.js` 在启动时校验环境变量，已实现 `validateKeys()`
- **资金池 DAO**: `backend/dao/poolDao.js` 有两个更新方法：`updatePool()`（有行锁）和 `updatePoolV2()`（无行锁，有竞态）

### 2.3 已验证的文件状态

| 文件 | 当前状态 | 需要修改 |
|------|----------|----------|
| `backend/utils/authUtils.js:21-23` | 硬编码 `perfuser` 绕过限流 | 删除 |
| `backend/utils/authUtils.js:44` | refresh token 回退到 access secret | 移除回退 |
| `backend/utils/authUtils.js:70` | verifyRefreshToken 同样回退 | 移除回退 |
| `backend/utils/cryptoUtils.js:162` | `verifySM3Hash` 使用 `===` 比较 | 改用 timingSafeEqual |
| `backend/utils/cryptoUtils.js:191` | `verifyPBKDF2Hash` 使用 `===` 比较 | 改用 timingSafeEqual |
| `backend/utils/cryptoUtils.js:286` | SM2 签名缓存键泄露私钥末尾 8 字符 | 改用哈希 |
| `backend/services/mfaService.js:117` | `generateBackupCodes` 使用 `Math.random()` | 改用 crypto.randomInt |
| `backend/services/mfaService.js:151-153` | `decryptSecret` 明文回退 | 移除回退，抛出错误 |
| `backend/routes/mfa.js:75-102` | `/reset` 端点无认证 | 添加认证 + 使用 req.user.id |
| `backend/routes/invest.js:167+192` | 双重余额扣除（poolService.invest 已扣除，路由又扣除） | 删除路由中的重复扣除 |
| `backend/routes/invest.js:259,281` | GET 端点无数据隔离 | 添加 userId === req.user.id 检查 |
| `backend/routes/pool.js:80` | GET `/my-invest/:userId` 无数据隔离 | 添加 userId === req.user.id 检查 |
| `backend/routes/loan.js:104,375` | POST 端点无数据隔离 | 添加 userId === req.user.id 检查 |
| `backend/dao/poolDao.js:109-132` | `updatePoolV2` 无行锁 | 删除，统一使用 `updatePool` |
| `backend/services/poolService.js:227,301,366,443` | 使用 `updatePoolV2` + 事务外读取 | 改用 `updatePool`，事务内读取 |
| `backend/utils/keyManager.js:22-79` | 已实现 `validateKeys()` 但未校验 `JWT_REFRESH_SECRET` 和 `DB_PASSWORD` | 添加校验 |
| `backend/.env.example` | 缺少 `JWT_REFRESH_SECRET` | 添加 |
| `backend/.gitignore:2` | 只忽略根目录 `.env` | 添加 `**/.env` |
| `contracts/scripts/deploy.js:85` | 只授权 AuditStorage，未授权 ZKPVerifier | 添加授权 |
| `backend/services/blockchainServiceFisco.js` | 无重试机制 | 添加重试 |
| `backend/services/zkService.js:7` | 导入 `blockchainService`（正确，代理模块会路由到 FISCO） | 无需修改 |
| `backend/routes/blockchain.js:9-14` | 导入 `blockchainService`（正确） | 无需修改 |

---

## 三、阶段1：安全加固（基础层）

### 3.1 密钥管理增强

**文件**: `backend/utils/keyManager.js`

**当前状态**: `validateKeys()` 已校验 `SM4_MASTER_KEY`、`JWT_SECRET`、`HARDHAT_PRIVATE_KEY`、`SESSION_SECRET`，但缺少 `JWT_REFRESH_SECRET` 和 `DB_PASSWORD` 的校验。

**修改内容**:

在 `validateKeys()` 函数中（第 22-79 行），在 `SESSION_SECRET` 校验之后添加：

```javascript
// 校验 JWT_REFRESH_SECRET
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
if (!jwtRefreshSecret) {
  errors.push('JWT_REFRESH_SECRET 未配置');
} else {
  if (jwtRefreshSecret.length < 32) {
    errors.push('JWT_REFRESH_SECRET 长度至少需要32个字符');
  }
  if (jwtRefreshSecret === jwtSecret) {
    errors.push('JWT_REFRESH_SECRET 不能等于 JWT_SECRET');
  }
}

// 校验 DB_PASSWORD
const dbPassword = process.env.DB_PASSWORD;
if (dbPassword === '123456') {
  errors.push('DB_PASSWORD 不能使用默认弱密码 123456');
}
```

**文件**: `backend/.env.example`

在 `JWT_SECRET` 行之后添加：

```
JWT_REFRESH_SECRET=<your-jwt-refresh-secret-min-32-chars>
```

**文件**: `backend/.gitignore`

将 `.env` 改为 `**/.env`，并添加 `backend/.env` 的显式忽略。

**验证**:
- 删除 `.env` 中的 `JWT_REFRESH_SECRET`，启动应失败并报错
- 设置 `JWT_REFRESH_SECRET` 等于 `JWT_SECRET`，启动应失败
- 设置 `DB_PASSWORD=123456`，启动应失败
- 所有校验通过时正常启动

---

### 3.2 并发控制统一

**文件**: `backend/dao/poolDao.js`

**当前状态**:
- `updatePool()`（第 46-102 行）：使用 `SELECT ... FOR UPDATE` + 事务，正确
- `updatePoolV2()`（第 109-132 行）：无行锁、无事务，有竞态条件

**修改内容**:

**替换 `updatePoolV2()` 函数**（第 109-132 行），用以下带行锁和事务的版本：

```javascript
exports.updatePoolV2 = async ({ platform_capital, user_capital, loaned_amount, total_interest_earned }) => {
  const pc = Number(platform_capital);
  const uc = Number(user_capital);
  const la = Number(loaned_amount);
  const total_amount = pc + uc;
  const available_amount = total_amount - la;
  const reserved_amount = la;

  return await transaction(async (connection) => {
    // 锁定行
    const [results] = await connection.execute('SELECT * FROM fund_pool WHERE id = 1 FOR UPDATE');
    
    let tie = total_interest_earned !== undefined ? Number(total_interest_earned) : Number(results[0]?.total_interest_earned || 0);
    
    await connection.execute(`
      UPDATE fund_pool 
      SET platform_capital = ?, user_capital = ?, loaned_amount = ?, 
          total_amount = ?, available_amount = ?, reserved_amount = ?, total_interest_earned = ?
      WHERE id = 1
    `, [pc, uc, la, total_amount, available_amount, reserved_amount, tie]);
    
    const [updatedResults] = await connection.execute('SELECT * FROM fund_pool WHERE id = 1');
    const pool = updatedResults[0];
    pool.total_amount = Number(pool.total_amount);
    pool.available_amount = Number(pool.available_amount);
    pool.reserved_amount = Number(pool.reserved_amount);
    pool.total_interest_earned = Number(pool.total_interest_earned || 0);
    pool.platform_capital = Number(pool.platform_capital || 0);
    pool.user_capital = Number(pool.user_capital || 0);
    pool.loaned_amount = Number(pool.loaned_amount || 0);
    return pool;
  });
};
```

**文件**: `backend/services/poolService.js`

**当前状态**: `invest()`、`redeem()`、`borrowFromPool()`、`repay()` 四个函数都在事务外读取池和用户数据，然后在事务内使用过时的值。

**修改内容**（以 `invest()` 为例，其他三个函数同理）:

**当前代码**（第 189-242 行）:
```javascript
exports.invest = async (userId, amount) => {
  // ... 校验逻辑不变 ...
  
  const user = await userDao.findById(userId);  // 事务外读取
  // ... 校验 ...
  const pool = await poolDao.getPool();  // 事务外读取
  
  await transaction(async (connection) => {
    await poolDao.updatePoolV2({  // 使用过时的 pool 值
      platform_capital: pool.platform_capital,
      user_capital: (pool.user_capital || 0) + amount,
      loaned_amount: pool.loaned_amount || 0
    });
    await userDao.updateBalance(userId, user.balance - amount);  // 使用过时的 user 值
  });
};
```

**修改后**:
```javascript
exports.invest = async (userId, amount) => {
  userId = userId.toString();
  
  if (!userId || !amount) {
    throw new Error('缺少必要参数');
  }
  if (amount < 100) {
    throw new Error('出资金额必须大于等于100元');
  }
  if (amount > 100000) {
    throw new Error('单次出资金额不能超过10万元');
  }

  // 预校验（事务外，仅做业务规则校验）
  const user = await userDao.findById(userId);
  if (!user) throw new Error('用户不存在');
  if (user.credit_score < 600) throw new Error('信用分低于600，无法出资');

  // 事务内完成所有读写
  await transaction(async (connection) => {
    // 事务内重新读取用户数据（带行锁）
    const freshUser = await userDao.findById(userId);
    if (freshUser.balance < amount) {
      throw new Error('余额不足');
    }
    
    // 事务内重新读取池数据（updatePoolV2 内部会 FOR UPDATE）
    const pool = await poolDao.getPool();
    
    await poolDao.updatePoolV2({
      platform_capital: pool.platform_capital,
      user_capital: (pool.user_capital || 0) + amount,
      loaned_amount: pool.loaned_amount || 0
    });
    
    await userDao.updateBalance(userId, freshUser.balance - amount);
  });

  logger.info(`用户 ${userId} 出资 ${amount} 元成功`);
  return true;
};
```

**对 `redeem()`、`borrowFromPool()`、`repay()` 做同样的修改**：
- 将 `user = await userDao.findById(userId)` 和 `pool = await poolDao.getPool()` 移入事务回调内
- 事务内使用 `SELECT ... FOR UPDATE` 读取（通过 `updatePoolV2` 和 `userDao` 的事务内查询）

**验证**:
- 并发投资 10 个请求，资金池金额一致
- 并发赎回 10 个请求，资金池金额一致
- 并发借款+还款，余额正确

---

### 3.3 TOCTOU 竞态修复

**文件**: `backend/routes/loan.js`

**当前状态**: 路由层在事务外读取用户余额，然后传递给 service 层。

**修改内容**:

在 `loan.js` 的借款处理（约第 127 行）和还款处理（约第 388 行）中：

1. **移除事务外的余额读取**（用于业务校验的部分）
2. **将所有校验移入 service 层的事务内**

借款处理修改：
```javascript
// 当前代码（需要删除）:
const user = await userDao.findById(userId);  // 事务外读取
if (user.balance < amount) { ... }  // 基于过时值的校验

// 修改为：只做基本参数校验，余额校验在 poolService.borrowFromPool 事务内完成
```

还款处理修改：
```javascript
// 当前代码（需要删除）:
const user = await userDao.findById(userId);  // 事务外读取
if (user.balance < actualRepayAmount) { ... }  // 基于过时值的校验

// 修改为：只做基本参数校验，余额校验在 poolService.repay 事务内完成
```

**文件**: `backend/services/poolService.js`

在 `borrowFromPool()` 和 `repay()` 的事务回调内添加用户余额校验：

```javascript
// borrowFromPool 事务内：
const freshUser = await userDao.findById(userId);
if (freshUser.balance < amount) {
  throw new Error('余额不足');
}

// repay 事务内：
const freshUser = await userDao.findById(userId);
if (freshUser.balance < totalRepayment) {
  throw new Error('余额不足');
}
```

**验证**:
- 并发借款超出余额时只有一个成功
- 并发还款不出现双重扣款

---

### 3.4 MFA 重置越权修复

**文件**: `backend/routes/mfa.js`

**当前状态**: `/reset` 端点（第 75-102 行）无认证，使用 `req.body.userId`。

**修改内容**:

```javascript
// 当前代码:
router.post('/reset', async (req, res) => {
  try {
    const { userId } = req.body;
    // ...

// 修改为:
router.post('/reset', async (req, res) => {
  try {
    // 检查认证
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: '未认证' });
    }
    
    const userId = req.user.id;  // 使用 JWT 中的用户 ID，不从 body 取
    
    const user = await userDao.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    await userDao.updateTotpSecret(userId, null);
    await userDao.updateBackupCodes(userId, null);
    await userDao.update(user.id, { totp_enabled: false });

    logger.info('MFA reset completed for user', { userId });

    res.status(200).json({ 
      success: true, 
      message: 'MFA 已重置，请重新登录设置新的 MFA' 
    });
  } catch (error) {
    console.error('MFA reset error:', error);
    res.status(500).json({ success: false, message: 'MFA 重置失败' });
  }
});
```

**验证**:
- 无 token 请求 → 401 Unauthorized
- 用户 A 的 token 只能重置自己的 MFA

---

### 3.5 JWT 密钥分离

**文件**: `backend/utils/authUtils.js`

**修改 1**: 删除 `perfuser` 后门（第 21-23 行）

```javascript
// 删除以下代码:
if (user.username === 'perfuser') {
  payload.bypassRateLimit = true;
}
```

**修改 2**: 移除 refresh token 回退（第 44 行）

```javascript
// 当前代码:
return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET, {

// 修改为:
return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
```

**修改 3**: 移除 verifyRefreshToken 回退（第 70 行）

```javascript
// 当前代码:
return jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);

// 修改为:
return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
```

**验证**:
- 使用 access token 的 secret 无法伪造 refresh token
- refresh token 使用独立 secret 签发
- `perfuser` 不再绕过限流

---

### 3.6 密码哈希时序安全

**文件**: `backend/utils/cryptoUtils.js`

**修改 1**: `verifySM3Hash`（第 159-163 行）

```javascript
// 当前代码:
exports.verifySM3Hash = (password, storedHash, salt) => {
  const saltedPassword = password + salt;
  const hash = sm3(saltedPassword);
  return hash === storedHash;
};

// 修改为:
exports.verifySM3Hash = (password, storedHash, salt) => {
  const saltedPassword = password + salt;
  const hash = sm3(saltedPassword);
  if (hash.length !== storedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
};
```

**修改 2**: `verifyPBKDF2Hash`（第 186-192 行）

```javascript
// 当前代码:
exports.verifyPBKDF2Hash = (password, storedHash) => {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterations, salt, expectedHash] = parts;
  const derived = crypto.pbkdf2Sync(password, salt, parseInt(iterations), PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return derived.toString('hex') === expectedHash;
};

// 修改为:
exports.verifyPBKDF2Hash = (password, storedHash) => {
  const parts = storedHash.split(':');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const [, iterations, salt, expectedHash] = parts;
  const derived = crypto.pbkdf2Sync(password, salt, parseInt(iterations), PBKDF2_KEYLEN, PBKDF2_DIGEST);
  const derivedHex = derived.toString('hex');
  if (derivedHex.length !== expectedHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(derivedHex, 'hex'), Buffer.from(expectedHash, 'hex'));
};
```

**修改 3**: SM2 签名缓存键（第 286 行）

```javascript
// 当前代码:
const cacheKey = `sm2_sign::${message}::${privateKey.slice(-8)}`;

// 修改为（使用哈希而非明文）:
const cacheKey = `sm2_sign::${message}::${crypto.createHash('sha256').update(privateKey).digest('hex').slice(0, 16)}`;
```

**验证**:
- 正确密码验证通过
- 错误密码验证失败
- 时序攻击无法区分正确/错误密码

---

### 3.7 MFA 服务安全修复

**文件**: `backend/services/mfaService.js`

**修改 1**: `generateBackupCodes` 使用 `crypto.randomInt`（第 111-122 行）

```javascript
// 当前代码:
generateBackupCodes(count = 10) {
  const codes = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    codes.push(code);
  }
  return codes;
}

// 修改为:
generateBackupCodes(count = 10) {
  const codes = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (let i = 0; i < count; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += chars.charAt(crypto.randomInt(chars.length));
    }
    codes.push(code);
  }
  return codes;
}
```

**修改 2**: `decryptSecret` 移除明文回退（第 140-154 行）

```javascript
// 当前代码:
decryptSecret(encryptedSecret) {
  const parts = encryptedSecret.split(':');
  if (parts.length === 2) {
    // ... 解密逻辑 ...
  }
  // 旧格式（未加密）：直接返回
  logger.warning('MFA secret in old format (plaintext)', { format: 'old' });
  return encryptedSecret;
}

// 修改为:
decryptSecret(encryptedSecret) {
  const parts = encryptedSecret.split(':');
  if (parts.length !== 2) {
    throw new Error('MFA secret 格式无效（期望 iv:ciphertext 格式）');
  }
  const key = this.getSm4Key();
  const ivHex = parts[0];
  const ciphertextHex = parts[1];
  const decrypted = sm4.decrypt(ciphertextHex, key, { iv: ivHex, mode: 'cbc' });
  return Buffer.from(decrypted, 'hex').toString('utf8');
}
```

**验证**:
- 备份码生成使用密码学安全随机
- 无效格式的 MFA secret 抛出错误而非返回明文

---

### 3.8 数据隔离修复

**文件**: `backend/routes/invest.js`

**修改 1**: 删除双重余额扣除（第 192 行）

```javascript
// 删除以下代码（第 191-196 行）:
// 更新余额
await userDao.updateBalance(userId, user.balance - parseInt(amount));
logger.info('更新用户余额', {
  userId: user.id,
  newBalance: user.balance - parseInt(amount)
});
```

**修改 2**: POST `/` 添加数据隔离（第 75 行之后）

```javascript
// 在参数解构之后添加:
if (parseInt(userId) !== req.user.id) {
  return res.status(403).json({ success: false, message: '无权操作其他用户的投资' });
}
```

**修改 3**: GET `/:userId` 添加数据隔离（第 259 行之后）

```javascript
// 在参数解构之后添加:
if (parseInt(req.params.userId) !== req.user.id) {
  return res.status(403).json({ success: false, message: '无权查看其他用户的投资' });
}
```

**修改 4**: GET `/investments/:userId` 添加数据隔离（第 281 行之后）

```javascript
// 在参数解构之后添加:
if (parseInt(req.params.userId) !== req.user.id) {
  return res.status(403).json({ success: false, message: '无权查看其他用户的投资' });
}
```

**文件**: `backend/routes/loan.js`

在借款处理和还款处理中添加数据隔离：

```javascript
// 借款处理（约第 104 行之后）:
const { userId, amount, creditProof, verificationCode, signature, term = 30 } = req.body;
if (parseInt(userId) !== req.user.id) {
  return res.status(403).json({ success: false, message: '无权操作其他用户的借款' });
}

// 还款处理（约第 375 行之后）:
const { userId, transactionId, creditProof, verificationCode, signature, partialAmount } = req.body;
if (parseInt(userId) !== req.user.id) {
  return res.status(403).json({ success: false, message: '无权操作其他用户的还款' });
}
```

**文件**: `backend/routes/pool.js`

```javascript
// GET /my-invest/:userId（约第 80 行之后）:
const { userId } = req.params;
if (parseInt(userId) !== req.user.id) {
  return res.status(403).json({ success: false, message: '无权查看其他用户的投资详情' });
}
```

**验证**:
- 用户 A 尝试投资/借款/还款时传入用户 B 的 ID → 403
- 用户 A 查看用户 B 的投资列表 → 403
- 用户 A 查看自己的数据 → 200

---

### 3.9 死代码清理

**删除以下文件**:
- `backend/models/user.js`（Mongoose 模型，未被任何文件导入）
- `backend/models/transaction.js`（Mongoose 模型，未被任何文件导入）
- `backend/models/loan.js`（Mongoose 模型，未被任何文件导入）

**验证**: 删除后运行测试套件，确认无导入错误。

---

## 四、阶段2：国密完善（基础设施层）

### 4.1 FISCO BCOS SM_SSL 切换

**修改文件**: WSL 中 `~/fisco-bcos-node/127.0.0.1/node0/config.ini`

**当前状态**: `ssl_type=ssl`（标准 SSL）

**修改内容**:
```ini
[network]
ssl_type=sm_ssl
```

**验证步骤**:
1. 确保 `gmca.crt`、`gmsdk.crt`、`gmsdk.key` 在正确路径
2. 重启 FISCO BCOS 节点
3. 验证 `getClientVersion`、`getBlockNumber` 等基本 RPC 调用正常
4. 验证合约调用（读写）正常

**风险**: 如切换失败，可回退到 `ssl_type=ssl`。

---

### 4.2 Tengine NTLS 启用

**修改文件**: `scripts/start-system.sh`

**当前状态**: 已有 NTLS 启动逻辑（第 5 步），但需要验证配置正确性。

**验证步骤**:
1. 确保 `/usr/local/tengine-ntls/conf/nginx-ntls.conf` 存在且证书路径正确
2. 启动后验证 4 种密码套件握手成功
3. 验证反向代理到后端正常
4. 验证标准 HTTPS (port 443) 仍然正常

---

### 4.3 前端 HTTPS 路由

**修改文件**: `frontend/src/setupProxy.js`

**当前状态**: 已支持 `HTTPS_TARGET` 环境变量，默认 `http://localhost:3003`。

**验证步骤**:
1. 设置 `HTTPS_TARGET=https://localhost:443` 时前端通过 Tengine HTTPS 代理访问后端
2. 不设置时前端直接 HTTP 访问后端（开发模式）

---

### 4.4 端到端国密验证

**新增文件**: `scripts/wsl/test-e2e-guomi.sh`

**验证链路**:
```
前端 → Tengine(NTLS:8443, SM2+SM4+SM3) → 后端(:3003) → FISCO BCOS(SM_SSL, SM2+SM3)
```

记录每个环节使用的密码算法，确保全链路 SM2/SM3/SM4。

---

## 五、阶段3：区块链深化（功能层）

### 5.1 部署 Verifier 合约

**修改文件**: `backend/scripts/deploy-fisco.js`

**当前状态**: 只部署 `AuditStorage` 和 `ZKPVerifier`，未部署 `Verifier`（Groth16 验证合约）。

**修改内容**:
1. 加载 `Verifier` 合约 ABI 和 bytecode
2. 部署 `Verifier` 合约
3. 授权 deployer 为 `ZKPVerifier` 操作员
4. 更新 `contract-addresses.json`

**修改文件**: `contracts/scripts/deploy.js`

**当前状态**: 已部署 `Verifier`，但未授权 deployer 为 `ZKPVerifier` 操作员。

**修改内容**: 在第 85 行之后添加：
```javascript
await zkpVerifier.authorizeOperator(deployer.address);
```

**验证**:
- 部署成功，合约地址有效
- `verifyProof()` 方法可调用
- deployer 有 ZKPVerifier 操作权限

---

### 5.2 双层 ZKP 验证

**修改文件**: `backend/services/blockchainServiceFisco.js`

**添加新方法**: `verifyZKPOnChain(proof, publicSignals)`

```javascript
async verifyZKPOnChain(proof, publicSignals) {
  try {
    if (!this.isInitialized) {
      return { success: false, error: 'Service not initialized' };
    }
    
    // 将 proof 转换为合约参数格式
    const pA = [proof.pi_a[0], proof.pi_a[1]];
    const pB = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]];
    const pC = [proof.pi_c[0], proof.pi_c[1]];
    const pubSignals = publicSignals.map(s => s.toString());
    
    const result = await this.contractCall('Verifier', 'verifyProof', [pA, pB, pC, pubSignals]);
    return { success: true, isValid: result };
  } catch (error) {
    logger.error('链上 ZKP 验证失败', { error: error.message });
    return { success: false, error: error.message };
  }
}
```

**添加重试机制**: 在 `sendTransaction` 方法中添加重试逻辑

```javascript
async sendTransaction(contractName, methodName, params, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // ... 现有逻辑 ...
      return result;
    } catch (error) {
      if (attempt === retries) throw error;
      if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
        logger.warn(`交易失败，重试 ${attempt + 1}/${retries}`, { error: error.message });
        await new Promise(r => setTimeout(r, 1000));
      } else {
        throw error;  // 合约 revert 不重试
      }
    }
  }
}
```

**修改文件**: `backend/services/zkService.js`

**当前状态**: 验证成功后调用 `blockchainService.recordZKPResult()`，但未调用 `verifyZKPOnChain()`。

**修改内容**: 在第 185 行之后添加链上验证调用：

```javascript
// 现有的链上记录
blockchainService.recordZKPResult(proofId, true, proofHash)
  .then(result => { /* ... */ })
  .catch(err => { /* ... */ });

// 新增：链上 ZKP 验证
blockchainService.verifyZKPOnChain(formattedProof, publicSignals)
  .then(result => {
    if (result.success && !result.isValid) {
      logger.warn('链上 ZKP 验证结果与后端不一致', { proofId, backendValid: true, chainValid: result.isValid });
    }
  })
  .catch(err => {
    logger.warn('链上 ZKP 验证调用失败（非阻塞）', { error: err.message });
  });
```

**验证**:
- 有效证明 → 后端验证通过 + 链上验证通过
- 无效证明 → 后端验证失败，不调用链上验证
- 链上服务不可用时 → 后端验证仍正常，记录警告日志

---

### 5.3 验证 UX 完善

**修改文件**: `backend/routes/blockchain.js`

**添加新端点**: `GET /api/v1/blockchain/zkp-verify/:proofId`

```javascript
router.get('/zkp-verify/:proofId', async (req, res) => {
  try {
    const { proofId } = req.params;
    const result = await blockchainService.getZKPResult(proofId);
    if (!result) {
      return res.status(404).json({ success: false, message: 'ZKP 验证记录不存在' });
    }
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('ZKP 验证查询失败', { error: error.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});
```

**修改文件**: `frontend/src/pages/BlockchainExplorer.js`

在 ZKP 记录的展开行中添加"链上验证"状态显示：

```jsx
// 在展开行中添加:
{record.type === 'zkp' && (
  <Box sx={{ mt: 1 }}>
    <Typography variant="body2" color="textSecondary">
      链上验证状态: {record.chainVerified ? '已验证' : '未验证'}
    </Typography>
    {record.chainVerified && (
      <Typography variant="body2" color="textSecondary">
        验证结果: {record.chainValid ? '有效' : '无效'}
      </Typography>
    )}
  </Box>
)}
```

---

### 5.4 健壮性优化

**修改文件**: `backend/services/blockchainServiceFisco.js`

**修改 1**: 所有 `exec()` 调用添加超时（已有 `{ timeout: 30000 }`，确认一致）

**修改 2**: 初始化失败时设置 `this.isInitialized = false`

```javascript
async initialize() {
  try {
    // ... 现有逻辑 ...
    this.isInitialized = true;
  } catch (error) {
    this.isInitialized = false;
    logger.error('区块链服务初始化失败', { error: error.message });
    throw error;
  }
}
```

**修改 3**: 所有写入操作检查初始化状态

```javascript
async storeAuditHash(sm3Hash, timestamp, transactionType, userId) {
  if (!this.isInitialized) {
    return { success: false, error: 'Service not initialized' };
  }
  // ... 现有逻辑 ...
}
```

**验证**:
- 服务未初始化时，写入操作返回 `{ success: false, error: 'Service not initialized' }`
- 超时后操作正确失败
- 重试机制在超时/网络错误时生效

---

## 六、测试策略

### 6.1 单元测试

| 测试点 | 测试内容 |
|--------|----------|
| 密钥校验 | 缺失 SM4_MASTER_KEY → 启动失败 |
| 密钥校验 | 弱 JWT_SECRET → 启动失败 |
| 密钥校验 | JWT_REFRESH_SECRET = JWT_SECRET → 启动失败 |
| 密钥校验 | DB_PASSWORD = 123456 → 启动失败 |
| 时序安全 | verifySM3Hash 正确/错误密码耗时相近 |
| 时序安全 | verifyPBKDF2Hash 正确/错误密码耗时相近 |
| MFA 备份码 | 使用 crypto.randomInt（非 Math.random） |
| MFA 解密 | 无效格式抛出错误 |

### 6.2 集成测试

| 测试点 | 测试内容 |
|--------|----------|
| 并发投资 | 10 个并发请求，资金池金额一致 |
| 并发赎回 | 10 个并发请求，资金池金额一致 |
| 并发借款 | 超出余额时只有一个成功 |
| 并发还款 | 不出现双重扣款 |
| MFA 重置 | 无 token → 401 |
| MFA 重置 | 用户 A 重置用户 B → 403 |
| 数据隔离 | 用户 A 查看用户 B 投资 → 403 |
| 双重扣除 | 投资后余额正确（非双重扣除） |

### 6.3 端到端测试

| 测试点 | 测试内容 |
|--------|----------|
| 国密链路 | 前端 → NTLS → 后端 → FISCO 全链路 SM2/SM3/SM4 |
| ZKP 验证 | 有效证明 → 后端 + 链上验证通过 |
| ZKP 验证 | 无效证明 → 后端验证失败 |
| ZKP 验证 | 链上服务不可用 → 后端仍正常 |

---

## 七、文件变更汇总

### 新增文件
| 文件 | 用途 |
|------|------|
| `scripts/wsl/test-e2e-guomi.sh` | 端到端国密验证脚本 |

### 修改文件
| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `backend/utils/keyManager.js` | 增强 | 添加 JWT_REFRESH_SECRET、DB_PASSWORD 校验 |
| `backend/.env.example` | 添加 | 添加 JWT_REFRESH_SECRET 占位符 |
| `backend/.gitignore` | 修复 | `.env` → `**/.env` |
| `backend/dao/poolDao.js` | 重构 | updatePoolV2 添加行锁和事务 |
| `backend/services/poolService.js` | 修复 | 事务内读取，移除事务外读取 |
| `backend/routes/loan.js` | 修复 | 移除事务外余额读取，添加数据隔离 |
| `backend/routes/invest.js` | 修复 | 删除双重余额扣除，添加数据隔离 |
| `backend/routes/pool.js` | 修复 | 添加数据隔离 |
| `backend/routes/mfa.js` | 修复 | /reset 添加认证，使用 req.user.id |
| `backend/utils/authUtils.js` | 修复 | 删除 perfuser 后门，移除 JWT 回退 |
| `backend/utils/cryptoUtils.js` | 修复 | 时序安全比较，缓存键哈希化 |
| `backend/services/mfaService.js` | 修复 | crypto.randomInt，移除明文回退 |
| `backend/services/blockchainServiceFisco.js` | 增强 | 添加 verifyZKPOnChain、重试机制 |
| `backend/services/zkService.js` | 增强 | 添加链上 ZKP 验证调用 |
| `backend/routes/blockchain.js` | 增强 | 添加 zkp-verify 端点 |
| `frontend/src/pages/BlockchainExplorer.js` | 增强 | ZKP 验证状态显示 |
| `contracts/scripts/deploy.js` | 修复 | 添加 ZKPVerifier 授权 |
| `backend/scripts/deploy-fisco.js` | 增强 | 添加 Verifier 合约部署 |
| `scripts/start-system.sh` | 验证 | 确认 NTLS 启动逻辑正确 |

### 删除文件
| 文件 | 原因 |
|------|------|
| `backend/models/user.js` | 死代码（Mongoose 模型未使用） |
| `backend/models/transaction.js` | 死代码 |
| `backend/models/loan.js` | 死代码 |

---

## 八、执行顺序

1. **阶段1（安全加固）** — 按 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.8 → 3.9 顺序执行
   - 每个子任务完成后运行相关测试
   - 阶段1完成后运行完整测试套件

2. **阶段2（国密完善）** — 按 4.1 → 4.2 → 4.3 → 4.4 顺序执行
   - 需要 WSL 环境
   - 阶段2完成后运行端到端测试

3. **阶段3（区块链深化）** — 按 5.1 → 5.2 → 5.3 → 5.4 顺序执行
   - 需要 FISCO BCOS 节点运行
   - 阶段3完成后运行区块链集成测试

---

## 九、审查清单（实施完成后对照检查）

### 9.1 代码审查

- [ ] 所有修改的文件是否在本方案列出的范围内？
- [ ] 是否引入了新的 npm 依赖？
- [ ] 是否有硬编码的密钥或密码？
- [ ] 所有资金操作是否在事务内完成读写？
- [ ] 所有密文/哈希比较是否使用 `crypto.timingSafeEqual`？
- [ ] 是否有 `Math.random()` 用于安全场景？
- [ ] 是否有 `console.log` 调试语句？
- [ ] 是否有未使用的变量或导入？

### 9.2 安全审查

- [ ] MFA 重置是否需要认证？
- [ ] 所有写操作是否检查 `req.user.id === userId`？
- [ ] JWT refresh token 是否使用独立 secret？
- [ ] `perfuser` 后门是否已删除？
- [ ] MFA 解密是否拒绝无效格式？
- [ ] 备份码生成是否使用密码学安全随机？

### 9.3 功能审查

- [ ] 并发投资/赎回/借款/还款是否正确（无竞态）？
- [ ] 投资后余额是否正确（无双重扣除）？
- [ ] ZKP 验证是否调用链上验证？
- [ ] 区块链服务是否有重试机制？
- [ ] 所有修改的测试是否通过？

### 9.4 架构审查

- [ ] 区块链服务路由是否正确（blockchainService → blockchainServiceFisco）？
- [ ] 事务内读取是否使用 `SELECT ... FOR UPDATE`？
- [ ] 密钥校验是否在启动时执行？
- [ ] 国密链路是否端到端验证？

---

## 十、附录：关键文件路径速查

| 文件 | 用途 |
|------|------|
| `backend/utils/keyManager.js` | 密钥校验 |
| `backend/utils/authUtils.js` | JWT 生成/验证 |
| `backend/utils/cryptoUtils.js` | 密码学工具（SM2/SM3/PBKDF2） |
| `backend/dao/poolDao.js` | 资金池 DAO |
| `backend/services/poolService.js` | 资金池业务逻辑 |
| `backend/services/mfaService.js` | MFA 服务 |
| `backend/services/blockchainServiceFisco.js` | FISCO BCOS 适配层 |
| `backend/services/zkService.js` | ZKP 验证服务 |
| `backend/routes/mfa.js` | MFA 路由 |
| `backend/routes/invest.js` | 投资路由 |
| `backend/routes/loan.js` | 借款路由 |
| `backend/routes/pool.js` | 资金池路由 |
| `backend/routes/blockchain.js` | 区块链路由 |
| `contracts/contracts/AuditStorage.sol` | 审计存储合约 |
| `contracts/contracts/ZKPVerifier.sol` | ZKP 验证合约 |
| `contracts/scripts/deploy.js` | Hardhat 部署脚本 |
| `backend/scripts/deploy-fisco.js` | FISCO BCOS 部署脚本 |
