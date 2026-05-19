# ZKP 链上验证修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Phase 3 三个已知架构限制，打通 ZKP 链上验证完整闭环

**Architecture:** 使用 ethers.js ABI 编码 + FISCO BCOS JSON-RPC sendRawTransaction 绕过 Console 无法序列化嵌套数组的限制。链上验证异步执行，结果存证到 ZKPVerifier 合约。Hardhat 模式使用 ethers.js 直接调用。

**Tech Stack:** ethers v5, FISCO BCOS JSON-RPC, Solidity 0.8.x, React + MUI

**Spec:** `docs/superpowers/specs/2026-05-19-zkp-chain-verification-design.md`

---

### Task 1: 扩展 ZKPVerifier.sol 合约

**Files:**
- Modify: `contracts/contracts/ZKPVerifier.sol`

- [ ] **Step 1: 扩展 ProofResult 结构体，新增链上验证字段**

在 `contracts/contracts/ZKPVerifier.sol` 中，将 `ProofResult` 结构体从：

```solidity
struct ProofResult {
    bool valid;
    uint256 timestamp;
    address submitter;
    string proofHash;
}
```

改为：

```solidity
struct ProofResult {
    bool valid;
    uint256 timestamp;
    address submitter;
    string proofHash;
    bool chainVerified;
    bool chainValid;
}
```

- [ ] **Step 2: 新增 updateChainStatus 方法**

在 `getProofResult` 方法之前插入：

```solidity
function updateChainStatus(bytes32 proofId, bool chainValid) public onlyAuthorized returns (bool) {
    require(verifiedProofs[proofId].timestamp != 0, "Proof not found");
    verifiedProofs[proofId].chainVerified = true;
    verifiedProofs[proofId].chainValid = chainValid;
    return true;
}
```

- [ ] **Step 3: 更新 getProofResult 返回值**

将 `getProofResult` 从返回 4 个值改为返回 6 个值：

```solidity
function getProofResult(bytes32 proofId) public view returns (bool, uint256, address, string memory, bool, bool) {
    ProofResult memory r = verifiedProofs[proofId];
    require(r.timestamp != 0, "Proof not found");
    return (r.valid, r.timestamp, r.submitter, r.proofHash, r.chainVerified, r.chainValid);
}
```

- [ ] **Step 4: 重新编译合约**

```bash
cd contracts
npx hardhat compile
```

Expected: 编译成功，无错误

- [ ] **Step 5: Commit**

```bash
git add contracts/contracts/ZKPVerifier.sol contracts/artifacts/contracts/ZKPVerifier.sol/
git commit -m "feat(contract): extend ZKPVerifier with chain verification fields"
```

---

### Task 2: blockchainServiceFisco.js - 新增 sendRawTransaction 能力

**Files:**
- Modify: `backend/services/blockchainServiceFisco.js`

此任务将 `deploy-fisco.js` 中已验证的 FISCO BCOS 交易签名逻辑移植到运行时服务中。

- [ ] **Step 1: 在构造函数中新增签名相关属性**

在 `backend/services/blockchainServiceFisco.js` 的 `constructor()` 方法（第 124-135 行）中，在 `this.auditHashSent = new Set();` 之后新增：

```javascript
this.privateKey = process.env.FISCO_BCOS_PRIVATE_KEY || '0x4c0883a69102937d6231471b5dbb6204fe512961708279f0ccfd5c3ef3e2e6c4';
```

- [ ] **Step 2: 新增 toRlpHex 辅助函数**

在 `blockchainServiceFisco.js` 的模块级函数区域（`rpcCall` 函数之后，`consoleExec` 函数之前，约第 67 行）插入：

