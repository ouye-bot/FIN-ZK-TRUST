# FinZkTrust 测试改进第二轮 — 执行指令

> 本轮目标：修复第一轮审查发现的系统级 Bug 和测试脚本质量问题。
> 执行前通读全文，有任何不确定之处先确认，不动手。

---

## 执行顺序（严格按此顺序）

1. 系统 Bug 修复（4 个源码文件）
2. crypto.test.js 修复
3. security-fault-tolerance-test.js 修复
4. performance-test.js 修复
5. 运行验证

---

## 一、系统级 Bug 修复

### 1.1 Bug B3：SM4 decrypt 静默返回原文（P0 致命）

**文件**：`backend/utils/sm4Crypto.js`

**问题**：`decrypt` 函数在解密失败时返回原始 `ciphertext` 而非抛异常。这意味着篡改密文不会被检测到，调用方拿到的是加密字符串而非明文，`Number()` 转换后变成 `NaN`，静默破坏 `balance`、`credit_score` 等数值字段。

**改动要求**：

找到 `decrypt` 函数（约 L40-91），将所有 `return ciphertext;` 改为 `throw new Error(...)`：

| 行号（参考） | 当前代码 | 改为 |
|-------------|---------|------|
| ~L59 | `return ciphertext;` | `throw new Error('SM4 解密失败：数据格式无效');` |
| ~L65 | `return ciphertext;` | `throw new Error('SM4 解密失败：未知格式');` |
| ~L69 | `return ciphertext;` | `throw new Error('SM4 解密失败：版本格式错误');` |
| ~L79 | `return ciphertext;` | `throw new Error('SM4 解密失败：认证标签不匹配');` |
| ~L89 | `return ciphertext;` | `throw new Error('SM4 解密失败：解密过程异常');` |

**注意**：保留 `logger.warning(...)` 日志行，只改返回行为为抛异常。

**同步修改 `decryptFields` 函数**（约 L198-225）：

`decryptFields` 对每个字段调用 `decrypt`，需要增加 try/catch 保护，避免单个字段解密失败导致整个对象解密中断：

```javascript
// 在 decryptFields 的循环中，将：
const decryptedValue = decrypt(encryptedValue);

// 改为：
let decryptedValue;
try {
  decryptedValue = decrypt(encryptedValue);
} catch (decryptError) {
  logger.warning(`字段 ${fieldName} 解密失败: ${decryptError.message}`);
  decryptedValue = encryptedValue; // 保留原值，不中断其他字段
}
```

**禁止项**：
- 不要删除 `logger.warning` 日志
- 不要改变 `encrypt` 函数的任何行为
- 不要改变密文格式（`v1:iv:authTag:ciphertext`）

**验收标准**：
- 篡改密文后 `decrypt` 抛出包含"认证标签不匹配"的异常
- 截断密文后 `decrypt` 抛出异常
- 正常加密→解密流程不受影响

---

### 1.2 Bug B5：黑名单 Token 请求挂起（P0 致命）

**文件**：`backend/middleware/securityChain.js`

**问题**：L55-58 检测到黑名单 Token 后只 `return;` 不发送 HTTP 响应，导致请求永远挂起。

**改动要求**：

找到黑名单检测代码（约 L55-58）：

```javascript
// 当前代码：
if (isBlacklisted) {
  console.log('[JWT] Token is blacklisted:', decoded.jti);
  return;
}

// 改为：
if (isBlacklisted) {
  console.log('[JWT] Token is blacklisted:', decoded.jti);
  return res.status(401).json({ success: false, message: 'Token 已被撤销' });
}
```

**禁止项**：
- 不要改变黑名单检测逻辑
- 不要移除 console.log 日志
- 不要改变 next() 的调用方式

**验收标准**：
- 使用已注销的 Token 访问受保护接口，立即返回 401，不超时

---

### 1.3 Bug B7：信用分 clamp 到 900（P1 中）

**文件**：`backend/routes/credit.js`

