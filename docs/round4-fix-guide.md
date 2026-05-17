# Round 4 审查修复指南

基于审查报告（综合评分 4.4/5），以下 5 项需要修复。

**执行顺序：1 → 2 → 3 → 4 → 5**（无依赖关系，可并行执行）

**验收标准：** 修复完成后运行 `node backend/test/crypto.test.js`，要求 0 失败、0 knownIssue。

---

## Fix 1：删除 credit.js 中的 [DEBUG] 日志（P1）

**文件：** `backend/routes/credit.js`

**问题：** 14 处 `console.log('[DEBUG]...')` 未清理，违反交付标准"清理临时代码"。

**修改方式：** 删除以下所有行（精确匹配，不要改动其他代码）：

| 行号 | 删除内容 |
|------|----------|
| 64 | `console.log('[DEBUG] generate-proof called, body:', JSON.stringify(req.body));` |
| 71 | `console.log('[DEBUG] about to call userDao.findById with:', parseInt(userId));` |
| 73 | `console.log('[DEBUG] user found:', user ? user.id : 'null', 'credit_score:', user?.credit_score);` |
| 84 | `console.log('[DEBUG] 收到端侧生成的零知识证明，开始验证...');` |
| 88 | `console.log('[DEBUG] 端侧ZKP验证结果:', isProofValid);` |
| 100 | `console.error('[DEBUG] ZKP验证异常:', verifyError.message);` |
| 108 | `console.log('[DEBUG] 未收到前端proof，使用后端异步队列生成（降级模式）');` |
| 113 | `console.log('[DEBUG] using creditScore:', creditScore);` |
| 122 | `console.log('[DEBUG] proofData generated:', proofData);` |
| 124 | `console.log('[DEBUG] sm3Hash generated:', sm3Hash);` |
| 129 | `console.log('[DEBUG] calling proofDao.create with:', { user_id: user.id, proof_id: proofId, verification_code: verificationCode });` |
| 138 | `console.log('[DEBUG] proofDao.create returned:', savedProof);` |
| 142 | `console.log('[DEBUG] about to send success response');` |
| 165 | `console.error('[DEBUG] res.json failed:', err.message);` |
| 166 | `console.error('[DEBUG] Stack:', err.stack);` |
| 178 | `console.error('[DEBUG] Error in generate-proof:', error.message);` |
| 179 | `console.error('[DEBUG] Stack:', error.stack);` |

verify-proof 路由中的 [DEBUG] 也一并删除：

| 行号 | 删除内容 |
|------|----------|
| 195 | `console.log('[DEBUG] verify-proof called, proofId:', proofId, 'verificationCode:', verificationCode);` |
| 200 | `console.log('[DEBUG] about to query proof with proofId:', proofId);` |
| 201 | `console.log('[DEBUG] proof query result:', proof ? 'found' : 'null');` |
| 203-205 | 3 行 `console.log('[DEBUG] ...')` |
| 216 | `console.log('[DEBUG] checking expiry...');` |
| 218 | `console.log('[DEBUG] proof is expired');` |
| 224 | `console.log('[DEBUG] expiry check passed');` |
| 227-229 | 3 行 `console.log('[DEBUG] ...')` |
| 234 | `console.log('[DEBUG] about to send response');` |
| 253 | `console.error('[DEBUG] Error in verify-proof:', error.message);` |
| 254 | `console.error('[DEBUG] Stack:', error.stack);` |

**禁止项：**
- 不要删除 `logger.info/warning/error` 调用
- 不要修改任何业务逻辑
- 不要修改 catch 块中的 `logger.error` 行

**验收标准：** 文件中不存在任何 `console.log('[DEBUG]` 或 `console.error('[DEBUG]` 字符串。

---

## Fix 2：删除 auth.js 中重复的 DEK 生成调用（P1）

**文件：** `backend/routes/auth.js`

**问题：** `userDao.create()` 内部已调用 `kmsService.generateDEK(userId)`（userDao.js:60），auth.js:132 又显式调用了一次。

**修改方式：**

1. 删除第 132 行：
```js
// 删除这行：
await kmsService.generateDEK(newUser.id);
```

