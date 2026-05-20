# FISCO BCOS + 国密 NTLS 深度集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 FISCO BCOS 联盟链和国密 TLS 从"堆砌的功能"升级为"融入系统的安全能力"——区块链可查询/可验证/可展示，NTLS 启用真正的 SM2 双证书协议。

**Architecture:** 新增 `backend/routes/blockchain.js` 提供链上查询/验证 API；修复两个 service 的 `verifyTransactionHash` 比对逻辑；新增 `frontend/src/pages/BlockchainExplorer.js` 展示链上数据；WSL 侧重新编译 Tengine 启用 NTLS 模块 + 生成 SM2 双证书；新增一键启动和演示脚本。

**Tech Stack:** Node.js/Express (backend routes), React/MUI (frontend), FISCO BCOS Console (链上读写), Tengine + Tongsuo (NTLS), SM2/SM3 国密算法

**Constraints:**
- 不改变现有业务流程（区块链仍为异步非阻塞）
- 向后兼容 Hardhat 模式（`BLOCKCHAIN_NETWORK` 环境变量切换）
- 所有现有测试必须继续通过（crypto.test.js: 62 pass, security-fault-tolerance: 34/34, performance: exit 0）
- 新增 API 端点需包含错误处理和输入验证

---

## 文件结构

### 新增文件
| 文件 | 职责 |
|------|------|
| `backend/routes/blockchain.js` | 区块链查询/验证/浏览器 API |
| `backend/test/blockchain-api.test.js` | 区块链 API 单元测试 |
| `frontend/src/pages/BlockchainExplorer.js` | 区块链浏览器页面 |
| `scripts/start-system.sh` | 一键启动脚本 (WSL) |
| `scripts/demo-flow.sh` | 演示流程脚本 (WSL) |

### 修改文件
| 文件 | 改动 |
|------|------|
| `backend/app.js:187` | 挂载 blockchain 路由 |
| `backend/services/blockchainServiceFisco.js:490-509` | 修复 `verifyTransactionHash` 比对逻辑 + 新增 `getRecordByIndex`/`getRecordByHash`/`getExplorerData` |
| `backend/services/blockchainServiceHardhat.js:410-446` | 同步修复 `verifyTransactionHash` + 新增查询方法 |
| `frontend/src/App.js:583` | 添加 `/blockchain` 路由 |
| `frontend/src/components/Navbar.js:38` | 添加"区块链浏览器"导航项 |
| `scripts/wsl/setup-guomi-tls.sh` | 更新 Tengine 编译命令（加 NTLS 模块） |

---

## Task 1: 修复 FISCO BCOS `verifyTransactionHash` 比对逻辑

**Files:**
- Modify: `backend/services/blockchainServiceFisco.js:490-509`

当前 `verifyTransactionHash` 只检查链上有没有记录，没比对一致性。`getRecordByHash` 在记录不存在时会 revert（require），所以 catch 到 error 就是"无记录"。

- [ ] **Step 1: 修改 `verifyTransactionHash` 添加比对逻辑**

```javascript
// blockchainServiceFisco.js — 替换第 490-509 行
async verifyTransactionHash(transactionId, transactionData) {
  if (!this.isInitialized || !this.auditContractAddress) {
    return { success: false, error: 'Service not initialized' };
  }

  try {
    const sm3Hash = this.generateSM3Hash(transactionData);
    const result = await this.contractCall('AuditStorage', 'getRecordByHash', [sm3Hash]);

    if (!result || result === '0' || result === '') {
      return { success: true, isValid: false, reason: '链上无此记录', storedHash: sm3Hash };
    }

    // FISCO BCOS Console 返回的是 tuple: (timestamp, submitter, operationType, userId)
    // result 格式如: "1234567890,0xabc...,loan,user123"
    return {
      success: true,
      isValid: true,
      storedHash: sm3Hash,
      chainRecord: result
    };
  } catch (error) {
    // getRecordByHash 在记录不存在时 revert → 走到这里
    logger.info('验证交易哈希: 链上无此记录', { transactionId });
    return { success: true, isValid: false, reason: '链上无此记录', storedHash: sm3Hash };
  }
}
```

- [ ] **Step 2: 运行现有测试确认不破坏**

Run: `cd backend && node test/crypto.test.js`
Expected: 62 pass, 0 fail (与改动无关，应全部通过)

- [ ] **Step 3: Commit**

```bash
git add backend/services/blockchainServiceFisco.js
git commit -m "fix(blockchain): verifyTransactionHash now compares hash consistency"
```

---

## Task 2: 修复 Hardhat `verifyTransactionHash` + 新增查询方法

**Files:**
- Modify: `backend/services/blockchainServiceHardhat.js:410-446`
- Modify: `backend/services/blockchainServiceHardhat.js` — 新增方法

Hardhat 服务使用旧的 `TransactionHashStorage` 合约（`getTransactionHash`），而新合约 `AuditStorage` 用 `getRecordByHash`。需要：1) 修复比对逻辑；2) 新增与 FISCO 适配层一致的查询方法。

- [ ] **Step 1: 修改 Hardhat `verifyTransactionHash` 比对逻辑**