**问题**：L370 `Math.min(900, score)` 与 `CREDIT_RULES.MAX_SCORE: 850` 不一致。

**改动要求**：

找到信用分 clamp 代码（约 L370）：

```javascript
// 当前：
score = Math.max(300, Math.min(900, score));

// 改为：
score = Math.max(CREDIT_RULES.MIN_SCORE, Math.min(CREDIT_RULES.MAX_SCORE, score));
```

确保 `CREDIT_RULES` 在作用域内可用（它定义在同文件 L10-39）。

**验收标准**：
- 信用分不会超过 850

---

### 1.4 Bug B8：密码盐使用 Math.random（P1 中）

**文件**：`backend/utils/cryptoUtils.js`

**问题**：L121 `Math.random().toString(36).substring(2, 15)` 不是密码学安全的随机数。

**改动要求**：

找到 `generateSaltedSM3Hash` 函数（约 L120-125）：

```javascript
// 当前：
const salt = Math.random().toString(36).substring(2, 15);

// 改为：
const salt = crypto.randomBytes(16).toString('hex');
```

确保文件顶部有 `const crypto = require('crypto');`（检查是否已存在）。

**禁止项**：
- 不要改变函数签名
- 不要改变返回值格式（`{ hash, salt }`）

**验收标准**：
- 每次调用生成的 salt 为 32 字符 hex 字符串
- 相同密码两次调用的 salt 和 hash 都不同

---

## 二、crypto.test.js 改动

**文件**：`backend/test/crypto.test.js`

### 2.1 标记 5 个系统 Bug 失败为 knownIssue

#### 用例 1.9 私钥格式错误（约 L188-201）

当前：`signWithSM2` 不抛异常时标记 `passed: false`
改为：不抛异常时标记为 knownIssue

```javascript
// 将 catch 块外的 addResult 改为：
this.addResult('sm2', '私钥格式错误', false, {
  knownIssue: true,
  expectedBehavior: 'signWithSM2 对无效私钥应抛出异常',
  actualBehavior: '未抛出异常，静默接受无效私钥',
  bugId: 'B-SM2-INPUT',
  bugLocation: 'cryptoUtils.js:signWithSM2'
});
```

#### 用例 1.10 签名位翻转检测（约 L203-212）

当前：翻转签名后验签返回 true 时标记 `passed: false`
改为：标记为 knownIssue

```javascript
// 将 addResult 改为：
this.addResult('sm2', '签名位翻转检测', !flipVerify, {
  knownIssue: true,
  expectedBehavior: '翻转签名位后验签应返回 false',
  actualBehavior: `验签返回 ${flipVerify}`,
  bugId: 'B9',
  bugLocation: 'cryptoUtils.js:verifySM2Signature'
});
```

#### 用例 3.9 认证标签完整性（约 L547-594）

当前：三个篡改子用例中任一未抛异常则整体 `passed: false`
改为：标记为 knownIssue

在 `allTamperDetected` 判断后的 addResult 中添加：

```javascript
this.addResult('sm4', '认证标签完整性（系统性）', allTamperDetected, {
  knownIssue: true,
  expectedBehavior: '篡改 IV/authTag/ciphertext 后解密应抛异常',
  actualBehavior: `iv=${ivTamperResult}, authTag=${authTagTamperResult}, ciphertext=${ciphertextTamperResult}`,
  bugId: 'B3',
  bugLocation: 'sm4Crypto.js:decrypt 多处'
});
```

#### 用例 5.6 不达标 score<threshold（约 L850-869）

当前：`verifyProof` 返回 true 时标记 `passed: false`
改为：标记为 knownIssue

```javascript
this.addResult('zkp', '不达标 score<threshold', lowVerify === false, {
  knownIssue: true,
  score: 500,
  threshold: 600,
  expectedBehavior: 'score < threshold 时 verifyProof 应返回 false',
  actualBehavior: `verifyProof 返回 ${lowVerify}`,
  bugId: 'B10',
  bugLocation: 'circuits/credit.circom:L14 使用 <-- 而非 <=='
});
```