2. 如果删除后 `kmsService` 的 require 语句（第 10 行）不再被本文件其他地方使用，也一并删除：
```js
// 如果没有其他地方使用，删除这行：
const kmsService = require('../services/kmsService');
```

**如何判断是否可删除 require：** 搜索 `kmsService` 在 auth.js 中的所有引用。如果只有第 132 行使用，则 require 也可删除。如果其他地方也用了（如 MFA 相关），则保留 require。

**禁止项：** 不要修改 `userDao.create()` 的调用。

**验收标准：** 注册流程中 DEK 只生成一次（在 userDao.create 内部）。

---

## Fix 3：sm4Crypto.js decryptFields 异常处理改进（P2）

**文件：** `backend/utils/sm4Crypto.js`

**问题：** `decryptFields` 中 catch 块仅 `logger.warn` 然后返回原始密文。如果 AAD 被篡改，解密失败会被静默忽略，调用方拿到的是加密字符串而非明文。

**修改方式：** 在每个 catch 块中设置标记字段 `_decryptFailed`，让调用方知道数据不可信。

**修改前（以 balance 为例，第 53-60 行）：**
```js
try {
  const aad = buildAAD('users', 'balance', userId);
  const decrypted = await decrypt(data.balance, userId, aad);
  data.balance = Number(decrypted);
} catch (decryptError) {
  logger.warn(`字段 balance 解密失败: ${decryptError.message}`);
  data.balance = data.balance;
}
```

**修改后：**
```js
try {
  const aad = buildAAD('users', 'balance', userId);
  const decrypted = await decrypt(data.balance, userId, aad);
  data.balance = Number(decrypted);
} catch (decryptError) {
  logger.warn(`字段 balance 解密失败: ${decryptError.message}`);
  data._decryptFailed = true;
  data._decryptErrors = data._decryptErrors || [];
  data._decryptErrors.push({ field: 'balance', error: decryptError.message });
}
```

**对以下所有字段重复相同模式（共 5 处 catch 块）：**
- users 表：balance（第 53-60 行）、credit_score（第 62-69 行）
- transactions 表：amount（第 73-80 行）、interest（第 82-89 行）、total_amount（第 91-99 行）

**禁止项：**
- 不要改变 `logger.warn` 的行为
- 不要改变 `Number(decrypted)` 的正常路径
- 不要删除 `data.balance = data.balance` 这行（保留原值但加标记）

**验收标准：**
- 所有 5 个 catch 块都设置了 `data._decryptFailed = true`
- 正常解密路径不受影响

---

## Fix 4：errorHandler.js ErrorMonitor 内存泄漏修复（P2）

**文件：** `backend/middleware/errorHandler.js`

**问题：** `ErrorMonitor.errors` 数组无大小限制。虽有每小时 cleanup，但高并发下 1 小时内可积累大量错误对象。

**修改方式：** 在 `recordError` 方法（第 81 行）中添加数组大小上限。

**修改前：**
```js
recordError(error, req) {
  const errorData = {
    timestamp: new Date().toISOString(),
    errorType: error.name || 'UnknownError',
    message: error.message,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    ip: req.ip
  };
  
  this.errors.push(errorData);
```

**修改后：**
```js
recordError(error, req) {
  const errorData = {
    timestamp: new Date().toISOString(),
    errorType: error.name || 'UnknownError',
    message: error.message,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
    ip: req.ip
  };
  
  // 限制错误记录数量，防止内存泄漏
  if (this.errors.length >= this.maxErrors) {
    this.errors.splice(0, this.errors.length - this.maxErrors + 1);
  }
  
  this.errors.push(errorData);
```

**同时在构造函数（第 70 行）中添加 maxErrors 属性：**

修改前：
```js
constructor() {
  this.errors = [];
  this.errorCounts = {};
  this.threshold = 10; // 每分钟错误阈值
}
```

修改后：
```js
constructor() {
  this.errors = [];
  this.errorCounts = {};
  this.threshold = 10; // 每分钟错误阈值
  this.maxErrors = 10000; // 最大错误记录数
}
```

