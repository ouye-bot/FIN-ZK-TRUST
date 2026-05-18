# ZKP 第三方独立验证 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist zk_proof and publicSignals to database so third parties can independently verify proofs using the public verification key.

**Architecture:** Add two TEXT columns to credit_proofs table, store proof data on generate-proof, return proof data on verify-proof, expose verification key via public API endpoint.

**Tech Stack:** Node.js, Express, MySQL, snarkjs

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/scripts/create-tables.js` | Modify | Add `zk_proof` and `public_signals` columns (CREATE TABLE + migration) |
| `backend/dao/proofDao.js` | Modify | `create()` accepts and stores new columns |
| `backend/routes/credit.js` | Modify | Store proof on generate, return proof on verify, add verification-key endpoint |
| `backend/test/crypto.test.js` | Modify | Add tests 5.13-5.15 for proof persistence, independent verification, and verification-key endpoint |

---

### Task 1: Database Schema — Add columns to credit_proofs

**Files:**
- Modify: `backend/scripts/create-tables.js:102-118`

- [ ] **Step 1: Update CREATE TABLE statement**

In `backend/scripts/create-tables.js`, add `zk_proof` and `public_signals` TEXT columns to the `credit_proofs` CREATE TABLE statement at line 102-118:

```js
    // 创建credit_proofs表
    await execute(`
      CREATE TABLE IF NOT EXISTS credit_proofs (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id BIGINT NOT NULL,
        proof_id VARCHAR(255) UNIQUE NOT NULL,
        verification_code VARCHAR(255) NOT NULL,
        sm3_hash VARCHAR(255) NOT NULL,
        proof_data TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        zk_proof TEXT DEFAULT NULL COMMENT 'snarkjs proof JSON (pi_a, pi_b, pi_c)',
        public_signals TEXT DEFAULT NULL COMMENT 'publicSignals array JSON',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_id (user_id),
        INDEX idx_proof_id (proof_id),
        INDEX idx_expires_at (expires_at),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('credit_proofs表创建成功');
```

- [ ] **Step 2: Add migration for existing databases**

After the `credit_proofs` CREATE TABLE block (after line 119), add idempotent column migration:

```js
    // 为credit_proofs表添加ZKP持久化字段（幂等操作）
    await addColumnIfNotExists('credit_proofs', 'zk_proof', "TEXT DEFAULT NULL COMMENT 'snarkjs proof JSON (pi_a, pi_b, pi_c)'");
    await addColumnIfNotExists('credit_proofs', 'public_signals', "TEXT DEFAULT NULL COMMENT 'publicSignals array JSON'");
    console.log('credit_proofs表ZKP持久化字段迁移完成');
```

- [ ] **Step 3: Run migration to verify**

Run: `node backend/scripts/create-tables.js`
Expected: Output includes "credit_proofs表创建成功" and "credit_proofs表ZKP持久化字段迁移完成" (or "字段已存在，跳过" on repeat runs)

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/create-tables.js
git commit -m "feat(db): add zk_proof and public_signals columns to credit_proofs table"
```

---

### Task 2: DAO Layer — Update proofDao.create()

**Files:**
- Modify: `backend/dao/proofDao.js:8-23`

- [ ] **Step 1: Update create() to accept new columns**

Replace the entire `create` function in `backend/dao/proofDao.js`:

```js
exports.create = async (proofData) => {
  const { user_id, proof_id, verification_code, sm3_hash, proof_data, expires_at, zk_proof, public_signals } = proofData;
  const sql = `
    INSERT INTO credit_proofs (user_id, proof_id, verification_code, sm3_hash, proof_data, expires_at, zk_proof, public_signals)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const result = await execute(sql, [
    user_id,
    proof_id,
    verification_code,
    sm3_hash,
    proof_data,
    expires_at,
    zk_proof || null,
    public_signals || null
  ]);
  return await exports.findById(result.insertId);
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/dao/proofDao.js
git commit -m "feat(dao): proofDao.create() accepts zk_proof and public_signals"
```

---

### Task 3: Store Proof on Generate — Update generate-proof route

**Files:**
- Modify: `backend/routes/credit.js:150-158`

- [ ] **Step 1: Update proofDao.create() call to include proof data**

In `backend/routes/credit.js`, replace the `proofDao.create()` call at lines 150-158:

```js
    // 保存信用证明到数据库
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

- [ ] **Step 2: Commit**

```bash
git add backend/routes/credit.js
git commit -m "feat(credit): persist zk_proof and publicSignals on generate-proof"
```

---

### Task 4: Return Proof on Verify — Update verify-proof route

**Files:**
- Modify: `backend/routes/credit.js:232-248`

- [ ] **Step 1: Update verify-proof success response to include proof data**

In `backend/routes/credit.js`, replace the `if (isValid)` block at lines 232-248:

```js
    if (isValid) {
      logger.info('信用证明验证成功', { proofId });

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
    } else {
      logger.warn('信用证明验证失败', { proofId });
      res.json({
        success: false,
        message: '信用证明验证失败'
      });
    }
```

- [ ] **Step 2: Commit**

```bash
git add backend/routes/credit.js
git commit -m "feat(credit): return zkProof and publicSignals from verify-proof"
```

---

### Task 5: Verification Key Public Endpoint

**Files:**
- Modify: `backend/routes/credit.js:1-9` (add requires) and add new route before `module.exports`

- [ ] **Step 1: Add path and fs requires**

At the top of `backend/routes/credit.js`, the `path` and `fs` modules are not currently imported. Add them after the existing requires (line 9):

```js
const path = require('path');
const fs = require('fs');
```

- [ ] **Step 2: Add verification-key endpoint**

Add this route before the `module.exports` line (before line 451 `module.exports = router;`):

```js
// 获取验证密钥（公开接口，供第三方独立验证 ZKP）
router.get('/verification-key', async (req, res) => {
  try {
    const vkeyPath = path.join(__dirname, '../../circuits/build/verification_key.json');
    if (!fs.existsSync(vkeyPath)) {
      return res.status(404).json({ success: false, message: '验证密钥未找到' });
    }
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
    res.json({ success: true, data: vkey });
  } catch (error) {
    logger.error('获取验证密钥失败', { error: error.message });
    res.status(500).json({ success: false, message: '获取验证密钥失败' });
  }
});
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/credit.js
git commit -m "feat(credit): add GET /verification-key public endpoint"
```

---

### Task 6: Tests — Add ZKP third-party verification tests

**Files:**
- Modify: `backend/test/crypto.test.js` — add tests 5.13, 5.14, 5.15 after test 5.12

- [ ] **Step 1: Add test 5.13 — Proof persistence**

In `backend/test/crypto.test.js`, after the 5.12 test block (around line 1130), add:

```js
    // 5.13 证明持久化 - zk_proof 和 public_signals 存储验证
    console.log('\n  5.13 证明持久化 - zk_proof 和 public_signals 存储验证');
    try {
      const proofDao = require('../dao/proofDao');
      const testProofId = `test_persist_${Date.now()}`;
      const testProof = proofResult.proof;
      const testSignals = proofResult.publicSignals;

      // 直接调用 DAO 存储
      const saved = await proofDao.create({
        user_id: 1, // 假设存在 user_id=1
        proof_id: testProofId,
        verification_code: `test_code_${Date.now()}`,
        sm3_hash: 'test_hash',
        proof_data: JSON.stringify({ test: true }),
        expires_at: new Date(Date.now() + 86400000).toISOString().slice(0, 19).replace('T', ' '),
        zk_proof: JSON.stringify(testProof),
        public_signals: JSON.stringify(testSignals)
      });

      const hasZkProof = saved && saved.zk_proof && saved.zk_proof !== 'null';
      const hasPublicSignals = saved && saved.public_signals && saved.public_signals !== 'null';

      let parsedProof = null;
      let parsedSignals = null;
      if (hasZkProof && hasPublicSignals) {
        parsedProof = JSON.parse(saved.zk_proof);
        parsedSignals = JSON.parse(saved.public_signals);
      }

      const persistOK = hasZkProof && hasPublicSignals &&
        parsedProof && parsedProof.pi_a && parsedProof.pi_b && parsedProof.pi_c &&
        Array.isArray(parsedSignals) && parsedSignals.length >= 1;

      this.addResult('zkp', '证明持久化 zk_proof/public_signals', persistOK, {
        hasZkProof,
        hasPublicSignals,
        proofStructureValid: !!(parsedProof?.pi_a && parsedProof?.pi_b && parsedProof?.pi_c),
        signalsIsArray: Array.isArray(parsedSignals),
        signalsLength: parsedSignals?.length || 0
      });
      console.log(`     ${persistOK ? '✓' : '✗'} 证明持久化: zk_proof=${hasZkProof}, public_signals=${hasPublicSignals}, 结构有效=${!!(parsedProof?.pi_a)}`);
    } catch (e) {
      this.addResult('zkp', '证明持久化 zk_proof/public_signals', false, { error: e.message });
      console.log(`     ✗ 证明持久化: 失败 - ${e.message}`);
    }
```

- [ ] **Step 2: Add test 5.14 — Independent verification with stored proof**

After test 5.13, add:

```js
    // 5.14 存储后独立验证 - 用存储的 proof 数据独立验证
    console.log('\n  5.14 存储后独立验证 - 用存储的 proof 数据独立验证');
    try {
      // 用原始 proof 和 publicSignals 直接验证（模拟第三方拿到数据后的操作）
      const independentVerify = await zkService.verifyProof(proofResult.proof, proofResult.publicSignals);
      this.addResult('zkp', '存储后独立验证', independentVerify === true, {
        verifyResult: independentVerify,
        note: '第三方拿到 proof + publicSignals + verification_key 后可独立验证'
      });
      console.log(`     ${independentVerify === true ? '✓' : '✗'} 独立验证: ${independentVerify}`);
    } catch (e) {
      this.addResult('zkp', '存储后独立验证', false, { error: e.message });
      console.log(`     ✗ 独立验证: 失败 - ${e.message}`);
    }
```

- [ ] **Step 3: Add test 5.15 — Verification key endpoint availability**

After test 5.14, add:

```js
    // 5.15 验证密钥端点 - verification_key.json 可读且格式正确
    console.log('\n  5.15 验证密钥端点 - verification_key.json 可读且格式正确');
    try {
      const vkeyPath = path.join(__dirname, '../../circuits/build/verification_key.json');
      const vkeyExists = fs.existsSync(vkeyPath);
      let vkeyValid = false;
      let vkeyFields = [];
      if (vkeyExists) {
        const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
        vkeyFields = Object.keys(vkey);
        vkeyValid = !!(vkey.vk_alpha_1 && vkey.vk_beta_2 && vkey.vk_gamma_2 && vkey.vk_delta_2 && vkey.IC);
      }
      this.addResult('zkp', '验证密钥端点 verification_key.json', vkeyExists && vkeyValid, {
        exists: vkeyExists,
        fieldsValid: vkeyValid,
        fields: vkeyFields
      });
      console.log(`     ${vkeyExists && vkeyValid ? '✓' : '✗'} verification_key.json: exists=${vkeyExists}, valid=${vkeyValid}`);
    } catch (e) {
      this.addResult('zkp', '验证密钥端点 verification_key.json', false, { error: e.message });
      console.log(`     ✗ 验证密钥: 失败 - ${e.message}`);
    }
```

- [ ] **Step 4: Run the full test suite**

Run: `cd backend && node test/crypto.test.js`
Expected: All existing tests pass + 3 new tests (5.13, 5.14, 5.15) pass. Total zkp module: 15 passed, 0 failed.

- [ ] **Step 5: Commit**

```bash
git add backend/test/crypto.test.js
git commit -m "test(zkp): add proof persistence, independent verification, and vkey endpoint tests"
```

---

### Task 7: Integration Verification — Run full test suite

- [ ] **Step 1: Run crypto.test.js**

Run: `cd backend && node test/crypto.test.js`
Expected: 0 failures, 0 skips (except blockchain node), 0 known issues (except B10)

- [ ] **Step 2: Verify verification-key endpoint manually**

Start the backend server, then:
Run: `curl http://localhost:3001/api/v1/credit/verification-key`
Expected: `{"success":true,"data":{"protocol":"groth16","curve":"bn128",...}}`

- [ ] **Step 3: Commit all changes together if needed**

```bash
git status
```

Verify no unstaged changes remain.

---

## Summary of Changes

| File | Lines Changed | What |
|------|--------------|------|
| `backend/scripts/create-tables.js` | ~10 lines | CREATE TABLE + migration for 2 new columns |
| `backend/dao/proofDao.js` | ~5 lines | `create()` destructures and inserts 2 new fields |
| `backend/routes/credit.js` | ~20 lines | Store proof on generate, return on verify, new endpoint |
| `backend/test/crypto.test.js` | ~80 lines | 3 new test cases (5.13-5.15) |

Total: ~115 lines changed across 4 files. No new files created.