#### 用例 5.7 单参数绕过（约 L872-896）

此用例已标记 `knownIssue: true`，但需更新 `actualBehavior` 记录 B2 已被修复：

```javascript
// 在 addResult 的 details 中更新：
actualBehavior: singleParamResult === true ? '返回 true（安全漏洞）' : '抛出异常（已修复）',
```

### 2.2 修正用例 3.8 reEncrypt 密钥轮换（约 L520-545）

**问题**：`decrypt(reEncrypted)` 不接受密钥参数，始终使用环境变量主密钥。测试对 API 理解有误。

**修复方案**：检查 `sm4Crypto` 是否导出了接受密钥参数的解密函数。如果没有，则测试改为只验证 v2 前缀和 reEncrypt 不抛异常：

```javascript
// 3.8 reEncrypt 密钥轮换
console.log('\n  3.8 reEncrypt 密钥轮换');
try {
  const { reEncrypt } = sm4Crypto;
  if (typeof reEncrypt !== 'function') {
    this.addResult('sm4', 'reEncrypt 密钥轮换', false, { note: 'reEncrypt 不可用' });
    console.log(`     ⚠️ reEncrypt 不可用`);
  } else {
    const plainData = 'sensitive data for key rotation test';
    const oldKey = process.env.SM4_MASTER_KEY;
    if (!oldKey) {
      this.addResult('sm4', 'reEncrypt 密钥轮换', false, { note: 'SM4_MASTER_KEY 未设置，跳过' });
      console.log(`     ⚠️ SM4_MASTER_KEY 未设置，跳过`);
    } else {
      const newKey = crypto.randomBytes(16).toString('hex');
      const encryptedOld = encrypt(plainData);
      const reEncrypted = reEncrypt(encryptedOld, oldKey, newKey);
      const hasV2Prefix = reEncrypted.startsWith('v2:');
      // 只验证 reEncrypt 输出格式正确且不抛异常
      // 不验证用新密钥解密（因为 decrypt 不接受密钥参数）
      const rotationOK = hasV2Prefix && typeof reEncrypted === 'string' && reEncrypted.length > 0;
      this.addResult('sm4', 'reEncrypt 密钥轮换', rotationOK, {
        hasV2Prefix,
        outputLength: reEncrypted.length,
        note: 'decrypt 不接受密钥参数，无法验证新密钥解密'
      });
      console.log(`     ${rotationOK ? '✓' : '✗'} 密钥轮换: v2前缀=${hasV2Prefix}, 输出长度=${reEncrypted.length}`);
    }
  }
} catch (e) {
  this.addResult('sm4', 'reEncrypt 密钥轮换', false, { error: e.message });
  console.log(`     ✗ reEncrypt 密钥轮换: 失败 - ${e.message}`);
}
```

### 2.3 修正用例 7.4 SSS (2,2) 阈值（约 L1095-1113）

**问题**：单分片恢复抛异常是正确行为（SSS 要求至少 2 个分片），但测试将异常视为失败。

**修复方案**：catch 块中检查异常消息，如果是"至少2个分片"则视为预期行为：

```javascript
// 7.4 不同阈值组合 (2,2)
console.log('\n  7.4 不同阈值组合 (2,2)');
try {
  const shares22 = splitSecretToShares(masterKey, 2, 2);
  let singleFailed = false;
  try {
    const singleShare = recoverSecretFromShares([shares22[0]]);
    singleFailed = singleShare.toLowerCase() !== masterKey.toLowerCase();
  } catch (e) {
    // 单分片抛异常 = 正确拒绝 = 通过
    singleFailed = true;
    console.log(`     单分片恢复正确抛出异常: ${e.message}`);
  }
  const bothShares = recoverSecretFromShares(shares22);
  const bothOK = bothShares.toLowerCase() === masterKey.toLowerCase();
  const threshold22OK = singleFailed && bothOK;
  this.addResult('sss', '不同阈值组合 (2,2)', threshold22OK, {
    bothMatch: bothOK,
    singleFailedToRecover: singleFailed
  });
  console.log(`     ${threshold22OK ? '✓' : '✗'} (2,2)组合: 单分片${singleFailed ? '无法恢复' : '错误恢复'}, 双分片${bothOK ? '正确恢复' : '恢复失败'}`);
} catch (e) {
  this.addResult('sss', '不同阈值组合 (2,2)', false, { error: e.message });
  console.log(`     ✗ (2,2)组合: 失败 - ${e.message}`);
}
```

