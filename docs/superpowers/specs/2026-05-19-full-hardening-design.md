# FinZkTrust 全面加固设计规格

> **目标**：修复审计发现的所有安全漏洞，完善全链路国密，深化区块链集成
> **范围**：安全加固 + 国密完善 + 区块链深化（三阶段串行）
> **约束**：学术完善级别，不引入新依赖，向后兼容

---

## 总体架构

```
阶段1: 安全加固（基础层）
  ├─ 密钥管理重构（环境变量 + 启动校验）
  ├─ 并发控制统一（FOR UPDATE）
  ├─ 权限漏洞修复（MFA、数据隔离）
  └─ 测试: 安全测试套件

阶段2: 国密完善（基础设施层）
  ├─ FISCO BCOS SM_SSL 切换
  ├─ Tengine NTLS 启用
  ├─ 前端 HTTPS 路由
  └─ 测试: 国密链路端到端测试

阶段3: 区块链深化（功能层）
  ├─ Verifier 合约部署
  ├─ 双层 ZKP 验证（后端+链上）
  ├─ 验证 UX 完善
  └─ 测试: 区块链集成测试
```

**设计原则**：
- 每个修复点独立、可测试、有对应的测试用例
- 不引入新依赖（使用现有的 Node.js crypto、mysql2、snarkjs 等）
- 向后兼容（环境变量不设置时给出明确错误，而不是静默失败）
- 国密合规：所有密码操作使用 SM2/SM3/SM4

---

## 阶段1：安全加固

### 1.1 密钥管理重构

**问题**：SM4_MASTER_KEY、JWT_SECRET 硬编码在 `.env` 文件中。

**修改文件**：
- 创建：`backend/utils/keyValidator.js`
- 修改：`backend/app.js`（启动时调用校验）
- 修改：`backend/.env.example`（占位符，不含真实密钥）
- 修改：`.gitignore`（确保 .env 不提交）

**实现**：
- `keyValidator.js` 导出 `validateKeys()` 函数
- 校验规则：
  - `SM4_MASTER_KEY`：必须是32位十六进制字符串（128位），不能等于默认值 `3e6028661aee1f805f3d057577536779`
  - `JWT_SECRET`：最少32字符
  - `JWT_REFRESH_SECRET`：必须设置且不等于 `JWT_SECRET`
  - `DB_PASSWORD`：不能是 `123456`
- 校验失败时 `process.exit(1)` 并输出明确错误信息
- `app.js` 在 `app.listen()` 之前调用 `validateKeys()`

**测试**：
- 测试缺失 SM4_MASTER_KEY 时启动失败
- 测试弱密码时启动失败
- 测试 JWT_REFRESH_SECRET 等于 JWT_SECRET 时启动失败
- 测试所有校验通过时正常启动

### 1.2 并发控制统一

**问题**：`updatePoolV2()` 缺少 `SELECT ... FOR UPDATE` 行级锁。

**修改文件**：
- 修改：`backend/dao/poolDao.js`（删除 updatePoolV2）
- 修改：`backend/services/poolService.js`（invest/redeem 改用 updatePool）

**实现**：
- 删除 `poolDao.js` 中的 `updatePoolV2()` 方法
- `poolService.invest()` 中 `updatePoolV2(...)` 改为 `updatePool(...)`
- `poolService.redeem()` 中 `updatePoolV2(...)` 改为 `updatePool(...)`
- `updatePool()` 内部使用 `SELECT ... FOR UPDATE` + 事务，确保原子性

**测试**：
- 并发投资10个请求，资金池金额一致
- 并发赎回10个请求，资金池金额一致
- 并发借款+还款，余额正确

### 1.3 TOCTOU竞态修复

**问题**：`loan.js` 中用户余额读取在事务之外。

**修改文件**：
- 修改：`backend/services/poolService.js`（事务内读取余额）
- 修改：`backend/routes/loan.js`（移除事务外的余额读取）

**实现**：
- `borrowFromPool()` 事务内添加 `SELECT ... FROM users WHERE id = ? FOR UPDATE`
- `repay()` 事务内添加 `SELECT ... FROM users WHERE id = ? FOR UPDATE`
- 路由层只做参数校验和权限检查，将 userId 直接传给 service 层
- service 层在事务内完成所有业务逻辑（余额检查 + 扣款 + 记录创建）

**测试**：
- 并发借款超出余额时只有一个成功
- 并发还款不出现双重扣款

### 1.4 MFA重置越权修复

**问题**：`POST /mfa/reset` 从 `req.body.userId` 取用户ID。

**修改文件**：
- 修改：`backend/routes/mfa.js`（第75行）

**实现**：
- `req.body.userId` 改为 `req.user.id`
- 确保只有用户自己能重置自己的MFA

