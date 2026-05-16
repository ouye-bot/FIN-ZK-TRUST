# 智能合约本地部署与集成指南

本指南详细介绍了基于Hardhat本地私链的智能合约部署与系统集成步骤，适用于大学生密码技术竞赛演示与技术验证。

## 一、环境搭建

### 1. 系统要求
- Windows 10/11
- Node.js ≥ 16.0.0
- npm ≥ 7.0.0

### 2. 安装核心工具
```bash
# 全局安装Hardhat
npm install -g hardhat

# 全局安装Ethers.js
npm install -g ethers

# 全局安装Circom2.0
npm install -g circom

# 全局安装snarkjs
npm install -g snarkjs
```

### 3. 项目初始化
```bash
# 进入合约目录
cd contracts

# 安装项目依赖
npm install
```

## 二、零知识证明电路编译

### 1. 编译电路
```bash
# 进入circuits目录
cd ../circuits

# 执行编译脚本
node compile.js
```

这将生成以下文件：
- `build/credit.r1cs` - 电路约束系统
- `build/credit.wasm` - 电路WebAssembly
- `build/credit_final.zkey` - 证明密钥
- `build/verification_key.json` - 验证密钥
- `build/Verifier.sol` - 自动生成的验证合约

### 2. 复制验证合约
```bash
# 复制生成的Verifier.sol到contracts目录
copy build\Verifier.sol ../contracts\contracts\
```

## 三、智能合约编译与部署

### 1. 编译合约
```bash
# 进入contracts目录
cd ../contracts

# 编译合约
npx hardhat compile
```

### 2. 启动本地私链
```bash
# 启动Hardhat本地私链
npx hardhat node
```

### 3. 部署合约
```bash
# 在新终端窗口中执行部署脚本
npx hardhat run scripts/deploy.js --network localhost
```

部署成功后，会生成以下文件：
- `contract-addresses.json` - 合约部署地址
- `contract-address-local.json` - 本地部署地址配置

## 四、系统集成

### 1. 后端集成

1. **安装依赖**
```bash
# 进入后端目录
cd ../backend

# 安装Ethers.js和dotenv
npm install ethers dotenv
```

2. **复制配置文件**
```bash
# 复制合约地址配置
copy ../contracts\contract-address-local.json .\config\

# 复制ABI文件
copy ../contracts\abi\* .\config\abi\

# 复制交互模板
copy ../contracts\integration\contractInteraction.js .\services\
```

3. **集成代码示例**
```javascript
// 在后端服务中引入合约交互模块
const contractInteraction = require('./services/contractInteraction');

// 监听链上事件
contractInteraction.listenToEvents((eventName, eventData) => {
  console.log(`收到事件: ${eventName}`, eventData);
  // 在这里更新后端数据库
});

// 借款操作示例
async function borrow(amount, duration, proof, publicSignals, sm3Hash) {
  try {
    const receipt = await contractInteraction.borrow(
      amount,
      duration,
      proof,
      publicSignals,
      sm3Hash
    );
    console.log('借款成功:', receipt.transactionHash);
    return receipt;
  } catch (error) {
    console.error('借款失败:', error);
    throw error;
  }
}
```

### 2. 前端集成

前端不需要直接与区块链交互，而是通过后端API进行操作。所有区块链相关展示数据均从后端数据库获取。

## 五、功能测试

### 1. 测试脚本
```bash
# 运行Hardhat控制台
npx hardhat console --network localhost

# 在控制台中测试合约功能
const FinZkTrust = await ethers.getContractFactory("FinZkTrust");
const finZkTrust = await FinZkTrust.attach("0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");

# 查询资金池余额
await finZkTrust.getPoolBalances();

# 测试出资
await finZkTrust.invest(ethers.utils.parseEther("100"), 30 * 24 * 60 * 60, { value: ethers.utils.parseEther("100") });

# 测试赎回
await finZkTrust.redeem(ethers.utils.parseEther("50"));
```

### 2. 全流程演示
```bash
# 执行全流程演示脚本
node scripts/demo.js
```

## 六、问题排查

### 1. 常见问题

#### 问题：Hardhat节点启动失败
**解决方案：**
- 检查端口8545是否被占用
- 执行 `npx hardhat clean` 清理缓存
- 重新启动节点

#### 问题：合约编译失败
**解决方案：**
- 检查Solidity版本是否为0.8.19
- 检查依赖是否正确安装
- 执行 `npx hardhat compile --force` 强制重新编译

#### 问题：合约部署失败
**解决方案：**
- 确保本地私链已启动
- 检查Gas设置是否合理
- 确保部署账户有足够的ETH

#### 问题：零知识证明验证失败
**解决方案：**
- 检查证明参数格式是否正确
- 确保电路文件与验证密钥匹配
- 检查SM3哈希值是否正确

#### 问题：系统与本地私链连接失败
**解决方案：**
- 检查RPC地址是否正确（http://127.0.0.1:8545）
- 确保本地私链正在运行
- 检查网络配置是否正确

### 2. 日志查看

```bash
# 查看Hardhat节点日志
# 在启动节点的终端窗口中查看

# 查看合约部署日志
# 在执行部署脚本的终端窗口中查看

# 查看系统日志
cd ../backend/logs
```

## 七、技术支持

如果遇到无法解决的问题，请参考以下资源：

- [Hardhat文档](https://hardhat.org/docs)
- [Ethers.js文档](https://docs.ethers.io/v5/)
- [Circom文档](https://docs.circom.io/)
- [snarkjs文档](https://github.com/iden3/snarkjs)

## 八、交付物清单

- ✅ 完整的Hardhat合约工程文件夹
- ✅ 优化后的Solidity智能合约（Verifier.sol、FinZkTrust.sol）
- ✅ 本地环境配置文件（hardhat.config.js）
- ✅ 自动化脚本（deploy.js）
- ✅ 合约ABI文件与部署地址配置文件（abi文件夹、contract-address-local.json）
- ✅ 系统后端可直接引入的合约交互模板（integration/contractInteraction.js）
- ✅ 本地部署与集成说明文档（README.md）

---

**注意：** 本指南中的所有操作均为本地操作，无需外网、无需第三方付费服务。所有生成的文件均可直接使用，满足大学生密码技术竞赛的技术与展示要求。