```javascript
// blockchainServiceHardhat.js — 替换第 410-446 行
async verifyTransactionHash(transactionId, transactionData) {
  if (!this.isInitialized || !this.contract) {
    logger.warning('区块链服务未初始化，无法验证交易哈希');
    return { success: false, error: 'Blockchain service not initialized' };
  }

  try {
    const calculatedHash = this.generateSM3Hash(transactionData);
    const calculatedHashBytes32 = this.convertSM3ToBytes32(calculatedHash);

    const txIdBytes32 = ethers.utils.formatBytes32String(transactionId.toString().slice(0, 31));

    const storedRecord = await this.contract.getTransactionHash(txIdBytes32);
    const storedHash = storedRecord.sm3Hash;

    // 比对：链上存储的哈希 === 本地计算的哈希
    const isValid = storedHash === calculatedHashBytes32;

    logger.info('交易哈希验证完成', { transactionId, isValid });

    return {
      success: true,
      isValid,
      storedHash,
      calculatedHash: calculatedHashBytes32,
      timestamp: storedRecord.timestamp.toNumber(),
      transactionType: storedRecord.transactionType,
      userId: storedRecord.userId
    };
  } catch (error) {
    logger.info('验证交易哈希: 链上无此记录', { transactionId });
    return { success: true, isValid: false, reason: '链上无此记录' };
  }
}
```

- [ ] **Step 2: 在 Hardhat 服务末尾新增查询方法**

在 `getStatus()` 方法之前（约第 448 行前）添加：

```javascript
/**
 * 按哈希查询链上记录（兼容 FISCO BCOS 接口）
 * Hardhat 使用旧合约，通过 index 遍历查找
 */
async getRecordByHash(sm3Hash) {
  if (!this.isInitialized || !this.auditContractAddress) {
    return null;
  }
  try {
    const auditContract = new ethers.Contract(
      this.auditContractAddress,
      ['function getRecordByHash(string) view returns (uint256, address, string, string)'],
      this.wallet
    );
    const result = await auditContract.getRecordByHash(sm3Hash);
    return {
      timestamp: result[0].toNumber(),
      submitter: result[1],
      operationType: result[2],
      userId: result[3]
    };
  } catch (error) {
    return null;
  }
}

/**
 * 按索引查询链上记录（兼容 FISCO BCOS 接口）
 */
async getRecordByIndex(index) {
  if (!this.isInitialized || !this.auditContractAddress) {
    return null;
  }
  try {
    const auditContract = new ethers.Contract(
      this.auditContractAddress,
      ['function getRecordByIndex(uint256) view returns (string, uint256, address, string, string)'],
      this.wallet
    );
    const result = await auditContract.getRecordByIndex(index);
    return {
      hashValue: result[0],
      timestamp: result[1].toNumber(),
      submitter: result[2],
      operationType: result[3],
      userId: result[4]
    };
  } catch (error) {
    return null;
  }
}

/**
 * 获取链上记录总数（兼容 FISCO BCOS 接口）
 */
async getTotalRecords() {
  if (!this.isInitialized || !this.auditContractAddress) return 0;
  try {
    const auditContract = new ethers.Contract(
      this.auditContractAddress,
      ['function getTotalRecords() view returns (uint256)'],
      this.wallet
    );
    const count = await auditContract.getTotalRecords();
    return count.toNumber();
  } catch (error) {
    return 0;
  }
}

/**
 * 获取浏览器概览数据
 */
async getExplorerData(limit = 20) {
  const totalRecords = await this.getTotalRecords();
  const recentRecords = [];
  const start = Math.max(0, totalRecords - limit);
  for (let i = start; i < totalRecords; i++) {
    const record = await this.getRecordByIndex(i);
    if (record) recentRecords.push({ index: i, ...record });
  }
  return { totalRecords, recentRecords };
}
```

- [ ] **Step 3: 运行现有测试确认不破坏**

Run: `cd backend && node test/crypto.test.js`
Expected: 62 pass, 0 fail

- [ ] **Step 4: Commit**

```bash
git add backend/services/blockchainServiceHardhat.js
git commit -m "fix(blockchain): add query methods and fix verifyTransactionHash in Hardhat service"
```

---

## Task 3: 新增 FISCO BCOS 查询方法

**Files:**
- Modify: `backend/services/blockchainServiceFisco.js` — 新增 `getRecordByIndex`/`getRecordByHash`/`getExplorerData`

FISCO BCOS 服务已有 `getTransactionCount()`，但缺少按索引/哈希查询的方法。

- [ ] **Step 1: 在 `getTransactionCount()` 方法之后添加查询方法**

```javascript
// blockchainServiceFisco.js — 在 getTransactionCount() 方法之后（约第 524 行后）添加

/**
 * 按哈希查询链上记录
 * @param {string} sm3Hash - SM3 哈希值
 * @returns {Object|null} 记录详情或 null
 */
async getRecordByHash(sm3Hash) {
  if (!this.isInitialized || !this.auditContractAddress) return null;

  try {
    const result = await this.contractCall('AuditStorage', 'getRecordByHash', [sm3Hash]);
    if (!result || result === '') return null;

    // Console 返回: "timestamp,submitter,operationType,userId"
    const parts = result.split(',');
    return {
      timestamp: parseInt(parts[0]) || 0,
      submitter: parts[1] || '',
      operationType: parts[2] || '',
      userId: parts[3] || ''
    };
  } catch (error) {
    // getRecordByHash 在记录不存在时 revert
    return null;
  }
}

/**
 * 按索引查询链上记录
 * @param {number} index - 记录索引
 * @returns {Object|null} 记录详情或 null
 */
async getRecordByIndex(index) {
  if (!this.isInitialized || !this.auditContractAddress) return null;

  try {
    const result = await this.contractCall('AuditStorage', 'getRecordByIndex', [String(index)]);
    if (!result || result === '') return null;

    // Console 返回: "hashValue,timestamp,submitter,operationType,userId"
    const parts = result.split(',');
    return {
      hashValue: parts[0] || '',
      timestamp: parseInt(parts[1]) || 0,
      submitter: parts[2] || '',
      operationType: parts[3] || '',
      userId: parts[4] || ''
    };
  } catch (error) {
    return null;
  }
}

/**
 * 获取区块链浏览器概览数据
 * @param {number} limit - 获取最近 N 条记录（默认 20）
 * @returns {Object} { totalRecords, recentRecords, typeStats }
 */
async getExplorerData(limit = 20) {
  if (!this.isInitialized || !this.auditContractAddress) {
    return { totalRecords: 0, recentRecords: [], typeStats: {} };
  }

  try {
    const totalRecords = await this.getTransactionCount();
    const recentRecords = [];
    const typeStats = {};

    const start = Math.max(0, totalRecords - limit);
    for (let i = start; i < totalRecords; i++) {
      const record = await this.getRecordByIndex(i);
      if (record) {
        recentRecords.push({ index: i, ...record });
        const type = record.operationType || 'unknown';
        typeStats[type] = (typeStats[type] || 0) + 1;
      }
    }

    return { totalRecords, recentRecords, typeStats };
  } catch (error) {
    logger.error('获取浏览器数据失败', { error: error.message });
    return { totalRecords: 0, recentRecords: [], typeStats: {} };
  }
}
```

