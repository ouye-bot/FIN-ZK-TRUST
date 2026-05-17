# FinZkTrust 第三轮修复补充 — 二次修复指令

> 第一轮修复（13 项）已完成。审查发现 3 个深层问题需要二次修复。
> 执行前通读全文，有任何不确定之处先确认，不动手。

---

## 执行顺序

1. `backend/services/zkService.js` — verifyProof 未检查 isValid 输出（Critical）
2. `backend/test/crypto.test.js` — 空消息签名测试预期错误（Medium）
3. `backend/test/crypto.test.js` — B9 位翻转 knownIssue 无条件为 true（Medium）
4. `backend/utils/cryptoUtils.js` — setInterval 阻止进程退出（Low）

---

## 修复 A：verifyProof 未检查 isValid 输出（Critical）

### 问题

`verifyProof` 调用 `snarkjs.groth16.verify()` 后直接返回结果。但 `snarkjs.groth16.verify` 只验证证明是否密码学有效，**不管 publicSignals 的值**。当 score=500, threshold=600 时，电路输出 `isValid=0`（publicSignals[0]='0'），证明本身是有效的，所以 `verifyProof` 返回 true。

测试期望：score < threshold 时 verifyProof 返回 false。
实际行为：verifyProof 返回 true（证明有效，但 isValid=0）。

### 改动要求

**文件**：`backend/services/zkService.js`

找到 `verificationResult` 返回处（约 L163-200），在 `return verificationResult` 之前添加 publicSignals 检查：

```javascript
// 当前代码（约 L163 附近）：
logger.info('零知识证明验证结果:', { verificationResult });

// 如果验证成功，异步将结果记录到区块链（不阻塞）
if (verificationResult) {
  // ... 区块链记录逻辑 ...
}

return verificationResult;

// 改为：
logger.info('零知识证明验证结果:', { verificationResult });

// 检查 isValid 输出信号
if (verificationResult && publicSignals && publicSignals.length > 0 && publicSignals[0] !== '1') {
  logger.info('ZKP 证明有效但 isValid=0，业务验证不通过', { publicSignals });
  return false;
}

// 如果验证成功，异步将结果记录到区块链（不阻塞）
if (verificationResult) {
  // ... 区块链记录逻辑（保持不变）...
}

return verificationResult;
```

### 禁止项

- 不要改变 `snarkjs.groth16.verify` 的调用方式
- 不要删除区块链记录逻辑
- 不要改变 proof 格式化逻辑

### 验收标准

- `generateProof(500, 600)` → `verifyProof` 返回 false（证明有效但 isValid=0）
- `generateProof(750, 600)` → `verifyProof` 返回 true（证明有效且 isValid=1）
- `generateProof(600, 600)` → `verifyProof` 返回 true（边界值）
- `crypto.test.js` 中 B10（不达标 score<threshold）从 knownIssue 变为 passed

### 为什么这是正确修复

ZKP 的语义是：`verifyProof` 告诉调用方"这个证明可信且业务通过"。如果证明有效但 `isValid=0`（分数不达标），调用方应该得到 false，否则业务逻辑会错误地放行不达标用户。

---

## 修复 B：空消息签名测试预期错误（Medium）

### 问题

Fix 2 在 `signWithSM2` 开头添加了 `if (!message || typeof message !== 'string')` 校验。空字符串 `''` 在 JavaScript 中是 falsy，所以 `signWithSM2('', privateKey)` 现在抛出"签名消息不能为空"。

这是**正确行为**——空消息不应被签名。但 `crypto.test.js` 中"空消息签名"用例的预期是签名成功。

### 改动要求

**文件**：`backend/test/crypto.test.js`

找到"空消息签名"测试用例（约在 SM2 测试模块中），将预期从"签名成功"改为"抛出异常"：

```javascript
// 当前代码（大致位置，需根据实际代码确认）：
// 测试 signWithSM2('', privateKey) 应该返回签名
const emptySig = signWithSM2('', privateKey);
this.addResult('sm2', '空消息签名', !!emptySig, { ... });

// 改为：
try {
  const emptySig = signWithSM2('', privateKey);
  // 如果没抛异常，说明校验没生效
  this.addResult('sm2', '空消息签名', false, {
    expectedBehavior: '空消息应抛出异常',
    actualBehavior: '未抛异常，返回了签名'
  });
} catch (e) {
  this.addResult('sm2', '空消息签名', e.message.includes('签名消息不能为空'), {
    expectedBehavior: '抛出"签名消息不能为空"异常',
    actualBehavior: e.message
  });
}
```

### 禁止项