### 2.4 修正 SM4 备用硬编码密钥（约 L529, L1046）

**问题**：`process.env.SM4_MASTER_KEY || '00112233445566778899aabbccddeeff'` 环境变量缺失时静默使用固定密钥。

**修复方案**：所有使用此模式的地方改为：环境变量缺失时 skip 该用例。

在文件中搜索所有 `process.env.SM4_MASTER_KEY ||` 出现的位置，统一改为：

```javascript
const sm4Key = process.env.SM4_MASTER_KEY;
if (!sm4Key) {
  this.addResult('模块名', '用例名', false, { note: 'SM4_MASTER_KEY 环境变量未设置，跳过' });
  console.log(`     ⚠️ SM4_MASTER_KEY 未设置，跳过`);
  return; // 或 continue，取决于上下文
}
```

### 2.5 增强弱断言

#### 用例 5.4 ZKP 数据结构完整性（约 L830-845）

当前：只检查 `publicSignals.length >= 1`
增加：检查 `publicSignals[0]` 是有效的数值字符串

```javascript
const structureOK = lowProof.proof.pi_a && lowProof.proof.pi_b && lowProof.proof.pi_c
  && Array.isArray(lowProof.publicSignals)
  && lowProof.publicSignals.length >= 1
  && !isNaN(Number(lowProof.publicSignals[0]));
```

#### 用例 5.8 极端值 score=300（约 L890-910）

当前：只检查证明结构存在
增加：验证 proof 通过 verifyProof

```javascript
const extremeProof = await zkService.generateProof(300, 300);
if (extremeProof && extremeProof.proof) {
  const extremeVerify = await zkService.verifyProof(extremeProof.proof, extremeProof.publicSignals);
  const structureOK = extremeProof.proof.pi_a && extremeProof.proof.pi_b && extremeProof.proof.pi_c;
  const extremeOK = structureOK && extremeVerify === true;
  this.addResult('zkp', '极端值 - 低分', extremeOK, {
    score: 300, threshold: 300, structureOK, verifyResult: extremeVerify
  });
  console.log(`     ${extremeOK ? '✓' : '✗'} score=300: 结构=${structureOK}, 验证=${extremeVerify}`);
} else {
  this.addResult('zkp', '极端值 - 低分', false, { note: '证明生成失败' });
}
```

### 2.6 修正 6.3 猴子补丁保护（约 L987-1009）

将 mock/restore 包裹在 try/finally 中：

```javascript
const originalInit = blockchainService.initialize;
const originalIsInit = blockchainService.isInitialized;
try {
  blockchainService.initialize = async () => false;
  blockchainService.isInitialized = false;
  // ... 原有测试逻辑 ...
} finally {
  blockchainService.initialize = originalInit;
  blockchainService.isInitialized = originalIsInit;
}
```

### 2.7 修正 4.7 备份码复用测试（约 L730-750）

当前：二次验证同一备份码仍返回有效 index，测试认为通过
改为：二次验证应返回 -1（码已使用），如果返回有效 index 则标记为 knownIssue

```javascript
// 在第一次验证成功后，立即用同一码再次验证：
const reuseResult = verifyBackupCode(hashedCodes, backupCodes[validIndex]);
if (reuseResult >= 0) {
  // 系统允许码复用 — 这是安全缺陷
  console.log(`     ⚠️ 备份码复用: 二次验证仍返回 index=${reuseResult}（应拒绝已使用的码）`);
  // 将此信息记录到测试结果中，但不影响整体通过判定
}
```

