# FinZkTrust 第三轮缺陷修复 — 执行指令

> 本轮目标：修复测试运行发现的 4 个 knownIssue（生产代码缺陷）和 2 个测试脚本 bug。
> 执行前通读全文，有任何不确定之处先确认，不动手。

---

## 执行顺序（严格按此顺序）

1. `backend/utils/cryptoUtils.js` — SM2 缓存 + 输入校验（修复 1-5）
2. `backend/services/mfaService.js` — 备份码复用（修复 6）
3. `backend/routes/mfa.js` — 配合修复 6 同步修改（修复 6b）
4. `backend/services/zkService.js` — ZKP 后门 + 哈希问题（修复 7-8）
5. `circuits/credit.circom` — 电路约束修复（修复 9）
6. `circuits/compile.js` — 重编译电路（修复 9b）
7. `backend/test/performance-test.js` — 测试脚本 bug（修复 10-11）
8. 运行验证

---

## 一、系统级 Bug 修复

### 修复 1：SM2 验签缓存 key 不含 signature（B9，Critical）

**文件**：`backend/utils/cryptoUtils.js`

**问题**：`verifySM2Signature` 的缓存 key 为 `` `sm2_${message}_${publicKey}` ``，不包含 `signature`。一旦 `(message, publicKey)` 被验证过，后续任何签名（包括篡改过的）都会返回缓存结果。攻击者可先触发一次合法验签，再用伪造签名通过缓存验证。

**改动要求**：

找到 `verifySM2Signature` 函数（约 L148-166），将缓存 key 改为包含 signature：

```javascript
// 当前代码（L149）：
const cacheKey = `sm2_${message}_${publicKey}`;

// 改为：
const cacheKey = `sm2_verify::${message}::${signature}::${publicKey}`;
```

同时将分隔符从 `_` 改为 `::`（避免 message 中含下划线导致 key 碰撞）。

**禁止项**：
- 不要改变函数签名（message, signature, publicKey）
- 不要改变 `sm2.doVerifySignature` 的调用参数
- 不要删除 try/catch 错误处理

**验收标准**：
- 对同一 message 和 publicKey，使用不同 signature 调用两次，第二次不返回第一次的缓存结果
- `crypto.test.js` 中 B9（签名位翻转检测）从 knownIssue 变为 passed

---

### 修复 2：signWithSM2 无输入校验（B-SM2-INPUT，High）

**文件**：`backend/utils/cryptoUtils.js`

**问题**：`signWithSM2` 对 `message` 和 `privateKey` 无任何校验。传入无效私钥时 `sm2.doSignature` 不抛异常，静默返回垃圾签名。

**改动要求**：

**Step 2a**：在文件顶部（`signatureCache` 定义之后，约 L12 之后）添加校验辅助函数：

```javascript
// SM2 密钥格式校验
const SM2_PRIVATE_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const SM2_PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{130}$/;

function validateSM2PrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') {
    throw new Error('SM2 私钥不能为空');
  }
  if (!SM2_PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error('SM2 私钥格式无效：必须为64位十六进制字符串');
  }
}

function validateSM2PublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error('SM2 公钥不能为空');
  }
  if (!SM2_PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new Error('SM2 公钥格式无效：必须为130位十六进制字符串');
  }
}
```

**Step 2b**：在 `signWithSM2` 函数开头（约 L211 之前）添加校验：

```javascript
exports.signWithSM2 = (message, privateKey) => {
  // 新增：输入校验
  if (!message || typeof message !== 'string') {
    throw new Error('签名消息不能为空');
  }
  validateSM2PrivateKey(privateKey);

  // ... 其余代码不变
};
```

**禁止项**：
- 不要改变 `sm2.doSignature` 的调用方式
- 不要改变返回值格式
- 不要删除已有的 try/catch

**验收标准**：
- `signWithSM2('test', 'invalid_key')` 抛出包含"私钥格式无效"的异常
- `signWithSM2('test', null)` 抛出异常
- 正常签名流程不受影响
- `crypto.test.js` 中 B-SM2-INPUT 从 knownIssue 变为 passed

---

### 修复 3：verifySM2Signature 无输入校验（High）

**文件**：`backend/utils/cryptoUtils.js`