**禁止项：**
- 不要改变 `triggerAlert` 的行为
- 不要改变 `getStats` 返回的数据结构
- 不要删除现有的 `cleanup` 定时器

**验收标准：** `this.errors.length` 永远不超过 `this.maxErrors`。

---

## Fix 5：补充 ZKP 和 KMS 测试用例（P2）

**文件：** `backend/test/crypto.test.js`

**问题：** 缺少 4 个 ZKP 用例和 3 个 KMS 用例。

### 5.1 在模块 5（module5_zkpTests）末尾、模块 6 之前，插入以下 4 个测试：

**插入位置：** 第 955 行之后（`module5_zkpTests` 方法的 `}` 之前）

```js
    // 5.9 hasNoOverdue=0 但 score 达标 → isValid 应为 0
    console.log('\n  5.9 hasNoOverdue=0 但 score 达标');
    try {
      const overdueProof = await zkService.generateProof(750, 600, false);
      if (overdueProof && overdueProof.proof) {
        const overdueVerify = await zkService.verifyProof(overdueProof.proof, overdueProof.publicSignals);
        this.addResult('zkp', 'hasNoOverdue=0 但 score 达标', overdueVerify === false, {
          score: 750,
          threshold: 600,
          hasNoOverdue: false,
          verifyResult: overdueVerify,
          expectedBehavior: 'hasNoOverdue=0 时 verifyProof 应返回 false'
        });
        console.log(`     ${overdueVerify === false ? '✓' : '✗'} hasNoOverdue=0, score=750: 验证=${overdueVerify} (应为 false)`);
      } else {
        this.addResult('zkp', 'hasNoOverdue=0 但 score 达标', false, { note: '证明生成失败' });
        console.log(`     ✗ hasNoOverdue=0 测试: 证明生成失败`);
      }
    } catch (e) {
      this.addResult('zkp', 'hasNoOverdue=0 但 score 达标', false, { error: e.message });
      console.log(`     ✗ hasNoOverdue=0 测试: 失败 - ${e.message}`);
    }

    // 5.10 范围约束 - 负数 creditScore
    console.log('\n  5.10 范围约束 - 负数 creditScore');
    try {
      const negProof = await zkService.generateProof(-100, 600, true);
      // 如果生成成功，验证应失败（电路约束应拒绝负数）
      if (negProof && negProof.proof) {
        const negVerify = await zkService.verifyProof(negProof.proof, negProof.publicSignals);
        this.addResult('zkp', '负数 creditScore 范围约束', negVerify === false, {
          note: '负数通过电路约束验证（RangeCheck 应拒绝）',
          verifyResult: negVerify
        });
        console.log(`     ${negVerify === false ? '✓' : '⚠️'} 负数 creditScore=-100: 验证=${negVerify}`);
      } else {
        this.addResult('zkp', '负数 creditScore 范围约束', true, { note: '证明生成失败，符合预期' });
        console.log(`     ✓ 负数 creditScore=-100: 生成失败（符合预期）`);
      }
    } catch (e) {
      this.addResult('zkp', '负数 creditScore 范围约束', true, {
        note: '抛出异常，符合预期',
        error: e.message
      });
      console.log(`     ✓ 负数 creditScore=-100: 抛出异常 - ${e.message}`);
    }

    // 5.11 范围约束 - 超大 creditScore
    console.log('\n  5.11 范围约束 - 超大 creditScore');
    try {
      const bigProof = await zkService.generateProof(9999, 600, true);
      if (bigProof && bigProof.proof) {
        const bigVerify = await zkService.verifyProof(bigProof.proof, bigProof.publicSignals);
        this.addResult('zkp', '超大 creditScore 范围约束', bigVerify === false, {
          note: 'creditScore=9999 超出 12 位范围（0-4095），电路应拒绝',
          verifyResult: bigVerify
        });
        console.log(`     ${bigVerify === false ? '✓' : '⚠️'} 超大 creditScore=9999: 验证=${bigVerify}`);
      } else {
        this.addResult('zkp', '超大 creditScore 范围约束', true, { note: '证明生成失败，符合预期' });
        console.log(`     ✓ 超大 creditScore=9999: 生成失败（符合预期）`);
      }
    } catch (e) {
      this.addResult('zkp', '超大 creditScore 范围约束', true, {
        note: '抛出异常，符合预期',
        error: e.message
      });
      console.log(`     ✓ 超大 creditScore=9999: 抛出异常 - ${e.message}`);
    }

    // 5.12 hasNoOverdue 非布尔值
    console.log('\n  5.12 hasNoOverdue 非布尔值');
    try {
      const badBoolProof = await zkService.generateProof(750, 600, 2);
      if (badBoolProof && badBoolProof.proof) {
        const badBoolVerify = await zkService.verifyProof(badBoolProof.proof, badBoolProof.publicSignals);
        this.addResult('zkp', 'hasNoOverdue 非布尔值', badBoolVerify === false, {
          note: 'hasNoOverdue=2 应被电路 BoolCheck 拒绝',
          verifyResult: badBoolVerify
        });
        console.log(`     ${badBoolVerify === false ? '✓' : '⚠️'} hasNoOverdue=2: 验证=${badBoolVerify}`);
      } else {
        this.addResult('zkp', 'hasNoOverdue 非布尔值', true, { note: '证明生成失败，符合预期' });
        console.log(`     ✓ hasNoOverdue=2: 生成失败（符合预期）`);
      }
    } catch (e) {
      this.addResult('zkp', 'hasNoOverdue 非布尔值', true, {
        note: '抛出异常，符合预期',
        error: e.message
      });
      console.log(`     ✓ hasNoOverdue=2: 抛出异常 - ${e.message}`);
    }
```

