# FinZkTrust 区块链集成说明文档

## 国密SM3+私链不可篡改+ZK零知识隐私核验三合一安全架构

---

## 一、系统架构概述

### 1.1 核心设计理念

本系统采用**三层安全架构**，将国密算法、区块链技术和零知识证明有机结合：

```
┌─────────────────────────────────────────────────────────────┐
│                    应用层 (Application)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   借款模块   │  │   还款模块   │  │    信用证明模块      │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
└─────────┼────────────────┼────────────────────┼─────────────┘
          │                │                    │
          ▼                ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   服务层 (Service Layer)                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              区块链服务 (blockchainService)           │   │
│  │  • SM3哈希生成  • 自动签名上链  • 交易验证  • 批量处理 │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │  零知识证明服务   │  │         国密算法服务             │  │
│  │  (zkService)    │  │      (cryptoUtils)              │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                   区块链层 (Blockchain)                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         TransactionHashStorage 智能合约              │   │
│  │  • 存储交易SM3哈希  • 验证数据完整性  • 事件日志      │   │
│  └─────────────────────────────────────────────────────┘   │
│              Hardhat 本地私链 (Chain ID: 31337)              │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 技术特点

| 特性 | 实现方式 | 安全价值 |
|------|----------|----------|
| **国密SM3** | 对交易数据进行SM3哈希计算 | 符合国密标准，哈希值唯一性 |
| **私链存证** | Hardhat本地链存储SM3哈希 | 不可篡改，可追溯 |
| **ZK零知识** | 信用评分验证不泄露原始数据 | 隐私保护 |
| **自动签名** | 内置私钥自动完成链上交易 | 用户无感知，体验友好 |

---

## 二、快速启动指南

### 2.1 环境准备

确保已安装：
- Node.js (v16+)
- npm 或 yarn
- Git

### 2.2 安装依赖

```bash
# 1. 安装后端依赖
cd backend
npm install

# 2. 安装合约依赖
cd ../contracts
npm install
```

### 2.3 启动系统（一键启动）

#### 方式一：使用启动脚本（推荐）

```bash
# 在项目根目录执行
start-blockchain-system.bat
```

#### 方式二：手动启动

**步骤1：启动 Hardhat 本地节点**

```bash
cd contracts
npx hardhat node
```

**步骤2：部署智能合约**（新开一个终端）

```bash
cd contracts
npx hardhat run scripts/deploy.js --network localhost
```

**步骤3：启动后端服务**

```bash
cd backend
npm run dev
```

### 2.4 验证系统状态

访问以下接口验证区块链功能：

```bash
# 查看区块链服务状态
curl http://localhost:3003/api/v1/loan/blockchain-status

# 预期响应：
{
  "success": true,
  "status": {
    "isInitialized": true,
    "contractAddress": "0x...",
    "walletAddress": "0x...",
    "network": {
      "url": "http://127.0.0.1:8545",
      "chainId": 31337,
      "name": "Hardhat Local"
    },
    "transactionCount": 0
  }
}
```

---

## 三、核心功能说明

### 3.1 自动上链存证

#### 触发场景

以下业务操作成功后，系统会自动将交易哈希上链存证：

1. **借款成功** (`POST /api/v1/loan/borrow`)
2. **还款成功** (`POST /api/v1/loan/repay`)
3. **信用证明生成** (`POST /api/v1/credit/generate-proof`)

#### 上链数据格式

```javascript
{
  transactionId: "唯一交易ID",
  sm3Hash: "交易数据的SM3哈希值",
  transactionType: "loan/repay/credit_proof",
  userId: "用户ID",
  timestamp: "区块时间戳",
  submitter: "提交者地址"
}
```

#### 代码示例

```javascript
// 异步上链存证 - 不阻塞主业务流程
blockchainService.storeTransactionHash(
  transactionId,
  transactionData,
  'loan',
  userId
).then(result => {
  if (result.success) {
    logger.info('交易哈希上链存证成功', {
      blockchainTxHash: result.blockchainTxHash,
      blockNumber: result.blockNumber
    });
  }
});
```

### 3.2 交易验证

#### 验证接口

```bash
POST /api/v1/loan/verify-transaction
Content-Type: application/json