**问题**：`verifySM2Signature` 对 `message`、`signature`、`publicKey` 均无校验。null/undefined 输入会导致缓存被永久污染（缓存 `false`）。

**改动要求**：

在 `verifySM2Signature` 函数开头（约 L149 之前）添加校验：

```javascript
exports.verifySM2Signature = (message, signature, publicKey) => {
  // 新增：输入校验
  if (!message || typeof message !== 'string') {
    throw new Error('验签消息不能为空');
  }
  if (!signature || typeof signature !== 'string') {
    throw new Error('签名不能为空');
  }
  validateSM2PublicKey(publicKey);

  // ... 其余代码（含修复 1 的缓存 key 变更）
};
```

**验收标准**：
- `verifySM2Signature(null, 'sig', 'key')` 抛出异常
- `verifySM2Signature('msg', '', 'key')` 抛出异常
- 正常验签流程不受影响

---

### 修复 4：敏感数据明文日志（Medium）

**文件**：`backend/utils/cryptoUtils.js`

**问题**：`verifySM2Signature` 的 logger.info（约 L158）和 logger.error（约 L162）输出完整的 message、signature、publicKey，存在信息泄露风险。

**改动要求**：

```javascript
// 当前代码（约 L158）：
logger.info('SM2 signature verification result:', { result, message, signature, publicKey });

// 改为：
logger.info('SM2 signature verification completed', { result });

// 当前代码（约 L162）：
logger.error('SM2 signature verification failed:', { error: error.message, message, signature, publicKey });

// 改为：
logger.error('SM2 signature verification failed:', { error: error.message });
```

**禁止项**：
- 不要删除 logger 调用本身，只去掉敏感参数
- 不要改变 `signWithSM2` 中的 logger（它只输出成功信息，无敏感数据）

**验收标准**：
- 日志中不再出现完整的 message、signature、publicKey

---

### 修复 5：signWithSM2 缓存 key 含私钥明文（Medium）

**文件**：`backend/utils/cryptoUtils.js`

**问题**：`signWithSM2` 的缓存 key（约 L211）包含原始 privateKey，私钥会一直驻留在内存缓存的 key 中。

**改动要求**：

```javascript
// 当前代码（约 L211）：
const cacheKey = `sm2_sign_${message}_${privateKey}`;

// 改为（去掉 privateKey，同消息签名结果确定性相同）：
const cacheKey = `sm2_sign::${message}`;
```

> **注意**：同一 message 用同一 privateKey 签名结果确定，所以 key 只需 message。如果系统存在同一 message 用不同 privateKey 签名的场景，需要改为 `sm2_sign::${message}::${publicKey}`（用公钥区分，不用私钥）。请检查 `signWithSM2` 的所有调用方确认。当前调用方 `backend/services/sm2Service.js` L32 和前端多处，均为单一私钥场景，用 message 即可。

**验收标准**：
- 缓存 key 中不出现私钥
- 签名功能正常

---

### 修复 6：备份码可无限复用（TOTP reuse，High）

**文件 1**：`backend/services/mfaService.js`

**问题**：`verifyBackupCode`（约 L167-174）是纯查找函数，验证成功后不标记已用。测试中对同一码调用两次都返回有效 index。虽然生产调用方 `mfa.js` 会在验证后 splice，但函数本身应具备防复用能力。

**改动要求**：

找到 `verifyBackupCode` 函数（约 L167-174）：

```javascript
// 当前代码：
verifyBackupCode(code, hashedCodes) {
    if (!hashedCodes || !Array.isArray(hashedCodes)) {
      return -1;
    }
    const codeHash = generateSM3Hash(code);
    const index = hashedCodes.findIndex(h => h === codeHash);
    return index;
}

// 改为：
verifyBackupCode(code, hashedCodes) {
    if (!hashedCodes || !Array.isArray(hashedCodes)) {
      return -1;
    }
    const codeHash = generateSM3Hash(code);
    const index = hashedCodes.findIndex(h => h === codeHash);
    if (index !== -1) {
      // 验证成功后立即移除，防止复用
      hashedCodes.splice(index, 1);
    }
    return index;
}
```

**文件 2**：`backend/routes/mfa.js`