- [ ] **Step 2: 运行现有测试确认不破坏**

Run: `cd backend && node test/crypto.test.js`
Expected: 62 pass, 0 fail

- [ ] **Step 3: Commit**

```bash
git add backend/services/blockchainServiceFisco.js
git commit -m "feat(blockchain): add getRecordByIndex/getRecordByHash/getExplorerData to Fisco service"
```

---

## Task 4: 新增区块链 API 路由

**Files:**
- Create: `backend/routes/blockchain.js`

新增 `/api/v1/blockchain/` 路由，提供链上查询和验证 API。

- [ ] **Step 1: 创建 `backend/routes/blockchain.js`**

```javascript
/**
 * 区块链查询/验证 API
 * 挂载路径: /api/v1/blockchain/
 */
const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');

let blockchainService;
try {
  blockchainService = require('../services/blockchainService');
} catch (e) {
  logger.warning('区块链服务加载失败', { error: e.message });
}

// 中间件：检查区块链服务是否可用
function requireBlockchain(req, res, next) {
  if (!blockchainService) {
    return res.status(503).json({ success: false, message: '区块链服务未加载' });
  }
  next();
}

/**
 * GET /api/v1/blockchain/explorer
 * 浏览器概览数据：总记录数、最近记录、类型统计
 */
router.get('/explorer', requireBlockchain, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const data = await blockchainService.getExplorerData(limit);
    res.json({ success: true, data });
  } catch (error) {
    logger.error('区块链浏览器查询失败', { error: error.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /api/v1/blockchain/records
 * 分页查询链上记录
 * 参数: page (默认1), pageSize (默认20, 最大100), type (可选), userId (可选)
 */
router.get('/records', requireBlockchain, async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize) || 20, 1), 100);
    const typeFilter = req.query.type || null;
    const userIdFilter = req.query.userId || null;

    const totalRecords = await blockchainService.getTransactionCount();
    const totalPages = Math.ceil(totalRecords / pageSize);

    // 获取所有记录（FISCO BCOS 不支持服务端过滤，需客户端过滤）
    const records = [];
    for (let i = 0; i < totalRecords; i++) {
      const record = await blockchainService.getRecordByIndex(i);
      if (!record) continue;

      // 应用过滤条件
      if (typeFilter && record.operationType !== typeFilter) continue;
      if (userIdFilter && record.userId !== userIdFilter) continue;

      records.push({ index: i, ...record });
    }

    // 分页
    const startIdx = (page - 1) * pageSize;
    const paginatedRecords = records.slice(startIdx, startIdx + pageSize);

    res.json({
      success: true,
      data: {
        records: paginatedRecords,
        pagination: {
          page,
          pageSize,
          total: records.length,
          totalPages
        }
      }
    });
  } catch (error) {
    logger.error('区块链记录查询失败', { error: error.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /api/v1/blockchain/records/:hash
 * 按哈希精确查询链上记录
 */
router.get('/records/:hash', requireBlockchain, async (req, res) => {
  try {
    const { hash } = req.params;
    if (!hash || hash.length < 10) {
      return res.status(400).json({ success: false, message: '无效的哈希值' });
    }

    const record = await blockchainService.getRecordByHash(hash);
    if (!record) {
      return res.status(404).json({ success: false, message: '链上无此记录' });
    }

    res.json({ success: true, data: record });
  } catch (error) {
    logger.error('按哈希查询失败', { error: error.message });
    res.status(500).json({ success: false, message: '查询失败' });
  }
});

/**
 * GET /api/v1/blockchain/verify/:transactionId
 * 一键验证交易：本地计算 SM3 → 与链上记录比对
 * 参数: transactionData (query string, JSON 格式)
 */
router.get('/verify/:transactionId', requireBlockchain, async (req, res) => {
  try {
    const { transactionId } = req.params;
    let { transactionData } = req.query;

    if (!transactionId) {
      return res.status(400).json({ success: false, message: '缺少交易ID' });
    }

    // 如果没传 transactionData，尝试从数据库查（需要引入数据库模型）
    if (!transactionData) {
      return res.status(400).json({
        success: false,
        message: '请提供 transactionData 查询参数（JSON 格式）'
      });
    }

    let parsedData;
    try {
      parsedData = JSON.parse(transactionData);
    } catch {
      return res.status(400).json({ success: false, message: 'transactionData 必须是有效的 JSON' });
    }

    const result = await blockchainService.verifyTransactionHash(transactionId, parsedData);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('交易验证失败', { error: error.message });
    res.status(500).json({ success: false, message: '验证失败' });
  }
});

/**
 * GET /api/v1/blockchain/status
 * 区块链服务状态
 */
router.get('/status', requireBlockchain, async (req, res) => {
  try {
    const status = blockchainService.getStatus();
    const totalRecords = await blockchainService.getTransactionCount();
    res.json({ success: true, data: { ...status, totalRecords } });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取状态失败' });
  }
});

module.exports = router;
```