**测试**：
- 用户A尝试重置用户B的MFA → 403 Forbidden
- 用户A重置自己的MFA → 200 OK

### 1.5 JWT密钥分离

**问题**：`JWT_REFRESH_SECRET` 未配置，回退到 `JWT_SECRET`。

**修改文件**：
- 修改：`backend/utils/authUtils.js`（移除回退逻辑）

**实现**：
- `keyValidator.js` 强制要求 `JWT_REFRESH_SECRET` 必须设置且不等于 `JWT_SECRET`
- `authUtils.js` 中 `process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET` 改为 `process.env.JWT_REFRESH_SECRET`

**测试**：
- 使用 access token 的 secret 无法伪造 refresh token
- refresh token 使用独立 secret 签发

### 1.6 其他修复

- **perfuser后门**：删除 `authUtils.js` 中 `bypassRateLimit` 逻辑（第21-23行）
- **数据隔离**：在 `loan.js` GET `/transactions/:userId`、`invest.js` GET `/:userId`、`pool.js` GET `/my-invest/:userId` 中添加 `req.user.id === parseInt(userId)` 显式校验
- **死代码清理**：删除 `backend/models/user.js`、`backend/models/transaction.js`、`backend/models/loan.js`（Mongoose 模型，未被运行时使用）

---

## 阶段2：国密完善

### 2.1 FISCO BCOS 切换 SM_SSL

**修改文件**：
- 修改：WSL 中 `~/fisco-bcos-node/127.0.0.1/node0/config.ini`
- 修改：WSL 中 FISCO BCOS SDK 配置

**实现**：
- `config.ini` 中 `ssl_type=ssl` 改为 `ssl_type=sm_ssl`
- 确保 `gmca.crt`、`gmsdk.crt`、`gmsdk.key` 在正确路径
- 重启 FISCO BCOS 节点
- 验证：`getClientVersion`、`getBlockNumber` 等基本 RPC 调用正常
- 验证：合约调用（读写）正常

**风险**：节点重启后数据应保留（使用相同数据目录）。如切换失败，可回退到 `ssl_type=ssl`。

**测试**：
- 节点启动成功，版本查询正常
- 合约读写操作正常
- 区块同步正常

### 2.2 Tengine NTLS 启用

**修改文件**：
- 修改：`scripts/start-system.sh`（添加 NTLS 启动步骤）
- 验证：`scripts/wsl/test-guomi-tls.sh`

**实现**：
- `start-system.sh` 中添加：
  ```bash
  # 启动 NTLS (SM2 双证书, port 8443)
  /usr/local/tengine-ntls/sbin/nginx -c nginx-ntls.conf
  ```
- 确保 `nginx-ntls.conf` 中证书路径正确
- 启动后验证 NTLS 握手

**测试**：
- 4种密码套件握手成功
- 反向代理到后端正常
- 标准 HTTPS (port 443) 仍然正常

### 2.3 前端 HTTPS 路由

**修改文件**：
- 修改：`frontend/src/setupProxy.js`

**实现**：
- 添加环境变量 `USE_HTTPS`（默认 `false`）
- `USE_HTTPS=true` 时 `HTTPS_TARGET` 默认为 `https://localhost:443`
- `start-system.sh` 中设置 `USE_HTTPS=true`

**测试**：
- `USE_HTTPS=true` 时前端通过 Tengine HTTPS 代理访问后端
- `USE_HTTPS=false` 时前端直接 HTTP 访问后端（开发模式）

### 2.4 端到端国密验证

**新增文件**：
- `scripts/wsl/test-e2e-guomi.sh`

**验证链路**：
```
前端 → Tengine(NTLS:8443, SM2+SM4+SM3) → 后端(:3003) → FISCO BCOS(SM_SSL, SM2+SM3)
```

记录每个环节使用的密码算法，确保全链路 SM2/SM3/SM4。

---

## 阶段3：区块链深化

### 3.1 部署 Verifier 合约

**修改文件**：
- 修改：`backend/contract-addresses.json`（添加 Verifier 地址）
- 修改：`backend/scripts/deploy-fisco.js`（添加 Verifier 部署）
- 更新：Console ABI 文件

**实现**：
- 使用 `deploy-fisco.js` 部署 `Verifier.sol` 到 FISCO BCOS
- 授权 deployer 为操作员（如有需要）
- 更新 `contract-addresses.json`
- 更新 Console ABI

**测试**：
- 部署成功，合约地址有效
- `verifyProof()` 方法可调用

### 3.2 双层 ZKP 验证

**修改文件**：
- 修改：`backend/services/zkService.js`（添加链上验证调用）
- 修改：`backend/services/blockchainServiceFisco.js`（添加 verifyProof 方法）