- 不要改变其他 SM2 测试用例
- 不要改变 signWithSM2 的输入校验逻辑（那是正确的）

### 验收标准

- "空消息签名"测试变为 passed
- SM2 模块 10 passed, 0 failed

---

## 修复 B2：B9 位翻转 knownIssue 无条件为 true（Medium）

### 问题

Fix 1 修复了 SM2 验签缓存 key（现在包含 signature），位翻转检测已正确返回 false（验签失败）。但 `crypto.test.js` L211 的 `addResult` 中 `knownIssue: true` 是硬编码的，不依赖修复是否生效。

当前结果：`passed: true, knownIssue: true` — 测试通过了但仍标记为已知问题，导致报告中 SM2 模块显示"1 已知问题"。

### 改动要求

**文件**：`backend/test/crypto.test.js`

找到签名位翻转测试（约 L207-218）：

```javascript
// 当前代码（约 L211）：
this.addResult('sm2', '签名位翻转检测', !flipVerify, {
  knownIssue: true,
  expectedBehavior: '翻转签名位后验签应返回 false',
  actualBehavior: `验签返回 ${flipVerify}`,
  bugId: 'B9',
  bugLocation: 'cryptoUtils.js:verifySM2Signature'
});

// 改为（knownIssue 根据实际结果动态设置）：
this.addResult('sm2', '签名位翻转检测', !flipVerify, {
  knownIssue: !!flipVerify,
  expectedBehavior: '翻转签名位后验签应返回 false',
  actualBehavior: `验签返回 ${flipVerify}`,
  bugId: 'B9',
  bugLocation: 'cryptoUtils.js:verifySM2Signature'
});
```

> `knownIssue: !!flipVerify` — 当 flipVerify 为 false（正确行为）时 knownIssue 为 false；当 flipVerify 为 true（Bug 仍存在）时 knownIssue 为 true。

### 验收标准

- 位翻转测试：`passed: true, knownIssue: false`
- SM2 模块 0 knownIssues

---

## 修复 C：setInterval 阻止进程退出（Low）

### 问题

`backend/utils/cryptoUtils.js` L111-114 有一个 `setInterval` 每 60 秒记录缓存命中率。这个定时器会保持 Node.js 事件循环活跃，导致所有运行此模块的脚本（包括测试脚本）在完成后不会自动退出。

### 改动要求

**文件**：`backend/utils/cryptoUtils.js`

找到 `setInterval` 代码（约 L111-114）：

```javascript
// 当前代码：
setInterval(() => {
  const hitRate = signatureCache.getHitRate();
  logger.info('Signature cache hit rate:', { hitRate: `${hitRate.toFixed(2)}%`, size: signatureCache.size, totalCount: signatureCache.totalCount, hitCount: signatureCache.hitCount });
}, 60000);

// 改为（使用 unref 使其不阻止进程退出）：
const cacheLogInterval = setInterval(() => {
  const hitRate = signatureCache.getHitRate();
  logger.info('Signature cache hit rate:', { hitRate: `${hitRate.toFixed(2)}%`, size: signatureCache.size, totalCount: signatureCache.totalCount, hitCount: signatureCache.hitCount });
}, 60000);
cacheLogInterval.unref();
```

> `unref()` 告诉 Node.js：如果这个定时器是事件循环中唯一活跃的东西，就让进程退出。对于 Express 服务器，事件循环有 HTTP 监听器保持活跃，所以定时器继续正常工作。对于测试脚本，完成后进程可以正常退出。

### 禁止项

- 不要删除 setInterval 本身（缓存监控对生产环境有用）
- 不要改变定时器的间隔时间

### 验收标准

- 三个测试脚本运行完成后自动退出，不再挂起
- Express 服务器运行时定时器仍然正常工作

---

## 最终验证

```bash
# 1. 密码技术测试
node backend/test/crypto.test.js
# 预期：52/52 passed, 0 failed, 0 knownIssues

# 2. 安全与容错测试
node backend/test/security-fault-tolerance-test.js
# 预期：全部 passed，无回归

# 3. 性能基准测试
node backend/test/performance-test.js
# 预期：exit code 0，所有模块正常运行

# 所有脚本运行完成后应自动退出
```

### 预期最终结果

| 脚本 | 第一轮修复后 | 二次修复后 |
|------|------------|-----------|
| crypto.test.js | 50/52（1 失败 + 1 knownIssue） | 52/52 passed |
| security-fault-tolerance-test.js | 全部 passed | 全部 passed（无变化） |
| performance-test.js | exit code 0 | exit code 0 + 自动退出 |
