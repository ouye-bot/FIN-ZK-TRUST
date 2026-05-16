/**
 * 智能合约部署脚本 - 部署所有合约
 * 部署 AuditStorage、ZKPVerifier 和 TransactionHashStorage 合约到 Hardhat 本地私链
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("========================================");
  console.log("开始部署所有智能合约到 Hardhat 本地私链...");
  console.log("链ID: 31337");
  console.log("RPC: http://127.0.0.1:8545");
  console.log("========================================\n");

  // 获取部署者账户
  const [deployer] = await ethers.getSigners();
  console.log("部署者地址:", deployer.address);
  
  // 获取部署者余额
  const balance = await deployer.getBalance();
  console.log("部署者余额:", ethers.utils.formatEther(balance), "ETH\n");

  const contractAddresses = {
    network: "localhost",
    chainId: 31337,
    deployer: deployer.address,
    contracts: {},
    deployedAt: new Date().toISOString()
  };

  // 部署 AuditStorage 合约
  console.log("正在部署 AuditStorage 合约...");
  const AuditStorage = await ethers.getContractFactory("AuditStorage");
  const auditStorage = await AuditStorage.deploy();
  await auditStorage.deployed();
  contractAddresses.contracts.AuditStorage = auditStorage.address;
  console.log("AuditStorage 合约地址:", auditStorage.address);

  // 部署 ZKPVerifier 合约
  console.log("正在部署 ZKPVerifier 合约...");
  const ZKPVerifier = await ethers.getContractFactory("ZKPVerifier");
  const zkpVerifier = await ZKPVerifier.deploy();
  await zkpVerifier.deployed();
  contractAddresses.contracts.ZKPVerifier = zkpVerifier.address;
  console.log("ZKPVerifier 合约地址:", zkpVerifier.address);

  // 部署 TransactionHashStorage 合约（向后兼容）
  console.log("\n正在部署 TransactionHashStorage 合约...");
  const TransactionHashStorage = await ethers.getContractFactory("TransactionHashStorage");
  const transactionHashStorage = await TransactionHashStorage.deploy();
  await transactionHashStorage.deployed();
  contractAddresses.contracts.TransactionHashStorage = transactionHashStorage.address;
  console.log("TransactionHashStorage 合约地址:", transactionHashStorage.address);

  console.log("\n========================================");
  console.log("所有合约部署成功！");
  console.log("========================================");
  console.log("合约部署详情:");
  console.log("AuditStorage:", contractAddresses.contracts.AuditStorage);
  console.log("ZKPVerifier:", contractAddresses.contracts.ZKPVerifier);
  console.log("TransactionHashStorage:", contractAddresses.contracts.TransactionHashStorage);
  console.log("========================================\n");

  // 保存合约地址到文件
  const addressesPath = path.join(__dirname, "../contract-address-local.json");
  fs.writeFileSync(addressesPath, JSON.stringify(contractAddresses, null, 2));
  console.log("合约地址已保存到:", addressesPath);

  // 同时保存到 backend 目录供后端使用
  const backendAddressesPath = path.join(__dirname, "../../backend/contract-addresses.json");
  fs.writeFileSync(backendAddressesPath, JSON.stringify(contractAddresses, null, 2));
  console.log("合约地址已保存到:", backendAddressesPath);

  console.log("\n========================================");
  console.log("合约部署完成！");
  console.log("========================================");
  console.log("\n使用说明:");
  console.log("1. 确保 Hardhat 本地节点正在运行: npx hardhat node");
  console.log("2. 后端服务会自动读取合约地址并连接");
  console.log("========================================");
}

// 运行部署脚本
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("部署失败:", error);
    process.exit(1);
  });
