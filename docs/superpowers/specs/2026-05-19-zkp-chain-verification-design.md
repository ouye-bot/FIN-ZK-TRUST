# ZKP 链上验证修复设计

**日期**: 2026-05-19
**状态**: 待审阅
**范围**: 修复 Phase 3 三个已知架构限制，打通 ZKP 链上验证完整闭环

---

## 1. 背景与问题

Phase 3 区块链功能加固完成后，ZKP 链上验证存在三个未解决的架构限制：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| 1 | FISCO BCOS 合约地址配置缺少 Verifier 地址 | 严重 |
| 2 | `verifyZKPOnChain` 传参 4 个，合约需要 6 个 | 严重 |
| 3 | FISCO BCOS Console 无法序列化 `uint[2][2]` 嵌套数组 | 严重 |
| 4 | Hardhat 模式 `verifyZKPOnChain` 未实现 | 中等 |
| 5 | BlockchainExplorer 的 `chainVerified`/`chainValid` 字段无数据源 | 中等 |

根本原因：FISCO BCOS 的 Java Console 子进程无法处理 Solidity 的嵌套数组类型，而 ZKP proof 结构中的 `uint[2][2] _pB` 正是嵌套数组。

## 2. 设计决策

### 2.1 方案选择

| 方案 | 描述 | 优点 | 缺点 |
|------|------|------|------|
| **A: ethers ABI + sendRawTransaction** | 用 ethers.js 做 ABI 编码，通过 JSON-RPC sendRawTransaction 发交易 | 复用现有依赖和模式，风险最低 | 需要处理 ABI 编码细节 |
| B: 展平 proof 结构 | 修改 Verifier.sol，`uint[2][2]` 改为 `uint[4]` | Console 可直接调用 | 修改密码学合约，有安全风险 |
| C: 引入 web3js-sdk | 用 FISCO 官方 SDK | API 语义化 | 引入新依赖，违反红线 |

**选择方案 A**。ethers v5 已在项目中，`deploy-fisco.js` 已验证 sendRawTransaction 模式可行。

### 2.2 验证策略

链上 ZKP 验证采用**异步验证、结果存证**模式：
- 链下 snarkjs 验证（同步）完成后立即返回业务结果
- 链上验证异步执行，不阻塞用户请求
- 验证结果写入 ZKPVerifier 合约存证
- 前端可查询验证状态

### 2.3 区块链优先级

联盟链（FISCO BCOS）为主，Hardhat 仅作为联盟链完全不可用时的应急备选。

## 3. 架构设计

### 3.1 数据流

```
前端 CreditProof.js
  └─ POST /api/v1/credit/generate-proof
       └─ zkService.verifyProof()
            ├─ snarkjs.groth16.verify() [链下验证，同步]
            ├─ 验证成功 → 返回结果给前端（不等待链上）
            └─ 异步后台：
                 ├─ recordZKPResult() → ZKPVerifier 合约（存证，已有）
                 └─ verifyZKPOnChain() → Verifier 合约（密码学验证，新增）
                      └─ updateZKPChainStatus() → ZKPVerifier 合约

前端 BlockchainExplorer.js
  └─ GET /api/v1/blockchain/explorer
       └─ ZKP 记录包含 chainVerified / chainValid 字段
            └─ 点击查看详情 → GET /api/v1/blockchain/zkp-verify/:proofId
```

### 3.2 职责划分

| 层 | 职责 | 改动 |
|---|------|------|
| `blockchainServiceFisco.js` | 新增 `_sendRawTransaction()`，修复 `verifyZKPOnChain()` | 核心改动 |
| `blockchainServiceHardhat.js` | 实现 `verifyZKPOnChain()`，用 ethers 直接调用 | 新增实现 |
| `blockchainService.js` | Proxy 透明转发 | 无改动 |
| `zkService.js` | 异步验证 + 调用 `updateZKPChainStatus` | 微调 |
| `contract-addresses.json` | 补充 Verifier 地址 | 配置 |
| `ZKPVerifier.sol` | 扩展 `chainVerified`/`chainValid` 字段 | 合约升级 |
| `BlockchainExplorer.js` | ZKP 状态标签 + 详情弹窗 | 前端 |

## 4. 详细设计

### 4.1 `_sendRawTransaction` 方法

新增于 `blockchainServiceFisco.js`，专门处理需要复杂 ABI 编码的合约调用：

```javascript
async _sendRawTransaction(contractName, methodName, params) {
  // 1. 读取合约 ABI（从 contracts/artifacts/）
  const abi = loadContractABI(contractName);
  const address = getContractAddress(contractName);

  // 2. ethers ABI 编码（原生支持 uint[2][2] 等嵌套数组）
  const iface = new ethers.utils.Interface(abi);
  const data = iface.encodeFunctionData(methodName, params);

  // 3. 构造交易（复用 deploy-fisco.js 模式）
  const tx = { to: address, data, groupId: this.groupId, chainId: this.chainId };

  // 4. 签名 + JSON-RPC sendRawTransaction
  const signedTx = await wallet.signTransaction(tx);
  const txHash = await this._rpcCall('sendRawTransaction', [this.groupId, signedTx]);
  return txHash;
}
```

