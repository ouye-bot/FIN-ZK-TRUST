# FinZkTrust 测试体系审计与改进方案

> 审计日期: 2026-05-17
> 审计范围: crypto.test.js / performance-test.js / security-fault-tolerance-test.js
> 目标: 评估覆盖维度、测试深度、专业说服力，输出可执行的改进方案

---

## 一、现有测试体系总览

| 测试文件 | 用例数 | 覆盖模块 | 运行依赖 |
|---------|-------|---------|---------|
| crypto.test.js | 27 | SM2/SM3/SM4/TOTP/ZKP/区块链/SSS | 纯本地，无需服务 |
| performance-test.js | 6模块 | API并发/密码学基准/ZKP性能/DB池/用户查询/安全链路 | 需要后端+DB运行 |
| security-fault-tolerance-test.js | 17 | 防重放/JWT认证/参数校验/错误处理 | 需要后端运行 |

---

## 二、逐维度审计

### 维度1：实现深度 — 评语：★★☆☆☆ (2/5)

**问题清单：**

| # | 问题 | 严重程度 | 说明 |
|---|------|---------|------|
| 1.1 | SM2 只测了 happy path | 高 | 缺少：空消息签名、超长消息(>10KB)、二进制数据、私钥格式错误、签名格式篡改(翻转1位) |
| 1.2 | SM3 雪崩效应阈值太低 | 中 | 当前阈值 `>=20/64` 字符不同即通过，SM3 标准应接近 50%（32/64）。实际结果 59/64 是好的，但阈值应提高到 28 |
| 1.3 | SM4 未测 `encryptFields`/`decryptFields` | 高 | 这是数据库层加解密的核心接口，覆盖 users 和 transactions 两张表的字段级加密 |
| 1.4 | SM4 未测 `reEncrypt`（密钥轮换） | 高 | 密钥轮换是金融系统合规要求，应验证旧密钥数据能用新密钥正确重新加密 |
| 1.5 | SM4 未测数字输入 | 中 | `encrypt(12345)` 的 number→string 转换路径 |
| 1.6 | TOTP 未测时间窗口漂移 | 高 | 当前只测了当前时间窗口，应测前一窗口(-30s)和后一窗口(+30s)的容错，以及超出窗口(-60s/+60s)的拒绝 |
| 1.7 | TOTP 未测备份验证码 | 高 | `generateBackupCodes`、`hashBackupCodes`、`verifyBackupCode` 三个接口完全未覆盖 |
| 1.8 | TOTP 未测种子加密存储 | 中 | `encryptSecret`/`decryptSecret` 接口未覆盖 |
| 1.9 | ZKP 只测了 score=750, threshold=600 | 高 | 未测边界情况：score == threshold（刚好达标）、score < threshold（不达标）、极端值(300, 850) |
| 1.10 | ZKP 未测 `verifyProof` 单参数绕过 | **致命** | `verifyProof` 在只传1个参数时返回 `true`，这是严重安全漏洞，必须有专门测试 |
| 1.11 | 区块链降级测试标记"需手动验证" | 高 | 6.3 测试实际上没有执行任何断言，直接标记通过 |
| 1.12 | SSS 未测不同 (k,n) 组合 | 中 | 只测了 (3,5)，应测 (2,2)、(2,3)、(5,5)、(3,3) 等 |
| 1.13 | SSS 未测大秘密值 | 低 | 未测 256-bit 边界值、全零、全F |
| 1.14 | 完全未覆盖 keyManager | 高 | `validateKeys()`、`getKey()`、`getAccessAuditLog()` 未测 |
| 1.15 | 完全未覆盖 buildSignatureData | 高 | 这是防重放签名的核心数据构造函数 |

### 维度2：工程质量 — 评语：★★★☆☆ (3/5)

**优点：**
- 自定义测试框架有清晰的模块化结构
- 结果输出为 JSON，便于自动化分析
- 性能测试有分层负载（低/中/高）和持续压测

**问题清单：**