---

## 三、security-fault-tolerance-test.js 改动

**文件**：`backend/test/security-fault-tolerance-test.js`

### 3.1 所有 HTTP 请求添加 timeout

在文件顶部（约 L14 附近）添加常量：

```javascript
const REQUEST_TIMEOUT = 10000; // 10 秒超时
```

然后在**所有** axios 调用的 config 对象中添加 `timeout: REQUEST_TIMEOUT`。

以下是需要添加 timeout 的行号列表（参考值，以实际代码为准）：

- L148: `axios.post(.../auth/register, ...)`
- L169: `axios.post(.../auth/login, ...)`
- L187: `axios.put(.../users/.../update-sm2-key, ...)`
- L225, L246, L270, L280, L301, L322: 模块 1 防重放测试
- L341: 模块 1 白名单测试
- L391, L408, L429: 模块 2 JWT 测试
- L485, L513, L540, L568: 模块 3 参数校验测试
- L606, L625, L653, L681: 模块 4 错误处理测试
- L739, L763, L805, L828, L851: 模块 5 SM2 签名测试
- L1139, L1196: 模块 8 认证链路测试
- L1215, L1221: 模块 8.4 登录/注销

已有 timeout 的行（不需要改动）：
- L1159, L1163: `timeout: 5000`
- L1228: `timeout: 5000`

**方法**：搜索文件中所有 `axios.post(`, `axios.get(`, `axios.put(` 调用，在 config 参数中添加 `timeout: REQUEST_TIMEOUT`。如果 config 对象不存在，创建一个：

```javascript
// 之前：
await axios.post(`${BASE_URL}/auth/login`, body);

// 之后：
await axios.post(`${BASE_URL}/auth/login`, body, { timeout: REQUEST_TIMEOUT });
```

### 3.2 收紧 5.1 和 5.3 断言

#### 5.1 有效签名通过（约 L734-754）

```javascript
// 将 try 块中的 passedCount++ 改为条件判断：
try {
  const headers = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
  headers['x-user-id'] = testUser.userId;
  headers['x-sm2-signature'] = headers['x-request-sign'];
  const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
    headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
    timeout: REQUEST_TIMEOUT
  });
  const status = res.status;
  const passed = (status >= 200 && status < 500 && status !== 401 && status !== 403);
  results.push({ name: '有效签名通过', status: passed ? 'passed' : 'failed', expected: '200/400', actual: status });
  if (passed) passedCount++;
  console.log(`  ${passed ? '✅' : '❌'} 请求通过 (${status})`);
} catch (e) {
  if (e.response) {
    const status = e.response.status;
    const passed = (status >= 200 && status < 500 && status !== 401 && status !== 403);
    results.push({ name: '有效签名通过', status: passed ? 'passed' : 'failed', expected: '200/400', actual: status });
    if (passed) passedCount++;
    console.log(`  ${passed ? '✅' : '❌'} 请求返回 ${status}`);
  } else {
    results.push({ name: '有效签名通过', status: 'failed', expected: '200/400', actual: e.message });
    console.log(`  ❌ 请求失败: ${e.message}`);
  }
}
```

#### 5.3 缺少签名头透传（约 L800-820）

应用相同的逻辑：只有 2xx/400 算 passed，401/403 算 failed。

### 3.3 修正 partial 状态计入 passedCount

#### 4.2 密码强度（约 L622-648）

```javascript
// 将 else 分支的 passedCount++ 移除：
} else {
  results.push({ name: '密码强度', status: 'partial', expected: '400', actual: 400 });
  // 不 increment passedCount
  console.log('  ⚠️ 返回400但不确定是密码强度');
}
```

#### 4.3 公钥格式（约 L650-676）

同上，移除 else 分支的 `passedCount++`

#### 4.4 缺少参数（约 L678-703）