```javascript
function toRlpHex(val) {
  if (typeof val === 'number') {
    if (val === 0) return '0x';
    const h = val.toString(16);
    return '0x' + (h.length % 2 ? '0' + h : h);
  }
  if (typeof val === 'string') {
    if (val === '' || val === '0x') return '0x';
    if (val.startsWith('0x')) {
      const hex = val.slice(2);
      if (hex === '' || hex === '0') return '0x';
      return '0x' + (hex.length % 2 ? '0' + hex : hex);
    }
    return toRlpHex(parseInt(val, 10));
  }
  return val;
}

function signFiscoTx(privateKey, { randomid, blockLimit, to, data, value, gasPrice, gasLimit, chainId, groupId, extraData }) {
  const fields = [
    randomid,
    toRlpHex(gasPrice),
    toRlpHex(gasLimit),
    blockLimit,
    to || '0x',
    toRlpHex(value),
    data,
    toRlpHex(chainId),
    toRlpHex(groupId),
    extraData || '0x'
  ];
  const signData = ethers.utils.RLP.encode(fields);
  const hash = ethers.utils.keccak256(signData);
  const signingKey = new ethers.utils.SigningKey(privateKey);
  const sig = signingKey.signDigest(hash);
  const v = sig.recoveryParam + 27;
  const signedFields = [...fields, toRlpHex(v), sig.r, sig.s];
  return ethers.utils.RLP.encode(signedFields);
}
```

- [ ] **Step 3: 新增 _sendRawTransaction 方法**

在 `verifyZKPOnChain` 方法之前（约第 267 行之前）插入：

```javascript
async _sendRawTransaction(contractName, methodName, params) {
  const contractAddress = this.getContractAddress(contractName);
  if (!contractAddress) throw new Error(`合约 ${contractName} 地址未配置`);

  const abi = this[`${contractName === 'AuditStorage' ? 'audit' : contractName === 'ZKPVerifier' ? 'zkpVerifier' : 'verifier'}Abi`];
  if (!abi) throw new Error(`合约 ${contractName} ABI 未加载`);

  const iface = new ethers.utils.Interface(abi);
  const data = iface.encodeFunctionData(methodName, params);

  const blockNumber = await rpcCall('getBlockNumber', [FISCO_CONFIG.groupId]);
  const blockLimit = '0x' + (parseInt(blockNumber) + 500).toString(16);
  const randomid = '0x' + require('crypto').randomBytes(32).toString('hex');

  const signedTx = signFiscoTx(this.privateKey, {
    randomid,
    blockLimit,
    to: contractAddress,
    data,
    value: 0,
    gasPrice: 0,
    gasLimit: 30000000,
    chainId: FISCO_CONFIG.chainId,
    groupId: FISCO_CONFIG.groupId,
    extraData: '0x'
  });

  const txHash = await rpcCall('sendRawTransaction', [FISCO_CONFIG.groupId, signedTx]);

  // 等待回执
  let receipt = null;
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      receipt = await rpcCall('getTransactionReceipt', [FISCO_CONFIG.groupId, txHash]);
      if (receipt) break;
    } catch (e) { /* 继续轮询 */ }
  }

  if (!receipt) throw new Error('交易回执获取超时');
  if (receipt.status !== '0x0') throw new Error(`交易执行失败, status: ${receipt.status}`);

  return {
    success: true,
    transactionHash: txHash,
    blockNumber: parseInt(receipt.blockNumber, 16),
    network: 'fisco-bcos'
  };
}
```

- [ ] **Step 4: 验证 ABI 加载路径正确**

检查 `loadContracts()` 方法（第 168-213 行）中 Verifier ABI 是否已加载。确认第 188 行的 `verifierArtifactPath` 指向正确的编译产物路径，并且第 199-202 行的 `this.verifierAbi` 已正确赋值。

如果 `verifierAbi` 未加载，在 `loadContracts()` 的 ABI 加载部分补充：

```javascript
const verifierArtifactPath = path.join(__dirname, '../../contracts/artifacts/contracts/Verifier.sol/Verifier.json');
if (fs.existsSync(verifierArtifactPath)) {
  const artifact = JSON.parse(fs.readFileSync(verifierArtifactPath, 'utf8'));
  this.verifierAbi = artifact.abi;
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/blockchainServiceFisco.js
git commit -m "feat(fisco): add sendRawTransaction with FISCO BCOS tx signing"
```

---