| # | 问题 | 严重程度 | 说明 |
|---|------|---------|------|
| 2.1 | crypto.test.js 断言逻辑不严谨 | 高 | `addResult('sm2', '批量验证', allBatchPassed, ...)` 中 `allBatchPassed` 是 boolean，但 `addResult` 直接用它作为 `passed` 字段。当 `batchResults.filter(r => r).length` 为 10 时 `every` 返回 true，但测试报告显示 `passed: 10` 而非 `passed: true`，数据类型不一致 |
| 2.2 | 性能测试 QPS 计算方式有误 | 中 | `module6LoanBorrowWithProof` 中 `qps = borrowTimes.length / (borrowStats.max / 1000)`，用 max 延迟而非总时长计算 QPS，会严重高估 |
| 2.3 | 性能测试缺少基线对比 | 中 | 测试结果没有与 README 中声称的指标对比，无法判断是否达标 |
| 2.4 | 安全测试部分用例断言模糊 | 高 | 4.2/4.3/4.4 标记为 `partial`，因为只检查了 HTTP 400 而未验证错误消息内容是否准确 |
| 2.5 | 无测试隔离 | 中 | 性能测试直接修改全局状态（`globalThis.__benchToken`），测试之间有隐式依赖 |
| 2.6 | 区块链模块 6.1 初始化失败时标记 `passed: true` | 高 | 跳过应标记为 skipped 而非 passed，当前结果会让 27/27 全通过的报告产生误导 |

### 维度3：数据说服力 — 评语：★★☆☆☆ (2/5)

**问题清单：**

| # | 问题 | 改进方向 |
|---|------|---------|
| 3.1 | 性能数据缺少置信区间 | 应至少运行 3 轮取均值±标准差，当前只跑一轮 |
| 3.2 | 密码学吞吐量缺少对比基线 | 应对比 Node.js 原生 crypto（如 AES-256、SHA-256、ECDSA）的吞吐量作为参照 |
| 3.3 | ZKP 性能只有 10 次采样 | 样本量太小，p90/p95 统计意义不足，应至少 50 次 |
| 3.4 | API 压测缺少错误分布 | 只统计了 success/429/errors 总数，缺少按 HTTP 状态码的分布 |
| 3.5 | 数据库压测只用了 SELECT 1 | 未测真实业务 SQL（带 WHERE、JOIN、事务），结果不能代表真实场景 |
| 3.6 | 缺少资源消耗指标 | 性能测试未记录 CPU 使用率、内存峰值、GC 暂停时间 |
| 3.7 | 并发测试缺少阶梯图数据 | 只有 10/50/100/150/200 五个点，应增加到 8-10 个点以绘制更平滑的延迟-并发曲线 |

### 维度4：竞赛展示价值 — 评语：★★☆☆☆ (2/5)

**问题清单：**

| # | 问题 | 改进方向 |
|---|------|---------|
| 4.1 | 没有"安全攻击模拟"测试 | 竞赛评审最看重：你能证明你的防御有效。应增加：SQL 注入尝试、XSS 攻击、重放攻击完整链路、伪造 SM2 签名、篡改 ZKP proof |
| 4.2 | 没有端到端业务流程测试 | 应有完整的 注册→登录→信用证明→借款→还款→信用分变化 流程测试 |
| 4.3 | 没有异常恢复测试 | 应测试：DB 断连后恢复、区块链节点重启后恢复、密钥轮换后旧数据可读 |
| 4.4 | 性能测试没有生成可视化图表 | JSON 数据对评审不友好，应生成 Markdown 表格或 ASCII 图表 |
| 4.5 | 缺少国密合规性证明 | 应增加：SM2 符合 GM/T 0009 标准、SM3 符合 GM/T 0004 标准、SM4 符合 GM/T 0002 标准的验证测试 |
| 4.6 | 没有隐私保护验证 | ZKP 的核心价值是"数据可用不可见"，应证明：验证者无法从 publicSignals 推导出真实信用分 |

### 维度5：原则合规 — 评语：★★★☆☆ (3/5)

| 原则 | 状态 | 说明 |
|------|------|------|
| 测试不修改生产数据 | ✅ | 使用独立测试用户和本地 DB |
| 测试可重复运行 | ⚠️ | 用户名带时间戳可重复，但依赖 Hardhat 节点状态 |
| 测试不依赖外部服务 | ⚠️ | 区块链测试依赖本地 Hardhat，DB 测试依赖 MySQL |
| 失败时有清晰错误信息 | ⚠️ | 部分用例只打印 "结果不符" 而未说明期望值 |
| 测试覆盖边界条件 | ❌ | 大量边界条件未覆盖（详见维度1） |

---

## 三、发现的系统级 Bug（测试应验证）