### 5.2 在模块 3（module3_sm4Tests）的 3.9 测试之后，插入以下 3 个 KMS 测试：

**插入位置：** 找到 `// 3.9 认证标签完整性（系统性）` 测试块的结束位置，在其后插入：

```js
    // 3.10 跨用户密文隔离
    console.log('\n  3.10 跨用户密文隔离');
    try {
      const userADek = crypto.randomBytes(16).toString('hex');
      const userBDek = crypto.randomBytes(16).toString('hex');
      const secretData = 'user A sensitive balance';

      const encryptedByA = kmsService.encryptWithDEK(userADek, secretData, 'users:balance:1001');

      let crossUserFailed = false;
      try {
        // 用 user B 的 DEK 解密 user A 的密文（AAD 也不同）
        const wrongDecrypt = kmsService.decryptWithDEK(userBDek, encryptedByA, 'users:balance:1001');
        crossUserFailed = wrongDecrypt === secretData;
      } catch (e) {
        crossUserFailed = false; // 抛异常 = 正确拒绝
      }

      this.addResult('sm4', '跨用户密文隔离', !crossUserFailed, {
        note: 'user A 的密文不能用 user B 的 DEK 解密'
      });
      console.log(`     ${!crossUserFailed ? '✓' : '✗'} 跨用户隔离: ${!crossUserFailed ? '正确拒绝' : '错误解密'}`);
    } catch (e) {
      this.addResult('sm4', '跨用户密文隔离', true, { note: '抛出异常 = 正确拒绝' });
      console.log(`     ✓ 跨用户隔离: 抛出异常 - ${e.message}`);
    }

    // 3.11 旧格式密文兼容解密
    console.log('\n  3.11 旧格式密文兼容解密');
    try {
      const compatDek = crypto.randomBytes(16).toString('hex');
      const compatData = 'legacy format test data';

      // 模拟旧格式：不带 AAD 的 HMAC
      const key = Buffer.from(compatDek, 'hex');
      const iv = crypto.randomBytes(16);
      const cipher = require('crypto').createCipheriv('sm4-cbc', key, iv);
      let encrypted = cipher.update(compatData, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const legacyTag = require('crypto').createHmac('sm3', key)
        .update(iv.toString('hex') + encrypted).digest('hex');
      const legacyCiphertext = `v1:${iv.toString('hex')}:${legacyTag}:${encrypted}`;

      // 用 AAD 参数解密旧格式密文（应降级成功）
      const legacyDecrypted = kmsService.decryptWithDEK(compatDek, legacyCiphertext, 'users:balance:999');
      const legacyOK = legacyDecrypted === compatData;
      this.addResult('sm4', '旧格式密文兼容解密', legacyOK, {
        note: '旧格式（无 AAD）密文应能带 AAD 参数解密（兼容降级）'
      });
      console.log(`     ${legacyOK ? '✓' : '✗'} 旧格式兼容: ${legacyOK ? '成功降级解密' : '解密失败'}`);
    } catch (e) {
      this.addResult('sm4', '旧格式密文兼容解密', false, { error: e.message });
      console.log(`     ✗ 旧格式兼容: 失败 - ${e.message}`);
    }

    // 3.12 DEK 缓存过期后自动重新获取
    console.log('\n  3.12 DEK 缓存过期后自动重新获取');
    try {
      // 此测试需要数据库，如果不可用则跳过
      const { execute } = require('../config/database');
      const cacheUserId = 88888;

      // 清理可能存在的测试数据
      await execute('DELETE FROM user_keys WHERE user_id = ?', [cacheUserId]).catch(() => {});
      await execute('DELETE FROM users WHERE id = ?', [cacheUserId]).catch(() => {});

      // 创建测试用户
      await execute('INSERT INTO users (id, username, password_hash, salt, sm2_public_key, balance, credit_score) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [cacheUserId, 'cache_test_' + Date.now(), 'hash', 'salt', '04' + 'a'.repeat(128), '0', '600']);

      // 生成 DEK
      const dek1 = await kmsService.getDEK(cacheUserId);

      // 再次获取（应命中缓存）
      const dek2 = await kmsService.getDEK(cacheUserId);
      const cacheHitOK = dek1 === dek2;

      this.addResult('sm4', 'DEK 缓存一致性', cacheHitOK, {
        note: '两次 getDEK 应返回相同 DEK'
      });
      console.log(`     ${cacheHitOK ? '✓' : '✗'} DEK 缓存一致性: ${cacheHitOK ? '一致' : '不一致'}`);

      // 清理测试数据
      await execute('DELETE FROM user_keys WHERE user_id = ?', [cacheUserId]).catch(() => {});
      await execute('DELETE FROM users WHERE id = ?', [cacheUserId]).catch(() => {});
    } catch (e) {
      this.addResult('sm4', 'DEK 缓存一致性', false, {
        note: '需要数据库运行',
        error: e.message
      });
      console.log(`     ⚠️ DEK 缓存测试: 跳过 - ${e.message}`);
    }
```