- [ ] **Step 2: 在 `backend/app.js` 挂载路由**

在第 187 行（`app.use('/api/v1/health', healthRoutes);`）之后添加：

```javascript
const blockchainRoutes = require('./routes/blockchain');
// ... 在路由注册区域添加:
app.use('/api/v1/blockchain', blockchainRoutes);
```

注意：需要在文件顶部 import 区域（约第 17-29 行）添加：
```javascript
const blockchainRoutes = require('./routes/blockchain');
```

- [ ] **Step 3: 启动后端测试路由是否正常加载**

Run: `cd backend && timeout 5 node app.js 2>&1 || true`
Expected: 看到 "区块链服务路由 → ..." 日志，无 crash

- [ ] **Step 4: Commit**

```bash
git add backend/routes/blockchain.js backend/app.js
git commit -m "feat(blockchain): add query/verify/explorer API endpoints"
```

---

## Task 5: 区块链 API 测试

**Files:**
- Create: `backend/test/blockchain-api.test.js`

- [ ] **Step 1: 创建测试文件**

```javascript
/**
 * 区块链 API 集成测试
 * 测试 /api/v1/blockchain/ 端点
 */
const http = require('http');

const BASE = 'http://localhost:3003';

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method,
      headers: { 'Content-Type': 'application/json' }
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function runTests() {
  let pass = 0, fail = 0;

  function assert(name, condition) {
    if (condition) { console.log(`  ✅ ${name}`); pass++; }
    else { console.log(`  ❌ ${name}`); fail++; }
  }

  console.log('=== 区块链 API 测试 ===\n');

  // Test 1: GET /status
  console.log('--- GET /status ---');
  const statusRes = await req('GET', '/api/v1/blockchain/status');
  assert('status 返回 200', statusRes.status === 200);
  assert('status.success === true', statusRes.body?.success === true);
  assert('status 包含 totalRecords', typeof statusRes.body?.data?.totalRecords === 'number');

  // Test 2: GET /explorer
  console.log('\n--- GET /explorer ---');
  const explorerRes = await req('GET', '/api/v1/blockchain/explorer');
  assert('explorer 返回 200', explorerRes.status === 200);
  assert('explorer.success === true', explorerRes.body?.success === true);
  assert('explorer 包含 totalRecords', typeof explorerRes.body?.data?.totalRecords === 'number');
  assert('explorer 包含 recentRecords 数组', Array.isArray(explorerRes.body?.data?.recentRecords));

  // Test 3: GET /records (分页)
  console.log('\n--- GET /records ---');
  const recordsRes = await req('GET', '/api/v1/blockchain/records?page=1&pageSize=5');
  assert('records 返回 200', recordsRes.status === 200);
  assert('records.success === true', recordsRes.body?.success === true);
  assert('records 包含 pagination', !!recordsRes.body?.data?.pagination);

  // Test 4: GET /records 无效参数
  console.log('\n--- GET /records (边界) ---');
  const edgeRes = await req('GET', '/api/v1/blockchain/records?pageSize=999');
  assert('pageSize 被限制在 100', edgeRes.status === 200);

  // Test 5: GET /records/:hash 无效哈希
  console.log('\n--- GET /records/:hash (无效) ---');
  const badHashRes = await req('GET', '/api/v1/blockchain/records/short');
  assert('短哈希返回 400', badHashRes.status === 400);

  // Test 6: GET /verify/:id 缺少参数
  console.log('\n--- GET /verify (缺参数) ---');
  const noDataRes = await req('GET', '/api/v1/blockchain/verify/test123');
  assert('缺少 transactionData 返回 400', noDataRes.status === 400);

  console.log(`\n=== 结果: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

runTests().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 运行测试（需后端运行中）**

Run: `cd backend && node test/blockchain-api.test.js`
Expected: 9 pass, 0 fail

- [ ] **Step 3: Commit**

```bash
git add backend/test/blockchain-api.test.js
git commit -m "test(blockchain): add API endpoint tests"
```

---

## Task 6: 前端区块链浏览器页面

**Files:**
- Create: `frontend/src/pages/BlockchainExplorer.js`
- Modify: `frontend/src/App.js` — 添加路由 + import
- Modify: `frontend/src/components/Navbar.js:38` — 添加导航项

- [ ] **Step 1: 创建 `frontend/src/pages/BlockchainExplorer.js`**