这些是在审查源码时发现的 bug，测试方案应包含对应的验证用例：

| # | Bug | 位置 | 严重程度 | 测试验证方式 |
|---|-----|------|---------|------------|
| B1 | `sm2SignatureMiddleware` 硬编码 `isValid = true` | sm2SignatureMiddleware.js:39 | **致命** | 测试用错误签名调用受保护接口，应被拒绝但实际会通过 |
| B2 | `verifyProof` 单参数返回 true | zkService.js:56-58 | **致命** | 测试 `verifyProof(fakeProof)` 应返回 false |
| B3 | `sm4Crypto.decrypt` 失败时返回原文 | sm4Crypto.js 多处 | 高 | 测试篡改密文后解密应抛异常而非返回原文 |
| B4 | `mfaService.getSm4Key()` 硬编码备用密钥 | mfaService.js | 高 | 测试无环境变量时应抛异常 |
| B5 | `securityChain` 黑名单 token 不返回响应 | securityChain.js:56-58 | 高 | 测试黑名单 token 请求应返回 401 而非超时 |
| B6 | `redeem.js` 标记所有投资为完成 | redeem.js:141-146 | 高 | 测试部分赎回后其他投资应保持 active |
| B7 | `credit.js` MAX_SCORE 850 vs clamp 900 | credit.js:370 | 中 | 测试信用分不应超过 850 |
| B8 | `generateSaltedSM3Hash` 用 Math.random | cryptoUtils.js:121 | 中 | 统计 1000 个 salt 的熵值 |

---

## 四、改进方案 — 新增测试用例清单

### 文件1：crypto.test.js 增强（+23 个用例）

#### SM2 模块（+5 个）

```
1.7 空消息签名
    输入: signWithSM2('', privateKey)
    预期: 返回非空签名字符串，长度 128

1.8 超长消息签名（100KB）
    输入: signWithSM2('x'.repeat(100000), privateKey)
    预期: 签名成功，验签通过

1.9 私钥格式错误
    输入: signWithSM2(message, 'invalid_key')
    预期: 抛出异常或返回可检测的错误

1.10 签名位翻转检测
    输入: 将签名的第1个字符翻转，然后验签
    预期: verifySM2Signature 返回 false

1.11 buildSignatureData 格式验证
    输入: buildSignatureData({amount: 100, userId: 'u1', creditProofId: 'p1'}, ['amount', 'creditProofId', 'userId'])
    预期: 返回的 JSON 字符串中键顺序与 keyOrder 一致
    输入2: buildSignatureData({amount: 100}, ['amount', 'missing_key'])
    预期: missing_key 被跳过，不抛异常
```

#### SM3 模块（+2 个）

```
2.5 雪崩效应阈值提高
    预期: diffCount >= 28 (接近 50% 的 64 字符)

2.6 Unicode 数据哈希
    输入: generateSM3Hash('中文测试🎉')
    预期: 返回 64 字符 hex，与英文数据哈希不同
```

#### SM4 模块（+5 个）

```
3.5 数字输入加密
    输入: encrypt(12345)
    预期: decrypt 结果 === '12345'

3.6 encryptFields/decryptFields users 表
    输入: encryptFields('users', {balance: 10000, credit_score: 750, name: 'test'})
    预期: balance 和 credit_score 被加密（不再是原值），name 不变
    后续: decryptFields('users', encryptedData)
    预期: balance === 10000, credit_score === 750

3.7 encryptFields/decryptFields transactions 表
    输入: encryptFields('transactions', {amount: 5000, interest: 100, type: 'loan'})
    预期: amount 和 interest 被加密，type 不变

3.8 reEncrypt 密钥轮换
    输入: reEncrypt(encryptedData, oldKey, newKey)
    预期: 用新密钥 decrypt 结果 === 原始明文
    验证: 密文前缀变为 v2:

3.9 SM4 认证标签完整性（系统性）
    输入: 对密文的 iv、authTag、ciphertext 三部分分别篡改1位
    预期: 三种篡改均导致解密失败（返回原文或抛异常）
```

#### TOTP 模块（+4 个）