### Task 3: blockchainServiceFisco.js - 修复 verifyZKPOnChain + 新增 updateZKPChainStatus

**Files:**
- Modify: `backend/services/blockchainServiceFisco.js:268-285`

- [ ] **Step 1: 重写 verifyZKPOnChain 方法**

将第 268-285 行的 `verifyZKPOnChain` 方法替换为：

```javascript
async verifyZKPOnChain(proof, publicSignals, userAddress, sm3Hash) {
  try {
    if (!this.isInitialized) {
      return { success: false, error: 'Service not initialized' };
    }

    const pA = [proof.pi_a[0], proof.pi_a[1]];
    const pB = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]];
    const pC = [proof.pi_c[0], proof.pi_c[1]];
    const pubSignals = publicSignals.map(s => s.toString());

    const sm3Bytes32 = sm3Hash.startsWith('0x') ? sm3Hash : '0x' + sm3Hash;

    const result = await this._sendRawTransaction('Verifier', 'verifyProof',
      [userAddress, pA, pB, pC, pubSignals, sm3Bytes32]);
    return { success: true, txHash: result.transactionHash };
  } catch (error) {
    logger.error('链上 ZKP 验证失败', { error: error.message });
    return { success: false, error: error.message };
  }
}
```

- [ ] **Step 2: 新增 updateZKPChainStatus 方法**

在 `recordZKPResult` 方法之后（约第 493 行之后）插入：

```javascript
async updateZKPChainStatus(proofId, chainValid) {
  if (!this.isInitialized || !this.zkpVerifierContractAddress) {
    logger.warning('FISCO BCOS 服务或 ZKPVerifier 未初始化，跳过链上状态更新', { proofId });
    return { success: false, skipped: true };
  }

  const proofIdBytes32 = ethers.utils.formatBytes32String(proofId.toString().slice(0, 31));

  return this.contractSend('ZKPVerifier', 'updateChainStatus', [proofIdBytes32, chainValid])
    .then(result => {
      logger.info('ZKP 链上验证状态更新成功', { proofId, chainValid, txHash: result.transactionHash });
      return { success: true, txHash: result.transactionHash };
    })
    .catch(error => {
      logger.error('ZKP 链上验证状态更新失败', { error: error.message, proofId });
      return { success: false, error: error.message };
    });
}
```

- [ ] **Step 3: 更新 getZKPResult 解析返回值**

将 `getZKPResult` 方法（第 498-518 行）的返回值解析从 4 个字段改为 6 个字段：

```javascript
async getZKPResult(proofId) {
  if (!this.isInitialized || !this.zkpVerifierContractAddress) {
    return null;
  }
  try {
    const proofIdBytes32 = proofId.startsWith('0x') && proofId.length === 66
      ? proofId
      : '0x' + Buffer.from(proofId.toString().slice(0, 31)).toString('hex').padEnd(64, '0');
    const result = await this.contractCall('ZKPVerifier', 'getProofResult', [proofIdBytes32]);
    if (!result || result === '') return null;
    // Console 返回格式: "valid,timestamp,submitter,proofHash,chainVerified,chainValid"
    // proofHash 不含逗号，直接按逗号分割
    const parts = result.split(',');
    return {
      isValid: parts[0] === 'true',
      timestamp: parseInt(parts[1]) || 0,
      submitter: parts[2] || '',
      proofHash: parts[3] || '',
      chainVerified: parts[4] === 'true',
      chainValid: parts[5] === 'true'
    };
  } catch (error) {
    logger.error('查询 ZKP 验证结果失败', { error: error.message, proofId });
    return null;
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add backend/services/blockchainServiceFisco.js
git commit -m "feat(fisco): fix verifyZKPOnChain params + add updateZKPChainStatus"
```

---

### Task 4: blockchainServiceHardhat.js - 实现 verifyZKPOnChain + updateZKPChainStatus

**Files:**
- Modify: `backend/services/blockchainServiceHardhat.js:559-569`

- [ ] **Step 1: 加载 Verifier 合约**

在 `loadAllContracts()` 方法（第 141-163 行）末尾，补充加载 Verifier 合约：