{
  "transactionId": "交易ID",
  "transactionData": { /* 交易数据 */ }
}
```

#### 验证流程

```
┌──────────────┐
│  输入交易ID   │
│ 和交易数据   │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ 计算当前数据SM3   │
│ 哈希值           │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ 从区块链读取存储  │
│ 的SM3哈希值      │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│ 比对两个哈希值   │
│ 是否一致         │
└──────┬───────────┘
       │
   ┌───┴───┐
   ▼       ▼
┌─────┐  ┌─────┐
│一致 │  │不一致│
│验证通过│  │数据被篡改│
└─────┘  └─────┘
```

### 3.3 批量哈希处理

系统支持批量交易哈希处理，优化性能：

```javascript
// 批量生成SM3哈希
const hashes = blockchainService.generateSM3Hash([
  transaction1,
  transaction2,
  transaction3
]);

// 批量上链存证
const results = await blockchainService.storeTransactionHashesBatch([
  { transactionId: '1', transactionData: data1, transactionType: 'loan', userId: 'user1' },
  { transactionId: '2', transactionData: data2, transactionType: 'repay', userId: 'user2' }
]);
```

---

## 四、智能合约说明

### 4.1 合约地址

部署后自动保存到以下文件：
- `contracts/contract-address-local.json`
- `backend/contract-addresses.json`

### 4.2 核心方法

| 方法 | 功能 | 参数 |
|------|------|------|
| `storeTransactionHash` | 存储交易哈希 | transactionId, sm3Hash, transactionType, userId |
| `getTransactionHash` | 查询交易哈希 | transactionId |
| `verifyTransactionHash` | 验证交易哈希 | transactionId, calculatedHash |
| `getTransactionCount` | 获取交易总数 | 无 |
| `transactionExists` | 检查交易是否存在 | transactionId |

### 4.3 事件日志

```solidity
event TransactionHashStored(
    bytes32 indexed transactionId,
    bytes32 sm3Hash,
    string transactionType,
    string userId,
    uint256 timestamp,
    address submitter
);
```

---

## 五、安全特性

### 5.1 国密合规

- 使用 **SM3** 哈希算法（国家密码管理局批准）
- 使用 **SM2** 签名算法进行身份验证
- 符合《密码法》和网络安全等级保护要求

### 5.2 数据隐私保护

- **原始数据不上链**：仅存储SM3哈希值
- **零知识证明**：信用验证不泄露原始信用数据
- **哈希单向性**：无法从哈希反推原始数据

### 5.3 不可篡改性

- 区块链的链式结构保证数据不可篡改
- 每个区块包含前一个区块的哈希
- 任何数据修改都会导致哈希验证失败

### 5.4 故障容错

- 区块链服务初始化失败不阻塞系统启动
- 上链失败不影响主业务流程
- 自动重试和错误日志记录

---

## 六、竞赛评分点对应

| 评分点 | 实现方式 | 验证方法 |
|--------|----------|----------|
| **国密算法应用** | SM3哈希、SM2签名 | 查看 `cryptoUtils.js` |
| **区块链技术** | Hardhat私链存证 | 查看区块链浏览器或调用验证接口 |
| **零知识证明** | ZK-SNARKs信用验证 | 查看 `zkService.js` |
| **数据完整性** | 哈希比对验证 | 调用 `/verify-transaction` 接口 |
| **隐私保护** | 原始数据不上链 | 查看智能合约存储内容 |

---

## 七、常见问题

### Q1: 如何确认交易已上链？

查看后端日志，搜索 "交易哈希上链存证成功" 关键字，或调用状态接口查看交易计数。

### Q2: 区块链服务启动失败怎么办？

检查：
1. Hardhat节点是否已启动 (`npx hardhat node`)
2. 合约是否已部署
3. 端口8545是否被占用

### Q3: 如何查看链上数据？

使用Hardhat控制台：
```bash
cd contracts
npx hardhat console --network localhost

# 查询交易
const contract = await ethers.getContractAt("TransactionHashStorage", "合约地址");
await contract.getTransactionCount();
```

---

## 八、技术栈总结

| 层级 | 技术 | 版本 |
|------|------|------|
| 区块链 | Hardhat | ^2.12.7 |
| 智能合约 | Solidity | ^0.8.19 |
| 国密算法 | sm-crypto | ^0.4.0 |
| 零知识证明 | snarkjs | ^0.7.6 |
| 区块链交互 | ethers.js | ^5.7.2 |

---

**文档版本**: v1.0  
**更新日期**: 2026-03-28  
**作者**: FinZkTrust 开发团队