**问题**：调用方在 `verifyBackupCode` 返回后也做了 splice（约 L281），修复 6 后会重复 splice，导致删除错误的码。

**改动要求**：

找到 `verifyBackupCode` 调用后的 splice 代码（约 L281-282）：

```javascript
// 当前代码：
hashedCodes.splice(codeIndex, 1);
await userDao.updateBackupCodes(userId, hashedCodes);

// 改为（去掉 splice，verifyBackupCode 已内部处理）：
await userDao.updateBackupCodes(userId, hashedCodes);
```

**禁止项**：
- 不要改变 `hashBackupCodes` 函数
- 不要改变 `generateBackupCodes` 函数
- 不要改变备份码的存储格式
- `updateBackupCodes` 调用必须保留（持久化已变更的数组）

**验收标准**：
- `crypto.test.js` 中 TOTP 备份码二次验证从 knownIssue 变为 passed
- MFA 启用/验证/备份码使用的完整流程不受影响
- `security-fault-tolerance-test.js` 中 MFA 相关测试继续通过

---

### 修复 7：verifyProof 单参数后门（Critical）

**文件**：`backend/services/zkService.js`

**问题**：`verifyProof`（约 L55-59）检测到只传 1 个参数时直接返回 `true`，任何人调用 `verifyProof(anyObject)` 都能绕过验证。这是致命安全漏洞。

**改动要求**：

找到单参数检测代码（约 L55-59）：

```javascript
// 当前代码：
if (arguments.length === 1) {
  // 模拟验证成功
  return true;
}

// 直接删除这 4 行
```

删除后，函数开头变为：

```javascript
exports.verifyProof = async (proof, publicSignals) => {
  try {
    // 验证输入参数
    if (!proof || !publicSignals) {
      throw new Error('缺少必要参数: proof 和 publicSignals');
    }
    // ... 后续代码不变
```

**禁止项**：
- 不要改变后续的 proof 格式校验逻辑
- 不要改变 `snarkjs.groth16.verify` 的调用方式
- 不要删除区块链记录逻辑（约 L169-200）

**验收标准**：
- `verifyProof(fakeProof)` 抛出异常（不再返回 true）
- `verifyProof(fakeProof, ['1'])` 正常走格式校验流程
- `crypto.test.js` 和 `security-fault-tolerance-test.js` 中的单参数测试：测试代码已预期接受 true 或 exception 两种结果，修复后抛异常会被 catch 块捕获并标记为 passed，无需改测试代码

---

### 修复 8：generateProof 哈希破坏数值关系（B10-2，High）

**文件**：`backend/services/zkService.js`

**问题**：`generateProof`（约 L28-31）对 creditScore 和 threshold 做 SM3 哈希后截取前 8 位十六进制作为电路输入。哈希是单向函数，`hash(500) >= hash(600)` 与 `500 >= 600` 没有任何关系，导致电路比较结果随机。

**改动要求**：

找到哈希处理代码（约 L28-31）：

```javascript
// 当前代码：
const hashedCreditScore = parseInt(generateSM3Hash(creditScore.toString()).substring(0, 8), 16);
const hashedThreshold = parseInt(generateSM3Hash(threshold.toString()).substring(0, 8), 16);

// 使用snarkjs生成证明
logger.info('生成零知识证明', { hashedCreditScore, hashedThreshold });
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { creditScore: hashedCreditScore, threshold: hashedThreshold },
  wasmPath,
  provingKeyPath
);

// 改为：
const circuitCreditScore = Number(creditScore);
const circuitThreshold = Number(threshold);

if (isNaN(circuitCreditScore) || isNaN(circuitThreshold)) {
  throw new Error('creditScore 和 threshold 必须为有效数字');
}

logger.info('生成零知识证明', { creditScore: circuitCreditScore, threshold: circuitThreshold });
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  { creditScore: circuitCreditScore, threshold: circuitThreshold },
  wasmPath,
  provingKeyPath
);
```

**禁止项**：
- 不要删除 `generateSM3Hash` 的 import（其他地方可能用到）
- 不要改变 `snarkjs.groth16.fullProve` 的调用方式
- 不要改变返回值格式 `{ proof, publicSignals }`