**实现**：
- `blockchainServiceFisco.js` 添加 `verifyZKPOnChain(proof, publicSignals)` 方法
  - 调用 `Verifier.verifyProof(pA, pB, pC, pubSignals)`
  - 返回 `{ success, isValid }`
- `zkService.js` 的 `verifyProof()` 方法中，snarkjs 验证成功后：
  1. 异步调用 `blockchainService.verifyZKPOnChain(proof, publicSignals)`
  2. 异步调用 `blockchainService.recordZKPResult(proofId, isValid, proofHash)`
  3. 如果链上验证与后端结果不一致，记录告警日志
- 两个链上调用都是异步非阻塞（`.then().catch()`）

**测试**：
- 有效证明 → 后端验证通过 + 链上验证通过
- 无效证明 → 后端验证失败，不调用链上验证
- 链上服务不可用时 → 后端验证仍正常，记录警告日志

### 3.3 验证 UX 完善

**修改文件**：
- 修改：`frontend/src/pages/BlockchainExplorer.js`
- 修改：`backend/routes/blockchain.js`

**实现**：
- 区块链浏览器中 ZKP 记录显示"链上验证"状态
- 新增 `GET /api/v1/blockchain/zkp-verify/:proofId` 接口
- 前端点击可查看链上验证详情（proofId、valid、timestamp）

### 3.4 健壮性优化

**修改文件**：
- 修改：`backend/services/blockchainServiceFisco.js`

**实现**：
- `blockchainServiceFisco.js` 中 `exec()` 调用添加 `{ timeout: 30000 }` 选项，覆盖所有 Console 子进程调用（`contractCall`、`sendTransaction` 等）
- 区块链服务初始化失败时设置 `this.isInitialized = false`，所有写入操作返回 `{ success: false, error: 'Service not initialized' }`
- 重试机制：`sendTransaction` 失败后最多重试2次，间隔1秒（仅对超时和网络错误重试，对合约 revert 不重试）

---

## 文件变更汇总

### 新增文件
| 文件 | 用途 |
|------|------|
| `backend/utils/keyValidator.js` | 密钥校验 |
| `scripts/wsl/test-e2e-guomi.sh` | 端到端国密验证 |

### 修改文件
| 文件 | 变更 |
|------|------|
| `backend/app.js` | 启动时调用 keyValidator |
| `backend/dao/poolDao.js` | 删除 updatePoolV2 |
| `backend/services/poolService.js` | invest/redeem 改用 updatePool，事务内读余额 |
| `backend/routes/loan.js` | 移除事务外余额读取，添加数据隔离校验 |
| `backend/routes/invest.js` | 添加数据隔离校验 |
| `backend/routes/pool.js` | 添加数据隔离校验 |
| `backend/routes/mfa.js` | MFA重置使用 req.user.id |
| `backend/routes/blockchain.js` | 添加 ZKP 验证查询接口 |
| `backend/utils/authUtils.js` | 移除回退逻辑和 perfuser 后门 |
| `backend/services/zkService.js` | 添加链上 ZKP 验证调用 |
| `backend/services/blockchainServiceFisco.js` | 添加 verifyZKPOnChain、超时、重试 |
| `backend/scripts/deploy-fisco.js` | 添加 Verifier 部署 |
| `backend/contract-addresses.json` | 添加 Verifier 地址 |
| `frontend/src/setupProxy.js` | 添加 USE_HTTPS 环境变量 |
| `frontend/src/pages/BlockchainExplorer.js` | ZKP 验证状态显示 |
| `scripts/start-system.sh` | 添加 NTLS 启动、HTTPS 环境变量 |
| `backend/.env.example` | 占位符（不含真实密钥） |

### 删除文件
| 文件 | 原因 |
|------|------|
| `backend/models/user.js` | 死代码（Mongoose 模型未使用） |
| `backend/models/transaction.js` | 死代码 |
| `backend/models/loan.js` | 死代码 |

---

## 测试策略

每个修复点对应测试用例：

| 修复点 | 测试类型 | 验证内容 |
|--------|----------|----------|
| 密钥校验 | 单元测试 | 缺失/弱密钥时启动失败 |
| 并发控制 | 集成测试 | 并发操作后资金池一致 |
| TOCTOU | 集成测试 | 并发借款不超余额 |
| MFA越权 | 安全测试 | 跨用户重置被拒绝 |
| JWT分离 | 单元测试 | token 不能互换 |
| FISCO SM_SSL | 集成测试 | 节点操作正常 |
| NTLS | 端到端测试 | 4种密码套件握手 |
| 前端HTTPS | 端到端测试 | 通过HTTPS访问正常 |
| Verifier部署 | 集成测试 | 合约可调用 |
| 双层ZKP | 集成测试 | 有效/无效证明正确处理 |