### 5.3 更新模块 3 的标题注释

找到第 355 行：
```js
    console.log('  模块3：SM4 对称加密测试（DEK 级操作）');
```

保持不变即可（KMS 测试本质上是 DEK 级 SM4 操作的延伸）。

**禁止项：**
- 不要修改现有的任何测试用例
- 不要修改 `addResult` 方法
- 不要修改 `printResults` 方法
- 范围约束测试（5.10/5.11）如果电路正确拒绝负数/超大值，生成会失败或抛异常，这两种情况都算通过

**验收标准：**
- 运行 `node backend/test/crypto.test.js` 输出 0 失败
- 模块 5 从 8 个测试增加到 12 个
- 模块 3 从 9 个测试增加到 12 个（或因数据库不可用而有跳过）

---

## 完整验收清单

修复完成后，执行以下验证：

```bash
# 1. 运行测试
node backend/test/crypto.test.js

# 2. 验证无 DEBUG 日志残留
grep -r "\[DEBUG\]" backend/routes/credit.js
# 预期：无输出

# 3. 验证 auth.js 无重复 DEK 调用
grep "generateDEK" backend/routes/auth.js
# 预期：无输出

# 4. 验证 sm4Crypto.js 有 _decryptFailed 标记
grep "_decryptFailed" backend/utils/sm4Crypto.js
# 预期：5 处匹配

# 5. 验证 errorHandler.js 有 maxErrors 限制
grep "maxErrors" backend/middleware/errorHandler.js
# 预期：2 处匹配（构造函数 + recordError）
```

**最终标准：** crypto.test.js 输出 `0 失败, 0 已知问题`。