```
4.4 时间窗口容错 - 前一窗口
    输入: 生成 counter-1 的 token，verifyToken
    预期: 通过（90秒容错）

4.5 时间窗口容错 - 后一窗口
    输入: 生成 counter+1 的 token，verifyToken
    预期: 通过

4.6 时间窗口超限拒绝
    输入: 生成 counter-3 的 token（超出容错范围）
    预期: 拒绝

4.7 备份验证码完整流程
    步骤: generateBackupCodes(10) → hashBackupCodes → verifyBackupCode(正确码) → verifyBackupCode(已用码)
    预期: 正确码返回 index >= 0，已用码二次验证仍返回 index（当前实现不消耗）
```

#### ZKP 模块（+4 个）

```
5.5 边界值 - score == threshold
    输入: generateProof(600, 600)
    预期: 证明生成成功，验证通过

5.6 不达标 - score < threshold
    输入: generateProof(500, 600)
    预期: 证明生成成功但验证应返回 false（publicSignals 指示不达标）

5.7 单参数绕过漏洞测试（对应 Bug B2）
    输入: verifyProof(tamperedProof)  // 只传1个参数
    预期: 返回 false（当前实返回 true，这是 bug）

5.8 极端值 - 低分
    输入: generateProof(300, 300)
    预期: 证明生成成功
```

#### 区块链模块（+1 个）

```
6.3 降级测试改为自动验证
    方法: mock blockchainService.initialize 返回 false
    预期: storeAuditHash 应优雅降级（不抛异常，返回 skipped 或 error）
    当前: 标记"需手动验证"并直接 passed，没有实际断言
```

#### SSS 模块（+2 个）

```
7.4 不同阈值组合 (2,2)
    输入: splitSecretToShares(key, 2, 2)
    预期: 任一单独分片无法恢复，两个分片可恢复

7.5 重复分片恢复
    输入: recoverSecretFromShares([shares[0], shares[0]])  // 同一分片传两次
    预期: 恢复失败或结果错误
```

### 文件2：security-fault-tolerance-test.js 增强（+15 个用例）

#### 新增模块5：SM2 签名中间件测试（5项，对应 Bug B1）

```
5.1 有效签名通过
    构造: 正确的 SM2 签名 + x-user-id + x-sm2-signature 头
    预期: 请求通过（200 或业务层错误）

5.2 错误签名拒绝（对应 Bug B1 验证）
    构造: 用错误私钥签名
    预期: 401 拒绝
    ⚠️ 当前实现由于 isValid=true 硬编码，此测试会失败，暴露 bug

5.3 缺少签名头透传
    构造: 不传 x-sm2-signature 头
    预期: 请求透传（当前实现行为）

5.4 不存在的用户ID
    构造: x-user-id: 99999999
    预期: 401

5.5 签名数据篡改
    构造: 先正确签名，然后修改 request body
    预期: 签名验证失败（但当前实现不会验证）
```

#### 新增模块6：ZKP 验证安全测试（3项，对应 Bug B2）

```
6.1 单参数调用绕过（Bug B2 验证）
    构造: 直接调用 zkService.verifyProof(fakeProof)
    预期: 应返回 false
    ⚠️ 当前实返回 true，此测试暴露致命漏洞

6.2 篡改 publicSignals
    构造: 修改 publicSignals[0] 的值
    预期: 验证返回 false

6.3 空 proof 结构
    构造: verifyProof({}, ['1'])
    预期: 返回 false 或抛异常
```

#### 新增模块7：SM4 静默失败测试（3项，对应 Bug B3）

```
7.1 篡改密文后解密行为
    构造: encrypt(data) → 篡改密文最后一个字符 → decrypt
    预期: 应抛异常或返回明确错误
    ⚠️ 当前实现返回原文，此测试暴露静默失败问题

7.2 截断密文
    构造: encrypt(data) → 截取前半部分 → decrypt
    预期: 应抛异常

7.3 非字符串输入
    构造: decrypt(12345) / decrypt(null) / decrypt(undefined)
    预期: 应抛异常或返回明确错误
```

#### 新增模块8：认证链路完整性测试（4项）

```
8.1 完整攻击链 - 过期JWT + 有效防重放
    构造: 过期JWT + 正确的防重放头
    预期: 401（JWT层拦截）

8.2 完整攻击链 - 有效JWT + 重放Nonce
    构造: 有效JWT + 已使用过的Nonce
    预期: 403（防重放层拦截）

8.3 完整攻击链 - 有效JWT + 有效防重放 + 超出借款限额
    构造: 合法请求但 amount 超过信用限额
    预期: 业务层拒绝（非安全层）

8.4 黑名单Token请求不挂起（Bug B5 验证）
    构造: 先正常登录获取token → 调用logout/refresh使token失效 → 用旧token请求
    预期: 返回 401，不应超时
    ⚠️ 当前实现可能挂起（不返回响应）
```