```javascript
this.verifierContract = await this.loadContract('Verifier');
```

在 `constructor()` 方法（第 30-40 行）中补充：

```javascript
this.verifierContract = null;
```

- [ ] **Step 2: 实现 verifyZKPOnChain**

将第 559-562 行替换为：

```javascript
async verifyZKPOnChain(proof, publicSignals, userAddress, sm3Hash) {
  try {
    if (!this.isInitialized || !this.verifierContract) {
      return { success: false, error: 'Verifier contract not available' };
    }

    const pA = [proof.pi_a[0], proof.pi_a[1]];
    const pB = [[proof.pi_b[0][1], proof.pi_b[0][0]], [proof.pi_b[1][1], proof.pi_b[1][0]]];
    const pC = [proof.pi_c[0], proof.pi_c[1]];
    const pubSignals = publicSignals.map(s => s.toString());
    const sm3Bytes32 = sm3Hash.startsWith('0x') ? sm3Hash : '0x' + sm3Hash;

    const tx = await this.verifierContract.verifyProof(userAddress, pA, pB, pC, pubSignals, sm3Bytes32);
    const receipt = await tx.wait();
    return { success: true, txHash: receipt.transactionHash };
  } catch (error) {
    logger.error('Hardhat 链上 ZKP 验证失败', { error: error.message });
    return { success: false, error: error.message };
  }
}
```

- [ ] **Step 3: 实现 updateZKPChainStatus**

在 `getZKPResult` 方法之后插入：

```javascript
async updateZKPChainStatus(proofId, chainValid) {
  try {
    if (!this.isInitialized || !this.zkpVerifierContract) {
      return { success: false, error: 'ZKPVerifier contract not available' };
    }

    const proofIdBytes32 = ethers.utils.formatBytes32String(proofId.toString().slice(0, 31));
    const tx = await this.zkpVerifierContract.updateChainStatus(proofIdBytes32, chainValid);
    const receipt = await tx.wait();
    return { success: true, txHash: receipt.transactionHash };
  } catch (error) {
    logger.error('Hardhat ZKP 链上状态更新失败', { error: error.message });
    return { success: false, error: error.message };
  }
}
```

- [ ] **Step 4: 实现 getZKPResult**

将第 567-569 行替换为：

```javascript
async getZKPResult(proofId) {
  try {
    if (!this.isInitialized || !this.zkpVerifierContract) {
      return null;
    }
    const proofIdBytes32 = proofId.startsWith('0x') && proofId.length === 66
      ? proofId
      : '0x' + Buffer.from(proofId.toString().slice(0, 31)).toString('hex').padEnd(64, '0');
    const result = await this.zkpVerifierContract.getProofResult(proofIdBytes32);
    return {
      isValid: result[0],
      timestamp: result[1].toNumber(),
      submitter: result[2],
      proofHash: result[3],
      chainVerified: result[4],
      chainValid: result[5]
    };
  } catch (error) {
    return null;
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add backend/services/blockchainServiceHardhat.js
git commit -m "feat(hardhat): implement verifyZKPOnChain + updateZKPChainStatus"
```

---

### Task 5: zkService.js - 更新异步验证流程

**Files:**
- Modify: `backend/services/zkService.js:207-215`

- [ ] **Step 1: 更新 verifyZKPOnChain 调用，传入完整参数**

将第 207-215 行从：

```javascript
blockchainService.verifyZKPOnChain(proof, publicSignals)
  .then(result => {
    if (result.success && !result.isValid) {
      logger.warn('链上 ZKP 验证结果与后端不一致', { proofId, backendValid: true, chainValid: result.isValid });
    }
  })
  .catch(err => {
    logger.warn('链上 ZKP 验证调用失败（非阻塞）', { error: err.message });
  });
```

改为：

