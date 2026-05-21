# 国密合规完善设计

> **交付场景**：答辩/演示
> **目标**：完善全链路国密通信能力，清理死代码，改进公钥链上管理

## 架构总览

```
浏览器 ──NTLS(SM2+SM4)──▶ Tengine:8443 ──HTTP──▶ Node.js:3003 ──HTTP──▶ FISCO BCOS:8545
                              │                                              │
                              └──▶ Frontend:3000                      JSON-RPC (业务调用)

演示验证:
Tongsuo s_client ──SM_SSL──▶ FISCO BCOS:20200 (Channel)
    ↑ 单独验证节点国密能力，不经过后端
```

**关键设计决策**：
- FISCO BCOS 的 JSON-RPC 端口(8545) 不支持 SM_SSL，Channel 端口(20200) 使用私有协议
- Tengine 无法代理 Channel 协议（非标准 HTTP）
- 因此区块链层 SM_SSL 通过单独演示 Tongsuo 握手来验证，后端继续用 JSON-RPC

---

## 模块 1：前端 NTLS 国密通信

### 目标
用户通过 SM2+SM4 国密 TLS 访问系统前端页面。

### 现有资源
- `scripts/wsl/setup-guomi-tls.sh` — 编译 Tongsuo + Tengine，生成 SM2 CA/服务器证书
- `nginx-ntls.conf` — Tengine 配置，SM2 双证书（签名+加密），端口 8443
- `scripts/wsl/test-guomi-tls.sh` — 测试 4 种国密套件握手
- `scripts/wsl/test-e2e-guomi.sh` — 全链路端到端验证

### 实施步骤
1. WSL 中执行 `setup-guomi-tls.sh`（编译 Tongsuo + Tengine + 生成证书）
2. 启动 Tengine：`tengine -c nginx-ntls.conf`
3. 验证 NTLS 握手：`curl --ntls --tls13 -ciphers ECC-SM2-SM4-CBC-SM3 https://localhost:8443/`
4. 答辩演示：展示 NTLS 握手 + 页面正常加载

### 支持的国密套件
- `ECC-SM2-SM4-CBC-SM3`
- `ECC-SM2-SM4-GCM-SM3`
- `ECDHE-SM2-SM4-CBC-SM3`
- `ECDHE-SM2-SM4-GCM-SM3`

### 代码改动
无。仅需运行现有脚本。

---

## 模块 2：区块链 SM_SSL 演示

### 目标
证明 FISCO BCOS 节点已开启国密 SM_SSL 通信。

### 方案
1. 确认 FISCO BCOS 节点运行中，`config.ini` 中 `ssl_type=sm_ssl`
2. 验证 Channel 端口 20200 监听
3. 用 Tongsuo `s_client` 连接 20200，展示 SM_SSL 握手过程
4. 后端继续用 JSON-RPC(8545) 调合约（不影响业务）

### 新增脚本
`scripts/wsl/verify-sm-ssl.sh`：
```bash
#!/bin/bash
# 验证 FISCO BCOS SM_SSL
echo "=== 验证 FISCO BCOS SM_SSL 配置 ==="
# 检查节点配置
cat ~/fisco-bcos-node/node1/config.ini | grep ssl_type
# 检查端口监听
netstat -tlnp | grep 20200
# SM_SSL 握手测试
tongsuo s_client -connect 127.0.0.1:20200 -ntls \
  -cert ~/sm2-certs/sm2-sign.crt \
  -key ~/sm2-certs/sm2-sign.key \
  -CAfile ~/sm2-certs/sm2-ca.crt
```

### 代码改动
无后端代码改动。

---

## 模块 3：清理死代码合约

### 目标
移除 3 个未使用的合约，减少部署复杂度。

### 清理清单

| 合约 | 操作 | 理由 |
|------|------|------|
| TransactionHashStorage.sol | 从部署脚本移除，保留后端方法（内部走 AuditStorage） | 已部署但未使用，storeTransactionHash 内部委托给 AuditStorage |
| UserRegistry.sol | 删除 .sol + ABI | 从未部署，从未被后端引用，公钥锚定走 AuditStorage |
| FinZkTrust.sol | 删除 .sol | 早期单体设计，已被 AuditStorage+ZKPVerifier+Verifier 模块化替代 |

### 改动文件
- `contracts/contracts/` — 删除 UserRegistry.sol, FinZkTrust.sol
- `contracts/artifacts/` — 删除对应 ABI 文件
- `backend/contracts/output/` — 删除旧版 ABI（UserRegistry.abi, 旧版 AuditStorage.abi, 旧版 ZKPVerifier.abi）
- `backend/scripts/deploy-fisco.js` — 移除 TransactionHashStorage 部署代码
- `backend/scripts/deploy.js`（Hardhat）— 移除 TransactionHashStorage 部署
- `backend/services/blockchainServiceHardhat.js` — 移除 TransactionHashStorage 加载

### 不改动
- `blockchainServiceFisco.js` — 从未加载这些合约，不受影响
- `AuditStorage` 合约 — 保留，是核心存证合约

---

## 模块 4：公钥锚定改进

### 目标
1. 链上存储完整 SM2 公钥（而非仅哈希），支持第三方独立验证
2. 公钥锚定改为同步，保证 DB 与链上状态一致

### 4a. PublicKeyRegistry 合约（新建）