**验收标准**：
- `generateProof(500, 600)` 生成的证明，`verifyProof` 应返回 false（配合修复 9）
- `generateProof(750, 600)` 生成的证明，`verifyProof` 应返回 true
- `generateProof(600, 600)` 边界值应返回 true

---

### 修复 9：circom 电路非约束赋值（B10-1，Critical）

**文件**：`circuits/credit.circom`

**问题**：L14 使用 `<--`（非约束赋值），证明者可伪造 `isValid` 值而不被电路检测。必须用 `<==`（约束赋值）或 circomlib 的比较模板。

**但注意**：`<==` 配合三元表达式 `(creditScore >= threshold) ? 1 : 0` 在 circom 中不合法（`>=` 不是 R1CS 线性运算）。必须使用 circomlib 的 `LessThan` 模板进行约束化比较。

**改动要求**：

将整个文件替换为：

```circom
// Credit verification circuit
// This circuit verifies that a user's credit score is above a threshold
// without revealing the actual credit score

include "node_modules/circomlib/circuits/comparators.circom";

template CreditVerification() {
    // Private inputs
    signal private input creditScore;
    signal private input threshold;

    // Public output
    signal output isValid;

    // 使用 LessThan 模板进行约束化比较（12位足够 0-4095 范围）
    component lt = LessThan(12);

    lt.in[0] <== creditScore;
    lt.in[1] <== threshold;

    // isValid = 1 当 creditScore >= threshold（即 NOT (creditScore < threshold)）
    isValid <== 1 - lt.out;
}

component main = CreditVerification();
```

**关键说明**：
- `LessThan(12)` 表示 12 位比较器，支持 0-4095 范围。信用分数 300-850 完全够用
- `lt.out = 1` 表示 `in[0] < in[1]`，所以 `1 - lt.out` 即为 `creditScore >= threshold`
- `include` 路径相对于 circom 文件位置，`node_modules/circomlib` 已存在于 `circuits/` 目录

**禁止项**：
- 不要删除 `signal private input` 声明
- 不要改变 component 名称 `CreditVerification`
- 不要改变 `component main = CreditVerification();` 声明

**验收标准**：
- circom 编译成功（见修复 9b）

---

### 修复 9b：重编译电路

**前提**：修复 9 完成后执行。

**环境要求**：
- 全局安装 circom 编译器（`cargo install circom`）
- 全局安装 snarkjs（`npm install -g snarkjs`）
- `circuits/pot12_final.ptau` 文件存在（已有）

**改动要求**：

```bash
cd circuits
node compile.js
```

这会重新生成以下文件：
- `build/credit.r1cs`
- `build/credit.wasm`
- `build/credit_final.zkey`
- `build/verification_key.json`

**如果编译环境不可用**：
- 跳过此步骤
- 修复 9 的代码改动仍然保留
- 标记为"待编译"，后续单独处理
- 其他修复不受影响（但 B10 相关测试仍会是 knownIssue）

**验收标准**：
- `circuits/build/credit.wasm` 文件更新时间晚于修复 9 的代码修改时间
- `crypto.test.js` 中 B10 相关测试从 knownIssue 变为 passed（需要编译环境可用）

---

## 二、测试脚本 Bug 修复

### 修复 10：performance-test.js gcImpact 属性名错误（Low）

**文件**：`backend/test/performance-test.js`

**问题**：`printSummary` 函数中（约 L1348）访问 `m9.gcImpact.stats.p99Ms`，但 `gcImpact` 对象中该属性名为 `requestLatencies`，导致 `TypeError: Cannot read properties of undefined`。

**改动要求**：

```javascript
// 当前代码（约 L1348）：
console.log(`  GC影响P99: ${m9.gcImpact.stats.p99Ms}ms`);

// 改为：
console.log(`  GC影响P99: ${m9.gcImpact.requestLatencies.p99Ms}ms`);
```

**验收标准**：
- 汇总报告正常打印，无 TypeError
- 退出码不因汇总打印失败而变为 1

---

### 修复 11：performance-test.js module8 注册缺少 sm2PublicKey（Medium）

**文件**：`backend/test/performance-test.js`