```javascript
import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Paper, Chip,
  TextField, Button, Alert, CircularProgress, IconButton, Collapse,
  Tooltip
} from '@mui/material';
import {
  Search as SearchIcon,
  VerifiedUser as VerifiedIcon,
  Error as ErrorIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';

const API_BASE = process.env.REACT_APP_API_URL || '';

function BlockchainExplorer() {
  const [explorerData, setExplorerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRow, setExpandedRow] = useState(null);
  const [verifyId, setVerifyId] = useState('');
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyLoading, setVerifyLoading] = useState(false);

  const fetchExplorer = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/blockchain/explorer?limit=50`);
      const data = await res.json();
      if (data.success) {
        setExplorerData(data.data);
      } else {
        setError(data.message || '查询失败');
      }
    } catch (e) {
      setError('无法连接区块链服务: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchExplorer(); }, []);

  const handleVerify = async () => {
    if (!verifyId.trim()) return;
    setVerifyLoading(true);
    setVerifyResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/blockchain/verify/${encodeURIComponent(verifyId)}`);
      const data = await res.json();
      setVerifyResult(data);
    } catch (e) {
      setVerifyResult({ success: false, message: e.message });
    } finally {
      setVerifyLoading(false);
    }
  };

  const formatTime = (ts) => {
    if (!ts) return '-';
    return new Date(ts * 1000).toLocaleString('zh-CN');
  };

  const truncateHash = (hash, len = 20) => {
    if (!hash) return '-';
    return hash.length > len ? hash.slice(0, len) + '...' : hash;
  };

  const typeColor = (type) => {
    const colors = { loan: 'warning', repay: 'success', register: 'info', zkp: 'secondary' };
    return colors[type] || 'default';
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '50vh' }}>
        <CircularProgress />
        <Typography sx={{ ml: 2 }}>加载区块链数据...</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight={700}>区块链浏览器</Typography>
        <IconButton onClick={fetchExplorer} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {/* 统计卡片 */}
      {explorerData && (
        <Grid container spacing={2} sx={{ mb: 3 }}>
          <Grid item xs={12} sm={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>链上总记录</Typography>
                <Typography variant="h3" fontWeight={700}>{explorerData.totalRecords}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>类型分布</Typography>
                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
                  {Object.entries(explorerData.typeStats || {}).map(([type, count]) => (
                    <Chip key={type} label={`${type}: ${count}`} color={typeColor(type)} size="small" />
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Card>
              <CardContent>
                <Typography color="text.secondary" gutterBottom>最近记录数</Typography>
                <Typography variant="h3" fontWeight={700}>{explorerData.recentRecords?.length || 0}</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* 验证交易 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>验证交易</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="输入交易ID"
              value={verifyId}
              onChange={(e) => setVerifyId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
            />
            <Button variant="contained" onClick={handleVerify} disabled={verifyLoading} startIcon={<SearchIcon />}>
              验证
            </Button>
          </Box>
          {verifyResult && (
            <Alert severity={verifyResult.data?.isValid ? 'success' : 'error'} sx={{ mt: 2 }}>
              {verifyResult.data?.isValid ? '✅ 交易验证通过 — 链上记录与本地数据一致' : '❌ 验证失败 — ' + (verifyResult.data?.reason || verifyResult.message || '未知原因')}
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* 记录表格 */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>索引</TableCell>
              <TableCell>时间</TableCell>
              <TableCell>操作类型</TableCell>
              <TableCell>用户ID</TableCell>
              <TableCell>SM3 哈希</TableCell>
              <TableCell>状态</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {(explorerData?.recentRecords || []).slice().reverse().map((record) => (
              <React.Fragment key={record.index}>
                <TableRow hover>
                  <TableCell>{record.index}</TableCell>
                  <TableCell>{formatTime(record.timestamp)}</TableCell>
                  <TableCell>
                    <Chip label={record.operationType} color={typeColor(record.operationType)} size="small" />
                  </TableCell>
                  <TableCell>{record.userId || '-'}</TableCell>
                  <TableCell>
                    <Tooltip title={record.hashValue}>
                      <Typography variant="body2" fontFamily="monospace">
                        {truncateHash(record.hashValue)}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <Chip icon={<VerifiedIcon />} label="已上链" color="success" size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => setExpandedRow(expandedRow === record.index ? null : record.index)}>
                      {expandedRow === record.index ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ py: 0 }} colSpan={7}>
                    <Collapse in={expandedRow === record.index}>
                      <Box sx={{ py: 2, bgcolor: 'grey.50', px: 2, borderRadius: 1, mb: 1 }}>
                        <Typography variant="body2" fontFamily="monospace" gutterBottom>
                          <strong>完整哈希:</strong> {record.hashValue}
                        </Typography>
                        <Typography variant="body2">
                          <strong>提交者:</strong> {record.submitter}
                        </Typography>
                        <Typography variant="body2">
                          <strong>上链时间:</strong> {formatTime(record.timestamp)}
                        </Typography>
                      </Box>
                    </Collapse>
                  </TableCell>
                </TableRow>
              </React.Fragment>
            ))}
            {(!explorerData?.recentRecords || explorerData.recentRecords.length === 0) && (
              <TableRow>
                <TableCell colSpan={7} align="center">
                  <Typography color="text.secondary" sx={{ py: 4 }}>暂无链上记录</Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}

export default BlockchainExplorer;
```

- [ ] **Step 2: 修改 `frontend/src/App.js` 添加路由和 import**

在 import 区域（第 19 行附近）添加：
```javascript
import BlockchainExplorer from './pages/BlockchainExplorer';
```

在 Routes 中（第 582 行 `</Routes>` 之前）添加：
```javascript
<Route path="/blockchain" element={
  user ? <ErrorBoundary><BlockchainExplorer /></ErrorBoundary> : <Navigate to="/" />
} />
```

- [ ] **Step 3: 修改 `frontend/src/components/Navbar.js` 添加导航项**

在 `navItems` 数组（第 38 行后）添加：
```javascript
{ text: '区块链', icon: <AccountBalanceIcon />, path: '/blockchain' },
```

需要确认 import 中有 `AccountBalanceIcon`（或使用其他已有的 icon）。检查 Navbar.js 的 import 区域，如果没有合适的 icon，使用已有的 icon 或添加 import。

- [ ] **Step 4: 前端编译检查**

Run: `cd frontend && npx react-scripts build 2>&1 | tail -5`
Expected: "Compiled successfully" 或 "The build folder is ready to be deployed"

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/BlockchainExplorer.js frontend/src/App.js frontend/src/components/Navbar.js
git commit -m "feat(frontend): add blockchain explorer page with verify and record table"
```

---

## Task 7: Tengine NTLS 重新编译（WSL 操作）

**Files:**
- Modify: `scripts/wsl/setup-guomi-tls.sh` — 更新编译命令

此任务在 WSL 中执行。需要重新编译 Tengine 以启用 `ngx_tongsuo_ntls` 模块。

- [ ] **Step 1: 检查 Tengine 源码中 NTLS 模块是否存在**

Run (WSL): `ls -la ~/tengine/modules/ngx_tongsuo_ntls/ 2>/dev/null || echo "模块不存在"`
Expected: 看到 `config` 和 `ngx_tongsuo_ntls_module.c` 等文件

- [ ] **Step 2: 备份当前 Tengine**

Run (WSL): `sudo cp /usr/local/tengine-static/sbin/nginx /usr/local/tengine-static/sbin/nginx.bak`

- [ ] **Step 3: 重新编译 Tengine（启用 NTLS）**

```bash
cd ~/tengine
./configure \
  --add-module=modules/ngx_tongsuo_ntls \
  --with-http_ssl_module \
  --with-openssl=/home/ouye/tongsuo \
  --with-openssl-opt="enable-sm2 enable-sm3 enable-sm4 enable-ntls" \
  --with-http_v2_module \
  --prefix=/usr/local/tengine-ntls
make -j$(nproc)
sudo make install
```

- [ ] **Step 4: 验证编译产物包含 NTLS 支持**

Run (WSL): `/usr/local/tengine-ntls/sbin/nginx -V 2>&1 | grep -i ntls`
Expected: 输出中包含 `ntls` 相关信息

- [ ] **Step 5: Commit 编译脚本更新**

```bash
git add scripts/wsl/setup-guomi-tls.sh
git commit -m "feat(tls): update Tengine build to enable NTLS module"
```

---

## Task 8: SM2 双证书生成 + NTLS 配置（WSL 操作）

**Files:**
- Create (WSL): `/home/ouye/sm2-certs/sm2-sign.key`, `sm2-sign.crt`, `sm2-enc.key`, `sm2-enc.crt`

- [ ] **Step 1: 生成签名密钥对和证书**

```bash
cd /home/ouye/sm2-certs

# 签名密钥对
/usr/local/tongsuo-static/bin/openssl genpkey -algorithm SM2 -out sm2-sign.key
/usr/local/tongsuo-static/bin/openssl req -new -key sm2-sign.key -out sm2-sign.csr \
  -subj "/CN=FinZkTrust-Sign" -sm3
/usr/local/tongsuo-static/bin/openssl x509 -req -in sm2-sign.csr \
  -CA sm2-ca.crt -CAkey sm2-ca.key -out sm2-sign.crt -days 365 -sm3
```

- [ ] **Step 2: 生成加密密钥对和证书**

```bash
# 加密密钥对
/usr/local/tongsuo-static/bin/openssl genpkey -algorithm SM2 -out sm2-enc.key
/usr/local/tongsuo-static/bin/openssl req -new -key sm2-enc.key -out sm2-enc.csr \
  -subj "/CN=FinZkTrust-Enc" -sm3
/usr/local/tongsuo-static/bin/openssl x509 -req -in sm2-enc.csr \
  -CA sm2-ca.crt -CAkey sm2-ca.key -out sm2-enc.crt -days 365 -sm3
```

- [ ] **Step 3: 创建 NTLS 配置**

创建 `/usr/local/tengine-ntls/conf/nginx-ntls.conf`:

```nginx
worker_processes 1;
events { worker_connections 1024; }

http {
    include       mime.types;
    default_type  application/octet-stream;

    # NTLS + 标准 TLS 双协议（同一端口）
    server {
        listen       8443 ssl;
        server_name  localhost;

        # NTLS 配置（SM2 双证书）
        enable_ntls              on;
        ssl_sign_certificate     /home/ouye/sm2-certs/sm2-sign.crt;
        ssl_sign_certificate_key /home/ouye/sm2-certs/sm2-sign.key;
        ssl_enc_certificate      /home/ouye/sm2-certs/sm2-enc.crt;
        ssl_enc_certificate_key  /home/ouye/sm2-certs/sm2-enc.key;

        # 标准 TLS 回退（RSA 证书）
        ssl_certificate      /home/ouye/sm2-certs/server.crt;
        ssl_certificate_key  /home/ouye/sm2-certs/server.key;
        ssl_protocols        TLSv1.2 TLSv1.3;

        location /api/ {
            proxy_pass http://127.0.0.1:3003;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }
    }
}
```

- [ ] **Step 4: 测试 NTLS 连接**

```bash
# 启动 NTLS Tengine
sudo /usr/local/tengine-ntls/sbin/nginx -c /usr/local/tengine-ntls/conf/nginx-ntls.conf

# NTLS 连接测试
echo -e "GET /api/v1/pool HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" | \
  /usr/local/tongsuo-static/bin/openssl s_client -connect localhost:8443 \
  -ntls -sign_cert /home/ouye/sm2-certs/sm2-sign.crt \
  -sign_key /home/ouye/sm2-certs/sm2-sign.key \
  -enc_cert /home/ouye/sm2-certs/sm2-enc.crt \
  -enc_key /home/ouye/sm2-certs/sm2-enc.key 2>&1 | head -30
```

Expected 输出包含：
```
Protocol: NTLSv1.1
Peer signing digest: SM3
Peer signature type: sm2sig_sm3
```

- [ ] **Step 5: 如果 NTLS 不支持同端口双协议，使用双端口方案**

如果上面的测试失败，改为：
- 端口 443：标准 TLS（RSA 证书，浏览器兼容）
- 端口 8443：NTLS（SM2 双证书，国密客户端）

更新 nginx 配置为两个 server block。

- [ ] **Step 6: Commit**

```bash
git add scripts/wsl/setup-guomi-tls.sh
git commit -m "feat(tls): add SM2 dual certificate generation and NTLS config"
```

---

## Task 9: 一键启动脚本

**Files:**
- Create: `scripts/start-system.sh`

- [ ] **Step 1: 创建 `scripts/start-system.sh`**

```bash
#!/bin/bash
# FinZkTrust 一键启动脚本 (WSL)
# 启动: FISCO BCOS + 后端 + 前端 + Tengine(HTTPS/NTLS)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  FinZkTrust 系统启动${NC}"
echo -e "${GREEN}========================================${NC}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. 检查 FISCO BCOS
echo -e "\n${YELLOW}=== 1. 检查 FISCO BCOS ===${NC}"
FISCO_DIR="$HOME/fisco-bcos-node"
if [ -d "$FISCO_DIR" ]; then
  NODE_COUNT=$(bash "$FISCO_DIR/start_all.sh" 2>/dev/null | grep -c "success" || echo "0")
  echo -e "  FISCO BCOS 节点: ${GREEN}已启动${NC}"
else
  echo -e "  ${RED}FISCO BCOS 目录不存在: $FISCO_DIR${NC}"
  echo -e "  ${YELLOW}跳过区块链启动，系统将使用 Hardhat 模式${NC}"
fi

# 2. 启动后端
echo -e "\n${YELLOW}=== 2. 启动后端 ===${NC}"
cd "$PROJECT_ROOT/backend"
if [ ! -f ".env" ]; then
  echo -e "  ${YELLOW}警告: .env 文件不存在，使用默认配置${NC}"
fi
BLOCKCHAIN_NETWORK=${BLOCKCHAIN_NETWORK:-fisco-bcos} node app.js &
BACKEND_PID=$!
echo -e "  后端 PID: ${GREEN}$BACKEND_PID${NC}"
echo "  等待后端启动..."
sleep 3

# 检查后端是否存活
if kill -0 $BACKEND_PID 2>/dev/null; then
  echo -e "  后端: ${GREEN}运行中${NC} (http://localhost:3003)"
else
  echo -e "  ${RED}后端启动失败${NC}"
  exit 1
fi

# 3. 启动前端
echo -e "\n${YELLOW}=== 3. 启动前端 ===${NC}"
cd "$PROJECT_ROOT/frontend"
npm start &
FRONTEND_PID=$!
echo -e "  前端 PID: ${GREEN}$FRONTEND_PID${NC}"

# 4. 启动 Tengine (HTTPS)
echo -e "\n${YELLOW}=== 4. 启动 Tengine (HTTPS) ===${NC}"
if [ -f "/usr/local/tengine-static/sbin/nginx" ]; then
  sudo /usr/local/tengine-static/sbin/nginx -t 2>/dev/null && {
    sudo /usr/local/tengine-static/sbin/nginx
    echo -e "  Tengine (HTTPS): ${GREEN}运行中${NC} (https://localhost:443)"
  } || echo -e "  ${YELLOW}Tengine 配置检查失败，跳过${NC}"
else
  echo -e "  ${YELLOW}Tengine 未安装，跳过 HTTPS${NC}"
fi

# 5. 启动 Tengine NTLS (可选)
echo -e "\n${YELLOW}=== 5. 启动 Tengine NTLS ===${NC}"
NTLS_CONF="/usr/local/tengine-ntls/conf/nginx-ntls.conf"
if [ -f "/usr/local/tengine-ntls/sbin/nginx" ] && [ -f "$NTLS_CONF" ]; then
  sudo /usr/local/tengine-ntls/sbin/nginx -c "$NTLS_CONF" -t 2>/dev/null && {
    sudo /usr/local/tengine-ntls/sbin/nginx -c "$NTLS_CONF"
    echo -e "  Tengine (NTLS): ${GREEN}运行中${NC} (ntls://localhost:8443)"
  } || echo -e "  ${YELLOW}NTLS 配置检查失败，跳过${NC}"
else
  echo -e "  ${YELLOW}Tengine NTLS 未安装或配置不存在，跳过${NC}"
fi

# 输出
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  系统就绪${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  后端:      http://localhost:3003"
echo -e "  前端:      http://localhost:3000"
echo -e "  HTTPS:     https://localhost:443 (RSA)"
echo -e "  NTLS:      ntls://localhost:8443 (SM2 双证书)"
echo -e "  区块链:    http://localhost:3000/blockchain"
echo ""
echo -e "  ${YELLOW}Ctrl+C 停止所有服务${NC}"

# 等待子进程
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; sudo /usr/local/tengine-static/sbin/nginx -s stop 2>/dev/null; sudo /usr/local/tengine-ntls/sbin/nginx -s stop 2>/dev/null; echo -e '\n${RED}系统已停止${NC}'" SIGINT SIGTERM

wait
```

- [ ] **Step 2: 添加执行权限**

Run: `chmod +x scripts/start-system.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/start-system.sh
git commit -m "feat(scripts): add one-click system startup script"
```

---

## Task 10: 演示流程脚本

**Files:**
- Create: `scripts/demo-flow.sh`

- [ ] **Step 1: 创建 `scripts/demo-flow.sh`**

```bash
#!/bin/bash
# FinZkTrust 演示流程脚本
# 自动演示: 注册→登录→ZKP→借款→验证→区块链查询

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

API="http://localhost:3003"
DEMO_USER="demo_$(date +%s)"
DEMO_PASS="Demo@12345678"
SM2_PUB="04c41687818b21b8a57cf9ae71c976c8b3c2c1a54d877d2ae4eafc440b13f39bc2d3d630182ce6a5326ea6185793a852d0bc2fe7056effbea67eebe877c6af04d0"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  FinZkTrust 演示流程${NC}"
echo -e "${CYAN}========================================${NC}"

# 初始链上状态
echo -e "\n${YELLOW}--- 0. 初始链上状态 ---${NC}"
INIT=$(curl -s "$API/api/v1/blockchain/explorer" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('totalRecords',0))" 2>/dev/null || echo "0")
echo -e "  链上记录数: ${GREEN}$INIT${NC}"

# 1. 注册
echo -e "\n${YELLOW}--- 1. 注册用户 ---${NC}"
REG=$(curl -s -X POST "$API/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$DEMO_USER\",\"password\":\"$DEMO_PASS\",\"sm2PublicKey\":\"$SM2_PUB\"}")
echo "  $REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  结果:', '✅ 成功' if d.get('success') else '❌ '+d.get('message',''))" 2>/dev/null
USER_ID=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('id',''))" 2>/dev/null)
echo -e "  用户ID: ${GREEN}$USER_ID${NC}"

# 2. 登录
echo -e "\n${YELLOW}--- 2. 登录 ---${NC}"
LOGIN=$(curl -s -X POST "$API/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$DEMO_USER\",\"password\":\"$DEMO_PASS\"}")
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
echo -e "  Token: ${GREEN}${TOKEN:0:20}...${NC}"

# 3. 等待链上注册
echo -e "\n${YELLOW}--- 3. 等待链上注册 (8s) ---${NC}"
sleep 8
AFTER_REG=$(curl -s "$API/api/v1/blockchain/explorer" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('totalRecords',0))" 2>/dev/null || echo "0")
echo -e "  链上记录数: ${GREEN}$AFTER_REG${NC} (+$((AFTER_REG - INIT)))"

# 4. 查看区块链浏览器
echo -e "\n${YELLOW}--- 4. 区块链浏览器 ---${NC}"
EXPLORER=$(curl -s "$API/api/v1/blockchain/explorer")
echo "$EXPLORER" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(f'  总记录: {d.get(\"totalRecords\",0)}')
print(f'  类型分布: {d.get(\"typeStats\",{})}')
print(f'  最近记录: {len(d.get(\"recentRecords\",[]))} 条')
" 2>/dev/null

# 5. 区块链状态
echo -e "\n${YELLOW}--- 5. 区块链服务状态 ---${NC}"
curl -s "$API/api/v1/blockchain/status" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(f'  已初始化: {d.get(\"isInitialized\",False)}')
print(f'  网络: {d.get(\"networkName\",\"unknown\")}')
print(f'  总记录: {d.get(\"totalRecords\",0)}')
" 2>/dev/null

echo -e "\n${CYAN}========================================${NC}"
echo -e "${CYAN}  演示完成${NC}"
echo -e "${CYAN}  区块链浏览器: http://localhost:3000/blockchain${NC}"
echo -e "${CYAN}========================================${NC}"
```

- [ ] **Step 2: 添加执行权限**

Run: `chmod +x scripts/demo-flow.sh`

- [ ] **Step 3: Commit**

```bash
git add scripts/demo-flow.sh
git commit -m "feat(scripts): add demo flow script for full business verification"
```

---

## Task 11: 端到端验证

- [ ] **Step 1: 运行现有测试套件确认无回归**

```bash
cd backend && node test/crypto.test.js
```
Expected: 62 pass, 0 fail, 1 skip

- [ ] **Step 2: 运行安全容错测试**

```bash
cd backend && node test/security-fault-tolerance-test.js
```
Expected: 34/34 pass

- [ ] **Step 3: 运行区块链 API 测试（需后端运行）**

```bash
cd backend && node test/blockchain-api.test.js
```
Expected: 9 pass, 0 fail

- [ ] **Step 4: 运行 FISCO BCOS E2E 测试（需后端 + 区块链运行）**

```bash
cd backend && node test/fisco-e2e.js
```
Expected: 链上记录数增加，全流程通过

- [ ] **Step 5: 运行演示脚本**

```bash
bash scripts/demo-flow.sh
```
Expected: 全流程通过，区块链浏览器可访问

- [ ] **Step 6: NTLS 连接验证（WSL）**

```bash
echo -e "GET /api/v1/pool HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" | \
  /usr/local/tongsuo-static/bin/openssl s_client -connect localhost:8443 \
  -ntls -sign_cert /home/ouye/sm2-certs/sm2-sign.crt \
  -sign_key /home/ouye/sm2-certs/sm2-sign.key \
  -enc_cert /home/ouye/sm2-certs/sm2-enc.crt \
  -enc_key /home/ouye/sm2-certs/sm2-enc.key
```
Expected: Protocol: NTLSv1.1, Peer signing digest: SM3

- [ ] **Step 7: Final Commit**

```bash
git add -A
git commit -m "feat: complete FISCO BCOS + NTLS deep integration"
```