**文件**：`contracts/contracts/PublicKeyRegistry.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract PublicKeyRegistry {
    struct PublicKeyRecord {
        bytes32 pkHash;      // SM3(publicKey)
        string  publicKey;   // 完整 SM2 公钥 (04开头, 130字符hex)
        uint256 timestamp;
        uint256 version;     // 密钥版本号，每次更新+1
        bool    active;
    }
    
    address public operator;
    mapping(string => PublicKeyRecord[]) private records;
    
    modifier onlyOperator() {
        require(msg.sender == operator, "Not authorized");
        _;
    }
    
    event PublicKeyRegistered(string userId, bytes32 pkHash, uint256 version);
    event PublicKeyRevoked(string userId, bytes32 pkHash, uint256 version);
    
    constructor() {
        operator = msg.sender;
    }
    
    function register(
        string calldata userId,
        bytes32 pkHash,
        string calldata publicKey
    ) external onlyOperator returns (uint256 version) {
        // 撤销旧密钥
        _revokeAll(userId);
        // 注册新密钥
        version = records[userId].length + 1;
        records[userId].push(PublicKeyRecord({
            pkHash: pkHash,
            publicKey: publicKey,
            timestamp: block.timestamp,
            version: version,
            active: true
        }));
        emit PublicKeyRegistered(userId, pkHash, version);
    }
    
    function revoke(string calldata userId, bytes32 pkHash) external onlyOperator {
        _revoke(userId, pkHash);
    }
    
    function getActiveKey(string calldata userId) 
        external view returns (PublicKeyRecord memory) 
    {
        PublicKeyRecord[] storage recs = records[userId];
        for (uint i = recs.length; i > 0; i--) {
            if (recs[i-1].active) return recs[i-1];
        }
        revert("No active key");
    }
    
    function getKeyHistory(string calldata userId) 
        external view returns (PublicKeyRecord[] memory) 
    {
        return records[userId];
    }
    
    function _revokeAll(string storage userId) internal {
        PublicKeyRecord[] storage recs = records[userId];
        for (uint i = 0; i < recs.length; i++) {
            if (recs[i].active) {
                recs[i].active = false;
                emit PublicKeyRevoked(userId, recs[i].pkHash, recs[i].version);
            }
        }
    }
    
    function _revoke(string storage userId, bytes32 pkHash) internal {
        PublicKeyRecord[] storage recs = records[userId];
        for (uint i = 0; i < recs.length; i++) {
            if (recs[i].active && recs[i].pkHash == pkHash) {
                recs[i].active = false;
                emit PublicKeyRevoked(userId, pkHash, recs[i].version);
                return;
            }
        }
    }
}
```

### 4b. 同步锚定

**现状**：注册 → DB写入 → 异步队列锚定（可能失败，3次重试后放弃）
**改进**：注册 → 链上锚定 → DB写入（链上失败则整个操作失败）

**改动文件**：
- `routes/auth.js` — 注册时调用 `blockchainService.registerPublicKey()`，同步等待结果
- `routes/user.js` — 更新公钥时调用 `blockchainService.registerPublicKey()`，同步等待

### 4c. 区块链服务新增方法

`blockchainServiceFisco.js` 和 `blockchainServiceHardhat.js` 各新增：
- `registerPublicKey(userId, publicKey)` — 调用 PublicKeyRegistry.register()
- `revokePublicKey(userId, pkHash)` — 调用 PublicKeyRegistry.revoke()
- `getActivePublicKey(userId)` — 调用 PublicKeyRegistry.getActiveKey()
- `getPublicKeyHistory(userId)` — 调用 PublicKeyRegistry.getKeyHistory()

### 4d. 部署脚本更新

- `deploy-fisco.js` — 新增 PublicKeyRegistry 合约部署
- `deploy.js`（Hardhat）— 新增 PublicKeyRegistry 合约部署
- `contract-addresses.json` — 新增 PublicKeyRegistry 地址

---

## 验证计划

### 答辩演示脚本

1. **前端 NTLS 演示**
   - 展示 Tengine 配置（SM2 双证书）
   - 用 curl NTLS 握手并加载页面
   - 展示国密套件协商过程

2. **区块链 SM_SSL 演示**
   - 展示 FISCO BCOS 节点配置 `ssl_type=sm_ssl`
   - 用 Tongsuo 连接 Channel 端口，展示 SM_SSL 握手
   - 展示后端通过 JSON-RPC 成功调用合约

3. **公钥全生命周期演示**
   - 注册用户 → 展示链上公钥记录
   - 更新公钥 → 展示旧密钥撤销 + 新密钥注册
   - 查询公钥历史 → 展示版本链

4. **合约清理验证**
   - 展示部署脚本只部署 4 个合约（AuditStorage, ZKPVerifier, Verifier, PublicKeyRegistry）
   - 展示所有业务功能正常

---

## 文件变更汇总

### 新增
- `contracts/contracts/PublicKeyRegistry.sol` — 公钥注册合约
- `scripts/wsl/verify-sm-ssl.sh` — SM_SSL 验证脚本

### 修改
- `backend/scripts/deploy-fisco.js` — 新增 PublicKeyRegistry 部署，移除 TransactionHashStorage
- `backend/scripts/deploy.js` — 同上
- `backend/services/blockchainServiceHardhat.js` — 新增公钥方法，移除 TransactionHashStorage
- `backend/services/blockchainServiceFisco.js` — 新增公钥方法
- `backend/routes/auth.js` — 同步公钥锚定
- `backend/routes/user.js` — 同步公钥锚定

### 删除
- `contracts/contracts/UserRegistry.sol`
- `contracts/contracts/FinZkTrust.sol`
- `backend/contracts/output/UserRegistry.abi`
- `backend/contracts/output/AuditStorage.abi`（旧版）
- `backend/contracts/output/ZKPVerifier.abi`（旧版）