**问题**：`module8EndToEndBusinessPerformance`（约 L921-925）调用 `/auth/register` 时只传了 `username`、`password`、`creditScore`，缺少必填字段 `sm2PublicKey`。注册接口校验失败返回 400，catch 块直接 skip。

**改动要求**：

找到注册请求代码（约 L921-925）：

```javascript
// 当前代码：
await axios.post(`${BASE_URL}/auth/register`, {
  username: testUsername,
  password: testPassword,
  creditScore: 750
});

// 改为：
await axios.post(`${BASE_URL}/auth/register`, {
  username: testUsername,
  password: testPassword,
  sm2PublicKey: keyPair.publicKey,
  creditScore: 750
});
```

> **注意**：`keyPair` 在 L918 已通过 `generateSM2KeyPair()` 生成，直接使用即可。密码 `PerfTest123!` 已满足注册校验要求（8位+大小写）。`sm2PublicKey` 校验规则为 130 位十六进制，`generateSM2KeyPair()` 返回的 publicKey 符合此格式。

**禁止项**：
- 不要改变其他模块的测试逻辑
- 不要改变 axios 的 baseURL 或 timeout 配置

**验收标准**：
- module8 不再 skip，正常执行 e2e 业务流程测试
- `performance-test.js` 退出码为 0

---

## 三、完整验证方案

所有修复完成后，按以下顺序运行三个测试脚本：

### 3.1 运行密码技术测试

```bash
cd backend
node test/crypto.test.js
```

**预期结果**：52/52 全部 passed，0 knownIssue，0 failed

**重点关注**：
- B-SM2-INPUT（私钥格式错误）：应抛异常 → passed
- B9（签名位翻转）：翻转后验签返回 false → passed
- TOTP 备份码二次验证：第二次返回 -1 → passed
- B10（score < threshold）：验证返回 false → passed（需电路重编译）
- 单参数绕过（B2）：抛异常 → passed

### 3.2 运行性能基准测试

```bash
# 确保后端服务运行在 3003 端口
node test/performance-test.js
```

**预期结果**：退出码 0，module8 正常运行（不再 skip），汇总报告正常打印

### 3.3 运行安全与容错测试

```bash
node test/security-fault-tolerance-test.js
```

**预期结果**：全部 passed（与修复前一致，验证无回归）

### 3.4 验证结果汇总

| 脚本 | 修复前 | 修复后 |
|------|--------|--------|
| crypto.test.js | 48/52（4 knownIssue） | 52/52 passed |
| performance-test.js | 退出码 1，module8 skip | 退出码 0，module8 正常 |
| security-fault-tolerance-test.js | 全部 passed | 全部 passed（无变化） |

---

## 四、风险提示

1. **SM2 缓存 key 变更**（修复 1、5）：旧缓存自动失效（TTL 1 小时），无持久化影响
2. **mfaService 副作用**（修复 6）：`verifyBackupCode` 现在会修改传入的数组，所有调用者需感知此变更
3. **verifyProof 后门移除**（修复 7）：所有生产调用方均传 2 个参数，无影响
4. **电路重编译**（修复 9b）：如果 ptau 文件不同，验证密钥会变化，需确保使用相同的 `pot12_final.ptau`
5. **generateProof 输入变更**（修复 8）：从哈希值改为原始数值，需确认电路输入范围兼容

---

## 五、禁止项汇总

| 编号 | 禁止项 |
|------|--------|
| 1 | 不要改变 `sm2.doSignature` / `sm2.doVerifySignature` 的调用参数 |
| 2 | 不要删除任何 logger 调用（只去掉敏感参数） |
| 3 | 不要改变 `snarkjs.groth16.verify` 的调用方式 |
| 4 | 不要删除区块链记录逻辑（`blockchainService.recordZKPResult`） |
| 5 | 不要改变 `generateBackupCodes` / `hashBackupCodes` 函数 |
| 6 | 不要改变备份码的数据库存储格式 |
| 7 | 不要改变 circom 电路的 component 名称或 main 声明 |
| 8 | 不要改变 `performance-test.js` 中其他模块的测试逻辑 |
| 9 | 不要引入新的 npm 依赖 |
| 10 | 不要修改 `sm4Crypto.js`、`securityChain.js`、`credit.js` 等无关文件 |