### 文件3：performance-test.js 增强（+6 个模块）

#### 新增模块7：密码学对比基准

```
7.1 Node.js 原生 SHA-256 vs SM3 对比
    方法: 同样 1KB 数据，各跑 10000 次
    输出: 两者吞吐量和比率

7.2 Node.js 原生 AES-256-GCM vs SM4 对比
    方法: 同样 1KB 数据，各跑 1000 次
    输出: 两者吞吐量和比率

7.3 Node.js 原生 ECDSA (P-256) vs SM2 对比
    方法: 各签名 5000 次
    输出: 两者吞吐量和比率
```

#### 新增模块8：端到端业务流程性能

```
8.1 完整借款流程耗时分解
    步骤: 生成ZKP证明 → 提交借款 → 验证 → 资金池操作 → 区块链存证
    输出: 每步耗时占比饼图数据

8.2 完整还款流程耗时分解
    步骤: 查询未还贷款 → 提交还款 → 利息计算 → 余额更新 → 信用分更新
    输出: 每步耗时占比
```

#### 新增模块9：资源消耗监控

```
9.1 内存泄漏检测
    方法: 连续执行 1000 次 API 请求，每 100 次记录 heapUsed
    预期: 内存增长 < 50MB（排除初始分配）

9.2 GC 暂停影响
    方法: 在压测期间记录 GC 事件和暂停时间
    输出: GC 暂停对 P99 延迟的影响
```

---

## 五、优先级排序

### P0 — 必须修复的测试盲区（竞赛扣分项）

| 序号 | 改进项 | 对应 Bug | 预计工作量 |
|------|-------|---------|----------|
| 1 | ZKP 单参数绕过测试 | B2 | 30min |
| 2 | SM2 签名中间件实际验证测试 | B1 | 1h |
| 3 | SM4 静默失败暴露测试 | B3 | 30min |
| 4 | TOTP 时间窗口漂移测试 | - | 45min |
| 5 | 完整端到端业务流程测试 | - | 2h |

### P1 — 显著提升说服力（竞赛加分项）

| 序号 | 改进项 | 预计工作量 |
|------|-------|----------|
| 6 | SM4 encryptFields/decryptFields 测试 | 1h |
| 7 | 密码学对比基准（国密 vs 国际标准） | 1.5h |
| 8 | ZKP 边界值测试（score==threshold, score<threshold） | 45min |
| 9 | 安全攻击链完整测试 | 1.5h |
| 10 | 备份验证码完整流程测试 | 45min |

### P2 — 锦上添花

| 序号 | 改进项 | 预计工作量 |
|------|-------|----------|
| 11 | 性能测试多轮取均值±标准差 | 1h |
| 12 | SSS 多组合测试 | 30min |
| 13 | 密钥轮换 (reEncrypt) 测试 | 30min |
| 14 | 内存泄漏检测 | 1h |
| 15 | buildSignatureData 格式测试 | 30min |

---

## 六、执行注意事项

1. **三个文件独立修改**，不要合并为一个文件
2. **保持现有框架风格**：crypto.test.js 用 class CryptoTest，其余两个用函数式
3. **JSON 报告格式不变**，新增字段向后兼容
4. **Bug 验证用例应标记 `expectedFail: true`**：当发现已知 bug 时，测试应记录"预期行为"和"实际行为"，而非简单 pass/fail
5. **性能测试新增模块应放在 DB 压测之后**，避免影响已有模块的执行顺序
6. **所有新增用例必须有中文名称和控制台输出**，与现有风格一致

---

## 七、验收标准

执行完成后，我将从以下维度验收：

- [ ] 每个新增用例都有清晰的输入、预期输出、实际输出
- [ ] Bug B1-B3 的测试能正确暴露问题（记录为 known_issue）
- [ ] 性能对比数据包含 SM vs 国际标准的比率
- [ ] 端到端流程测试覆盖 注册→登录→ZKP→借款→还款 全链路
- [ ] 所有现有 27 + 17 个用例仍然通过（无回归）
- [ ] JSON 报告格式兼容现有解析