同上，移除 else 分支的 `passedCount++`

### 3.4 修正 setup SM2 key 更新错误处理（约 L186-194）

```javascript
// 在 catch 块中设置标志：
let sm2KeySyncSuccess = false;
try {
  await axios.put(`${BASE_URL}/users/${testUser.userId}/update-sm2-key`,
    { sm2PublicKey: keyPair.publicKey },
    { headers: { Authorization: `Bearer ${testUser.token}` }, timeout: REQUEST_TIMEOUT }
  );
  sm2KeySyncSuccess = true;
  console.log('  ✅ 公钥同步成功');
} catch (e) {
  console.error('  ❌ 公钥同步失败', e.message);
  console.error('  ⚠️ SM2 签名相关测试可能不准确');
}
```

在模块 5 开始时检查此标志：
```javascript
if (!sm2KeySyncSuccess) {
  console.log('  ⚠️ SM2 公钥未同步，模块 5 结果可能不准确');
}
```

### 3.5 移除死代码

删除 `generateExpiredJwt`（约 L60-70）和 `generateShortLivedJwt`（约 L73-83）两个函数。

### 3.6 修正模块 7 注释

L997 注释改为：
```javascript
// 模块7：SM4 静默失败测试（5项，对应 Bug B3）
```

---

## 四、performance-test.js 改动

**文件**：`backend/test/performance-test.js`

### 4.1 模块 7 多轮统计 + 预热（P0）

**改动范围**：`module7CryptoComparisonBenchmark` 函数（约 L860-989）

**改动方案**：

1. 在函数开头添加辅助函数（如果文件中还没有）：

```javascript
function calcMean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function calcStddev(arr) {
  const m = calcMean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}
```

注意：文件中已有 `calcStats` 函数，检查是否可以复用。如果 `calcStats` 已返回 mean 和 stddev，则直接使用。

2. 将 7.1 SM3 vs SHA-256 改为：

```javascript
// 7.1 SM3 vs SHA-256 (1KB数据, 各10000次, 3轮)
console.log('\n  7.1 SM3 vs SHA-256 (1KB数据, 各10000次, 3轮)');
const { generateSM3Hash } = require('../utils/cryptoUtils');
const testData1KB_local = Buffer.alloc(1024, 'x').toString('utf8');

// 预热（JIT 编译，丢弃结果）
for (let i = 0; i < 1000; i++) generateSM3Hash(testData1KB_local);
for (let i = 0; i < 1000; i++) crypto.createHash('sha256').update(testData1KB_local).digest('hex');

const ROUNDS = 3;
const sm3Throughputs = [];
const sha256Throughputs = [];

for (let round = 0; round < ROUNDS; round++) {
  await collectGarbage();
  
  const sm3Start = performance.now();
  for (let i = 0; i < 10000; i++) generateSM3Hash(testData1KB_local);
  const sm3Time = performance.now() - sm3Start;
  sm3Throughputs.push((10000 * 1024 / 1024 / 1024) / (sm3Time / 1000));

  const sha256Start = performance.now();
  for (let i = 0; i < 10000; i++) crypto.createHash('sha256').update(testData1KB_local).digest('hex');
  const sha256Time = performance.now() - sha256Start;
  sha256Throughputs.push((10000 * 1024 / 1024 / 1024) / (sha256Time / 1000));
  
  console.log(`     轮次 ${round + 1}: SM3=${sm3Throughputs[round].toFixed(4)} GB/s, SHA-256=${sha256Throughputs[round].toFixed(4)} GB/s`);
}

const sm3Mean = calcMean(sm3Throughputs);
const sm3Std = calcStddev(sm3Throughputs);
const sha256Mean = calcMean(sha256Throughputs);
const sha256Std = calcStddev(sha256Throughputs);

results.sm3VsSha256 = {
  sm3: { mean: parseFloat(sm3Mean.toFixed(4)), stddev: parseFloat(sm3Std.toFixed(4)), unit: 'GB/s' },
  sha256: { mean: parseFloat(sha256Mean.toFixed(4)), stddev: parseFloat(sha256Std.toFixed(4)), unit: 'GB/s' },
  ratio: `${(sm3Mean / sha256Mean * 100).toFixed(2)}%`
};

console.log(`     SM3: ${sm3Mean.toFixed(4)} ± ${sm3Std.toFixed(4)} GB/s`);
console.log(`     SHA-256: ${sha256Mean.toFixed(4)} ± ${sha256Std.toFixed(4)} GB/s`);
console.log(`     SM3/SHA-256 比率: ${(sm3Mean / sha256Mean * 100).toFixed(2)}%`);
```

