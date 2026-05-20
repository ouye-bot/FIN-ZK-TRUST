/**
 * 智能合约部署脚本
 * 部署所有合约到 Hardhat 本地私链
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

  const [deployer] = await ethers.getSigners();
  console.log("部署者地址:", deployer.address);
  const balance = await deployer.getBalance();
  console.log("部署者余额:", ethers.utils.formatEther(balance), "ETH\n");

  const addresses = {};

  // 1. 部署 AuditStorage
  console.log("正在部署 AuditStorage 合约...");
  const AuditStorage = await ethers.getContractFactory("AuditStorage");
  const auditStorage = await AuditStorage.deploy();
  await auditStorage.deployed();
  addresses.AuditStorage = auditStorage.address;
  console.log("  AuditStorage 地址:", auditStorage.address);

  // 2. 部署 ZKPVerifier
  console.log("正在部署 ZKPVerifier 合约...");
  const ZKPVerifier = await ethers.getContractFactory("ZKPVerifier");
  const zkpVerifier = await ZKPVerifier.deploy();
  await zkpVerifier.deployed();
  addresses.ZKPVerifier = zkpVerifier.address;
  console.log("  ZKPVerifier 地址:", zkpVerifier.address);

  // 3. 部署 TransactionHashStorage
  console.log("正在部署 TransactionHashStorage 合约...");
  const TransactionHashStorage = await ethers.getContractFactory("TransactionHashStorage");
  const txHashStorage = await TransactionHashStorage.deploy();
  await txHashStorage.deployed();
  addresses.TransactionHashStorage = txHashStorage.address;
  console.log("  TransactionHashStorage 地址:", txHashStorage.address);

  // 4. 部署 Verifier (ZKP Groth16)
  console.log("正在部署 Verifier 合约...");
  const Verifier = await ethers.getContractFactory("Verifier");
  const verifier = await Verifier.deploy();
  await verifier.deployed();
  addresses.Verifier = verifier.address;
  console.log("  Verifier 地址:", verifier.address);

  // 5. 部署 FinZkTrust
  console.log("正在部署 FinZkTrust 合约...");
  const FinZkTrust = await ethers.getContractFactory("FinZkTrust");
  const finZkTrust = await FinZkTrust.deploy(verifier.address);
  await finZkTrust.deployed();
  addresses.FinZkTrust = finZkTrust.address;
  console.log("  FinZkTrust 地址:", finZkTrust.address);

  // 保存合约地址
  const contractAddresses = {
    network: "localhost",
    chainId: 31337,
    deployer: deployer.address,
    contracts: addresses,
    deployedAt: new Date().toISOString()
  };

  const addressesPath = path.join(__dirname, "../contract-address-local.json");
  fs.writeFileSync(addressesPath, JSON.stringify(contractAddresses, null, 2));
  console.log("\n合约地址已保存到:", addressesPath);

  const backendAddressesPath = path.join(__dirname, "../../backend/contract-addresses.json");
  fs.writeFileSync(backendAddressesPath, JSON.stringify(contractAddresses, null, 2));
  console.log("合约地址已保存到:", backendAddressesPath);

  // 验证合约功能
  console.log("\n验证合约功能...");

  // 授权 deployer 为 AuditStorage 操作员
  await auditStorage.authorizeOperator(deployer.address);
  console.log("  AuditStorage: deployer 已授权为操作员");

  // 授权 deployer 为 ZKPVerifier 操作员
  await zkpVerifier.authorizeOperator(deployer.address);
  console.log("  ZKPVerifier: deployer 已授权为操作员");

  // 测试存储
  const testHash = ethers.utils.hexZeroPad("0x1234567890abcdef", 32);
  const tx = await auditStorage.storeAuditHash(testHash, Math.floor(Date.now() / 1000), "test", "user_001");
  await tx.wait();
  console.log("  测试审计哈希存储成功！");

  const count = await auditStorage.getTotalRecords();
  console.log("  当前审计记录总数:", count.toString());

  console.log("\n========================================");
  console.log("所有合约部署和验证完成！");
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("部署失败:", error);
    process.exit(1);
  });
