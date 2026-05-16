/**
 * 智能合约部署脚本
 * 部署 TransactionHashStorage 合约到 Hardhat 本地私链
 * 国密SM3+私链不可篡改+ZK零知识隐私核验三合一安全架构
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("========================================");
  console.log("开始部署智能合约到 Hardhat 本地私链...");
  console.log("链ID: 31337");
  console.log("RPC: http://127.0.0.1:8545");
  console.log("========================================\n");

  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log("部署者地址:", deployer.address);
  
  // 获取部署者余额
  const balance = await deployer.getBalance();
  console.log("部署者余额:", ethers.utils.formatEther(balance), "ETH\n");

  // 部署 TransactionHashStorage 合约
  console.log("正在部署 TransactionHashStorage 合约...");
  const TransactionHashStorage = await ethers.getContractFactory("TransactionHashStorage");
  const transactionHashStorage = await TransactionHashStorage.deploy();
  
  await transactionHashStorage.deployed();
  
  console.log("\n========================================");
  console.log("合约部署成功！");
  console.log("========================================");
  console.log("合约名称: TransactionHashStorage");
  console.log("合约地址:", transactionHashStorage.address);
  console.log("部署交易哈希:", transactionHashStorage.deployTransaction.hash);
  console.log("区块号:", transactionHashStorage.deployTransaction.blockNumber);
  console.log("Gas 使用:", transactionHashStorage.deployTransaction.gasLimit.toString());
  console.log("========================================\n");

  // 保存合约地址到文件
  const contractAddresses = {
    network: "localhost",
    chainId: 31337,
    deployer: deployer.address,
    contracts: {
      TransactionHashStorage: transactionHashStorage.address
    },
    deployedAt: new Date().toISOString()
  };

  // 保存到 contracts 目录
  const addressesPath = path.join(__dirname, "../contract-address-local.json");
  fs.writeFileSync(addressesPath, JSON.stringify(contractAddresses, null, 2));
  console.log("合约地址已保存到:", addressesPath);

  // 同时保存到 backend 目录供后端使用
  const backendAddressesPath = path.join(__dirname, "../../backend/contract-addresses.json");
  fs.writeFileSync(backendAddressesPath, JSON.stringify(contractAddresses, null, 2));
  console.log("合约地址已保存到:", backendAddressesPath);

  // 验证合约功能
  console.log("\n验证合约功能...");
  
  // 测试存储一个示例交易哈希
  const testTransactionId = ethers.utils.formatBytes32String("TEST_TX_001");
  const testSm3Hash = ethers.utils.hexZeroPad("0x1234567890abcdef", 32);
  
  console.log("测试交易ID:", testTransactionId);
  console.log("测试SM3哈希:", testSm3Hash);
  
  const tx = await transactionHashStorage.storeTransactionHash(
    testTransactionId,
    testSm3Hash,
    "test",
    "user_001"
  );
  
  await tx.wait();
  console.log("测试交易哈希存储成功！");
  
  // 查询交易总数
  const count = await transactionHashStorage.getTransactionCount();
  console.log("当前交易总数:", count.toString());
  
  // 查询存储的交易哈希
  const storedHash = await transactionHashStorage.getTransactionHash(testTransactionId);
  console.log("存储的交易哈希:", storedHash.sm3Hash);
  
  console.log("\n========================================");
  console.log("合约部署和验证完成！");
  console.log("========================================");
  console.log("\n使用说明:");
  console.log("1. 确保 Hardhat 本地节点正在运行: npx hardhat node");
  console.log("2. 后端服务会自动读取合约地址并连接");
  console.log("3. 所有交易哈希将自动上链存证");
  console.log("========================================");
}

// 运行部署脚本
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("部署失败:", error);
    process.exit(1);
  });