```javascript
const userAddress = '0x0000000000000000000000000000000000000000';
const sm3Hash = proofHash;

blockchainService.verifyZKPOnChain(proof, publicSignals, userAddress, sm3Hash)
  .then(async (result) => {
    if (result.success) {
      logger.info('链上 ZKP 验证完成', { proofId, txHash: result.txHash });
      await blockchainService.updateZKPChainStatus(proofId, true);
    } else {
      logger.warn('链上 ZKP 验证失败', { proofId, error: result.error });
      await blockchainService.updateZKPChainStatus(proofId, false);
    }
  })
  .catch(async (err) => {
    logger.warn('链上 ZKP 验证调用异常（非阻塞）', { error: err.message });
    await blockchainService.updateZKPChainStatus(proofId, false);
  });
```

注意：`userAddress` 使用零地址作为默认值，因为验证时不一定有链上用户地址。实际使用时可从 `req.user` 或 proof 元数据中获取。

- [ ] **Step 2: Commit**

```bash
git add backend/services/zkService.js
git commit -m "feat(zk): update async chain verification with full params + status update"
```

---

### Task 6: 配置 + 路由 + 前端

**Files:**
- Modify: `backend/contract-addresses.json`
- Modify: `backend/routes/blockchain.js`
- Modify: `frontend/src/pages/BlockchainExplorer.js`

- [ ] **Step 1: 补充 Verifier 合约地址**

在 `backend/contract-addresses.json` 的 `fisco-bcos.contracts` 中补充 Verifier 地址：

```json
{
  "fisco-bcos": {
    "network": "fisco-bcos",
    "chainId": 1,
    "groupId": 1,
    "rpcUrl": "http://127.0.0.1:8545",
    "deployer": "0x6645B20a1B128E344F765016aF86D332499537f5",
    "contracts": {
      "AuditStorage": "0x29613a0e24579e3ce9da2387f1d41f5ccf68b24c",
      "ZKPVerifier": "0x7d139b0b297886c5211de878ee93244cc46ddf66",
      "Verifier": "0x0000000000000000000000000000000000000000"
    },
    "deployedAt": "2026-05-18T16:28:00.000Z"
  }
}
```

注意：Verifier 地址需要在重新部署 ZKPVerifier 后，通过 `deploy-fisco.js` 部署 Verifier 合约并填入实际地址。此处先用占位地址，部署后更新。

- [ ] **Step 2: 更新 /explorer 端点返回数据**

在 `backend/routes/blockchain.js` 的 `/explorer` 端点（第 28-37 行）中，对 ZKP 类型记录补充链上验证字段：

```javascript
router.get('/explorer', requireBlockchain, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const data = await blockchainService.getExplorerData(limit);

    // 对 ZKP 类型记录补充链上验证状态
    if (data.recentRecords) {
      for (const record of data.recentRecords) {
        if (record.operationType === 'zkp' && record.proofId) {
          try {
            const zkpResult = await blockchainService.getZKPResult(record.proofId);
            if (zkpResult) {
              record.chainVerified = zkpResult.chainVerified || false;
              record.chainValid = zkpResult.chainValid || false;
            }
          } catch (e) { /* 查询失败不影响主数据 */ }
        }
      }
    }

    res.json({ success: true, data });
  } catch (error) {
    logger.error('获取区块链数据失败:', error);
    res.status(500).json({ success: false, message: '获取区块链数据失败' });
  }
});
```

- [ ] **Step 3: 前端 BlockchainExplorer - 添加 ZKP 详情弹窗**

在 `frontend/src/pages/BlockchainExplorer.js` 中，在主组件函数内（约第 30 行）新增状态和弹窗组件：

```javascript
const [zkpDetail, setZkpDetail] = useState(null);
const [zkpDetailOpen, setZkpDetailOpen] = useState(false);
const [zkpDetailLoading, setZkpDetailLoading] = useState(false);

const handleZkpDetail = async (proofId) => {
  setZkpDetailOpen(true);
  setZkpDetailLoading(true);
  try {
    const res = await authFetch(`/api/v1/blockchain/zkp-verify/${proofId}`);
    const data = await res.json();
    setZkpDetail(data.success ? data : null);
  } catch (e) {
    setZkpDetail(null);
  } finally {
    setZkpDetailLoading(false);
  }
};
```