与现有方法的关系：
- `contractCall`/`contractSend`（Console 方式）保持不变，用于简单参数的调用
- `_sendRawTransaction` 仅用于 `verifyZKPOnChain` 等需要嵌套数组参数的调用
- `_sendRawTransaction` 需要等待交易回执（polling receipt），判断交易是否成功（`status === '0x1'`）

### 4.2 `verifyZKPOnChain` 修复

参数从 4 个补全到 6 个：

```javascript
// blockchainServiceFisco.js
async verifyZKPOnChain(proof, publicSignals, userAddress, sm3Hash) {
  const pA = [proof.pi_a[0], proof.pi_a[1]];
  const pB = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]];
  const pC = [proof.pi_c[0], proof.pi_c[1]];
  const pubSignals = publicSignals.map(s => s.toString());

  const txHash = await this._sendRawTransaction('Verifier', 'verifyProof',
    [userAddress, pA, pB, pC, pubSignals, sm3Hash]);
  return { success: true, txHash };
}
```

```javascript
// blockchainServiceHardhat.js
async verifyZKPOnChain(proof, publicSignals, userAddress, sm3Hash) {
  const verifier = new ethers.Contract(verifierAddress, verifierABI, this.signer);
  // 同样的参数构造...
  const tx = await verifier.verifyProof(userAddress, pA, pB, pC, pubSignals, sm3Hash);
  const receipt = await tx.wait();
  return { success: true, txHash: receipt.transactionHash };
}
```

### 4.3 ZKPVerifier.sol 扩展

扩展 `ProofResult` 结构体，新增链上验证状态字段：

```solidity
struct ProofResult {
    bool valid;           // 链下 snarkjs 验证结果
    uint256 timestamp;
    address submitter;
    string proofHash;
    bool chainVerified;   // 新增：是否已执行链上验证
    bool chainValid;      // 新增：链上验证结果
}
```

新增方法：

```solidity
function updateChainStatus(bytes32 proofId, bool chainValid) public onlyAuthorized returns (bool);
```

### 4.4 zkService.js 异步验证调整

验证成功后异步执行链上验证，不阻塞返回：

```javascript
(async () => {
  try {
    const chainResult = await blockchainService.verifyZKPOnChain(
      proof, publicSignals, userAddress, sm3Hash);
    await blockchainService.updateZKPChainStatus(proofId, chainResult.success);
  } catch (err) {
    logger.error('ZKP 链上验证失败', { proofId, error: err.message });
  }
})();
```

### 4.5 前端 BlockchainExplorer

**ZKP 记录状态标签**：
- `chainVerified=true, chainValid=true` → 绿色"链上验证通过"
- `chainVerified=true, chainValid=false` → 红色"链上验证失败"
- `chainVerified=false` → 灰色"待验证"

**详情弹窗**（`ZKPDetailModal` 组件）：
- 调用 `GET /api/v1/blockchain/zkp-verify/:proofId`
- 展示：proofId、proofHash、链下验证结果、链上验证结果、验证时间、提交者地址
- 验证中状态显示 loading spinner

### 4.6 后端路由补充

`GET /api/v1/blockchain/explorer` 对 ZKP 类型记录补充 chainVerified 字段：

```javascript
if (record.type === 'zkp') {
  const zkpResult = await blockchainService.getZKPResult(record.proofId);
  if (zkpResult) {
    record.chainVerified = zkpResult.chainVerified;
    record.chainValid = zkpResult.chainValid;
    record.onChainTimestamp = zkpResult.timestamp;
  }
}
```

## 5. 错误处理

| 场景 | 处理 |
|------|------|
| Verifier 合约地址未配置 | 返回 `{ success: false, error }`，记 warn 日志 |
| sendRawTransaction 超时 | 重试 2 次（复用现有逻辑），仍失败记录 `chainValid=false` |
| ABI 编码失败 | 捕获异常，记 error 日志，不影响业务返回 |
| 链上/链下验证不一致 | 记 warn 日志，ZKPVerifier 记录 `chainValid=false` |

## 6. 改动文件清单

| 文件 | 改动类型 |
|------|---------|
| `backend/services/blockchainServiceFisco.js` | 核心：新增 `_sendRawTransaction()`、`updateZKPChainStatus()`，修复 `verifyZKPOnChain()` |
| `backend/services/blockchainServiceHardhat.js` | 新增：实现 `verifyZKPOnChain()`、`updateZKPChainStatus()` |
| `backend/services/zkService.js` | 微调：异步验证流程 |
| `backend/routes/blockchain.js` | 微调：`/explorer` 返回数据补充字段 |
| `backend/contract-addresses.json` | 配置：补充 Verifier 地址 |
| `contracts/contracts/ZKPVerifier.sol` | 合约升级：扩展结构体 + 新增方法 |
| `frontend/src/pages/BlockchainExplorer.js` | 前端：状态标签 + 详情弹窗 |

## 7. 部署顺序

1. 重新编译 ZKPVerifier.sol（结构体变更）
2. 部署新 ZKPVerifier 合约到 FISCO BCOS
3. 更新 `contract-addresses.json` 中的 ZKPVerifier 和 Verifier 地址
4. 重启后端服务

## 8. 兼容性

- 旧 ZKP 记录（无 `chainVerified` 字段）前端显示为"待验证"
- 不影响现有 `recordZKPResult` 流程
- `contractCall`/`contractSend`（Console 方式）保持不变
- 不引入新 npm 依赖
- 不修改 snarkJS 生成的 Verifier.sol