3. 对 7.2 SM4 vs AES-256-GCM 和 7.3 SM2 vs ECDSA P-256 应用相同的多轮模式（3 轮 + 预热 + 均值标准差）

### 4.2 移除死代码

删除 `module6LoanBorrowWithProof` 函数（约 L422-589）。这是约 170 行从未被调用的代码。

**注意**：删除后检查 `runBenchmark()` 函数中是否有引用此函数名的代码（应该没有）。

### 4.3 修正模块 5 硬编码用户 ID

在 `module1ApiStressTest` 函数中，登录成功后存储用户 ID：

```javascript
// 在 globalThis.__benchToken = loginRes.data.token; 之后添加：
globalThis.__benchUserId = loginRes.data.user?.id || loginRes.data.userId;
```

在 `module5UserInfoConcurrency` 函数中，替换硬编码：

```javascript
// 将：
const userId = '1777750216914';

// 改为：
const userId = globalThis.__benchUserId;
if (!userId) {
  console.log('  ⚠️ 未获取到用户ID，跳过此模块');
  return { status: 'skipped', reason: 'userId not available' };
}
```

### 4.4 统一 Promise.all → Promise.allSettled

找到以下两行并修改：

```javascript
// L789 (module5UserInfoConcurrency):
// 将：await Promise.all(promises);
// 改为：await Promise.allSettled(promises);

// L840 (module6SecurityChainOverhead):
// 将：await Promise.all(promises);
// 改为：await Promise.allSettled(promises);
```

### 4.5 模块 9.2 GC 检测改进

**问题**：`gcEvents` 变量存储的是 HTTP 请求延迟，不是 GC 事件。变量名误导。

**改动方案**：

1. 将 `gcEvents` 重命名为 `requestLatencies`（约 L1247）
2. 在文件顶部的 `require('perf_hooks')` 中添加 `PerformanceObserver`：

```javascript
// 当前：
const { performance } = require('perf_hooks');

// 改为：
const { performance, PerformanceObserver } = require('perf_hooks');
```

3. 在 9.2 测试开头添加真实 GC 事件监听：

```javascript
const realGcEvents = [];
let gcObserver;
try {
  gcObserver = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      realGcEvents.push({ type: entry.kind, duration: entry.duration, startTime: entry.startTime });
    }
  });
  gcObserver.observe({ entryTypes: ['gc'] });
  console.log('     ✅ GC 事件监听已启动');
} catch (e) {
  console.log('     ⚠️ GC 事件监听不可用:', e.message);
}
```

4. 在测试结束后断开监听器并报告：

```javascript
if (gcObserver) {
  gcObserver.disconnect();
}

// 在结果中同时报告请求延迟统计和真实 GC 事件
results.gcImpact = {
  requestLatencies: calcStats(requestLatencies),  // 重命名后的变量
  gcEventCount: realGcEvents.length,
  gcEvents: realGcEvents.slice(0, 10), // 只保留前 10 个
  durationMs: ...
};
```

### 4.6 修正模块 8.2 还款流程分解

在现有 2 步之后增加第 3 步——还款后状态验证：

