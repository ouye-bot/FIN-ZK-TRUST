# ZKP 第三方独立验证设计文档

**日期:** 2026-05-18
**状态:** 已批准

## 问题

当前系统在 `POST /api/v1/credit/generate-proof` 流程中，后端验证 ZKP 证明后丢弃了 `proof`（pi_a, pi_b, pi_c）和 `publicSignals`，只存储随机验证码。第三方只能通过数据库查询验证码，必须信任服务器。

## 目标

让第三方拿到 proof 数据后，能用公开的 verification key 自行验证，不依赖服务器信任。系统从"信任服务器"升级为"密码学可验证"。

## 改动范围

### 1. 数据库 — `credit_proofs` 表新增两列

**文件:** `backend/scripts/create-tables.js`

在 `credit_proofs` 建表语句中增加：
- `zk_proof TEXT` — 存储 snarkjs proof 对象的 JSON 字符串（pi_a, pi_b, pi_c）
- `public_signals TEXT` — 存储 publicSignals 数组的 JSON 字符串

使用 `addColumnIfNotExists` 幂等迁移（与 fund_pool/transactions 表模式一致），确保已有数据库平滑升级。

### 2. DAO 层 — `proofDao.js` 适配

**文件:** `backend/dao/proofDao.js`

`create()` 方法增加 `zk_proof` 和 `public_signals` 参数：

```js
exports.create = async (proofData) => {
  const { user_id, proof_id, verification_code, sm3_hash, proof_data, expires_at, zk_proof, public_signals } = proofData;
  const sql = `
    INSERT INTO credit_proofs (user_id, proof_id, verification_code, sm3_hash, proof_data, expires_at, zk_proof, public_signals)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  // ...
};
```

### 3. 存储路径 — generate-proof 路由

**文件:** `backend/routes/credit.js` (约 L151)

当前端传了 `proof` 和 `publicSignals` 时，`proofDao.create()` 一起存入：

```js
const savedProof = await proofDao.create({
  user_id: user.id,
  proof_id: proofId,
  verification_code: verificationCode,
  sm3_hash: sm3Hash,
  proof_data: proofData,
  expires_at: expiresAt,
  zk_proof: proof ? JSON.stringify(proof) : null,
  public_signals: publicSignals ? JSON.stringify(publicSignals) : null
});
```

降级路径（无 ZKP）时，`zk_proof` 和 `public_signals` 为 NULL。

### 4. 验证路径 — verify-proof 路由

**文件:** `backend/routes/credit.js` (约 L202)

验证码校验通过后，从数据库取出 proof 数据返回给调用方：

```js
if (isValid) {
  const responseData = {
    proofId,
    expiresAt: proof.expires_at
  };

  // 如果有存储的 ZKP proof，返回给第三方独立验证
  if (proof.zk_proof && proof.public_signals) {
    responseData.zkProof = JSON.parse(proof.zk_proof);
    responseData.publicSignals = JSON.parse(proof.public_signals);
  }

  res.json({
    success: true,
    message: '信用证明验证成功',
    data: responseData
  });
}
```

### 5. Verification Key 公开端点

**文件:** `backend/routes/credit.js`

新增 `GET /api/v1/credit/verification-key`：

```js
router.get('/verification-key', async (req, res) => {
  const vkeyPath = path.join(__dirname, '../../circuits/build/verification_key.json');
  if (!fs.existsSync(vkeyPath)) {
    return res.status(404).json({ success: false, message: '验证密钥未找到' });
  }
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
  res.json({ success: true, data: vkey });
});
```

无需认证，公开访问。

### 6. 前端适配（可选）

**文件:** `frontend/src/pages/CreditProof.js`

`handleVerifyProof` 验证成功后，如果后端返回了 `zkProof` 和 `publicSignals`，可展示"密码学独立验证"信息。此为 UI 增强，非核心功能。

## 验证码模式兼容

两种验证方式并行：
- **快速验证:** 提交验证码 → 查数据库 → 返回结果（现有流程）
- **密码学验证:** 拿到 proof + publicSignals + vkey → 自己用 snarkjs.groth16.verify() 验证（新增）

## 测试计划

### 新增测试用例

1. **proof 持久化验证** — 生成证明后，查询数据库确认 `zk_proof` 和 `public_signals` 不为 NULL，且可解析为有效 JSON
2. **verify-proof 返回 proof 数据** — 验证码校验通过后，响应包含 `zkProof` 和 `publicSignals` 字段
3. **独立密码学验证** — 用返回的 proof + publicSignals + verification_key.json 调用 `snarkjs.groth16.verify()`，结果为 true
4. **降级兼容** — 旧证明（zk_proof 为 NULL）的 verify-proof 不崩溃，正常返回验证结果
5. **verification-key 端点** — GET 请求返回 200，响应包含 `vk_alpha_1`, `vk_beta_2`, `vk_gamma_2`, `vk_delta_2`, `IC` 字段

### 现有测试不破坏

- crypto.test.js 的 module5_zkpTests 全部通过
- security-fault-tolerance-test.js 全部通过

## 前置依赖

- `circuits/build/verification_key.json` 已存在（已确认）
- `circuits/build/credit.wasm` 和 `credit_final.zkey` 已存在（已确认）

## 不做的事

- 不改前端 UI（核心功能在 API 层）
- 不加 proof 过期清理逻辑（已有 `proofDao.deleteExpired()`)
- 不改 ZKP 电路本身