- [ ] **Step 4: 前端 - 添加 ZKP 状态标签到记录行**

在记录表格的 ZKP 状态显示区域（第 242-253 行），将现有的纯文本显示改为带颜色的 Chip 标签：

```jsx
{record.operationType === 'zkp' && (
  <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
    {record.chainVerified ? (
      <Chip
        size="small"
        label={record.chainValid ? '链上验证通过' : '链上验证失败'}
        color={record.chainValid ? 'success' : 'error'}
        variant="outlined"
      />
    ) : (
      <Chip size="small" label="待验证" color="default" variant="outlined" />
    )}
    {record.proofId && (
      <Button size="small" onClick={() => handleZkpDetail(record.proofId)}>
        查看详情
      </Button>
    )}
  </Box>
)}
```

确认文件顶部已导入 `Chip` 组件（从 `@mui/material`）。

- [ ] **Step 5: 前端 - 添加 ZKP 详情弹窗 JSX**

在组件 return 的末尾（`</Box>` 之前）添加 Dialog：

```jsx
<Dialog open={zkpDetailOpen} onClose={() => setZkpDetailOpen(false)} maxWidth="sm" fullWidth>
  <DialogTitle>ZKP 链上验证详情</DialogTitle>
  <DialogContent>
    {zkpDetailLoading ? (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    ) : zkpDetail ? (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
        <Typography variant="body2"><strong>Proof ID:</strong> {zkpDetail.proofId || '-'}</Typography>
        <Typography variant="body2"><strong>Proof Hash:</strong> {zkpDetail.proofHash || '-'}</Typography>
        <Typography variant="body2"><strong>链下验证:</strong> {zkpDetail.isValid ? '有效' : '无效'}</Typography>
        <Typography variant="body2"><strong>链上验证:</strong> {zkpDetail.chainVerified ? (zkpDetail.chainValid ? '通过' : '失败') : '待验证'}</Typography>
        <Typography variant="body2"><strong>提交者:</strong> {zkpDetail.submitter || '-'}</Typography>
        <Typography variant="body2"><strong>上链时间:</strong> {zkpDetail.timestamp ? formatTime(zkpDetail.timestamp) : '-'}</Typography>
      </Box>
    ) : (
      <Typography color="text.secondary" sx={{ py: 2 }}>无验证数据</Typography>
    )}
  </DialogContent>
  <DialogActions>
    <Button onClick={() => setZkpDetailOpen(false)}>关闭</Button>
  </DialogActions>
</Dialog>
```

确认文件顶部已导入 `Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress` 组件。

- [ ] **Step 6: Commit**

```bash
git add backend/contract-addresses.json backend/routes/blockchain.js frontend/src/pages/BlockchainExplorer.js
git commit -m "feat: add ZKP chain verification status display + detail modal"
```

---

### Task 7: 部署验证

**Files:**
- 部署脚本运行

- [ ] **Step 1: 重新部署 ZKPVerifier 合约到 FISCO BCOS**

由于 ZKPVerifier.sol 结构体变更，需要重新部署：

```bash
cd backend
node scripts/deploy-fisco.js
```

部署后更新 `backend/contract-addresses.json` 中的 ZKPVerifier 和 Verifier 地址。

- [ ] **Step 2: 重启后端服务并验证初始化日志**

```bash
cd backend
node server.js
```

检查日志中是否有：
- `FISCO BCOS 区块链服务初始化完成`
- Verifier 合约地址已加载（非 undefined）

- [ ] **Step 3: 手动测试链上 ZKP 验证**

通过前端生成一个信用证明，检查后端日志中是否有：
- `链上 ZKP 验证完成`（成功时）
- `ZKP 链上验证状态更新成功`

- [ ] **Step 4: 验证前端 BlockchainExplorer 显示**

打开前端区块链浏览器页面，检查：
- ZKP 类型记录是否显示状态标签（链上验证通过/待验证）
- 点击"查看详情"是否弹出 Dialog 并显示完整验证信息

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: complete ZKP chain verification integration"
```