```javascript
// 在 repaySubmission 之后添加：
const repayStep3Start = performance.now();
try {
  const updatedLoansRes = await axios.get(`${BASE_URL}/loan/user/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 10000
  });
  repaySteps.loanStatusCheck = (performance.now() - repayStep3Start).toFixed(2);
  console.log(`     贷款状态查询: ${repaySteps.loanStatusCheck}ms`);
} catch (e) {
  repaySteps.loanStatusCheck = (performance.now() - repayStep3Start).toFixed(2);
  console.log(`     ⚠️ 贷款状态查询失败: ${e.message}`);
}
```

更新 percentage 计算以包含第 3 步。

---

## 五、禁止项清单

以下行为**绝对禁止**：

1. **不允许删除任何测试用例** — 只能修改断言或标记 knownIssue
2. **不允许降低断言阈值** — 如 SM3 雪崩效应阈值 28 不能降为 20
3. **不允许使用 mock 数据替代真实调用** — 除 6.3 的 blockchain mock（已有 try/finally 保护）
4. **不允许硬编码密钥** — SM4 密钥必须从环境变量获取
5. **不允许添加 TODO 注释** — 所有代码必须是完成状态
6. **不允许改变现有用例的编号** — 1.1-1.11, 2.1-2.6 等编号保持不变
7. **不允许改变 JSON 报告格式** — 新增字段必须向后兼容
8. **不允许修改 circuits/credit.circom** — 电路修改需要重新 trusted setup，超出本轮范围
9. **不允许修改 sm-crypto 底层库** — B9（签名位翻转）是底层库行为，本轮不修

---

## 六、验收清单

执行完成后，逐项检查：

### 系统 Bug 修复验收
- [ ] `sm4Crypto.js`：篡改密文后 `decrypt` 抛异常而非返回原文
- [ ] `sm4Crypto.js`：`decryptFields` 单字段解密失败不影响其他字段
- [ ] `securityChain.js`：黑名单 Token 返回 401 而非挂起
- [ ] `credit.js`：信用分 clamp 到 850 而非 900
- [ ] `cryptoUtils.js`：`generateSaltedSM3Hash` 使用 `crypto.randomBytes`

### crypto.test.js 验收
- [ ] 1.9 标记为 knownIssue
- [ ] 1.10 标记为 knownIssue (bugId: B9)
- [ ] 3.8 修正测试逻辑（不验证新密钥解密）
- [ ] 3.9 标记为 knownIssue (bugId: B3)
- [ ] 5.6 标记为 knownIssue (bugId: B10)
- [ ] 5.7 actualBehavior 更新记录 B2 已修复
- [ ] 7.4 修正断言兼容异常行为
- [ ] SM4 备用硬编码密钥改为环境变量缺失时 skip
- [ ] 5.4 弱断言增强
- [ ] 5.8 增加 verifyProof 验证
- [ ] 6.3 猴子补丁改为 try/finally
- [ ] 4.7 备份码复用行为记录

### security-fault-tolerance-test.js 验收
- [ ] 所有 HTTP 请求有 timeout: REQUEST_TIMEOUT
- [ ] 5.1 断言收紧（401/403 算 failed）
- [ ] 5.3 断言收紧（401/403 算 failed）
- [ ] 4.2/4.3/4.4 partial 不计入 passedCount
- [ ] setup SM2 key 更新有错误标志
- [ ] 移除 generateExpiredJwt/generateShortLivedJwt 死代码
- [ ] 模块 7 注释修正为"5项"

### performance-test.js 验收
- [ ] 模块 7 输出均值±标准差（3 轮）
- [ ] 模块 7 有预热迭代
- [ ] 移除 module6LoanBorrowWithProof 死代码
- [ ] 模块 5 用户 ID 运行时获取
- [ ] L789/L840 改为 Promise.allSettled
- [ ] 模块 9.2 使用 PerformanceObserver 监听 GC
- [ ] 模块 8.2 增加第 3 步验证

### 运行验证
- [ ] `node backend/test/crypto.test.js` 运行后 0 个非 knownIssue 失败
- [ ] 控制台输出格式与现有风格一致
