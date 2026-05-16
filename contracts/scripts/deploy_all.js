const { ethers } = require("hardhat");

async function main() {
  console.log("开始部署合约...");

  const AuditStorage = await ethers.getContractFactory("AuditStorage");
  const auditStorage = await AuditStorage.deploy();
  await auditStorage.waitForDeployment();
  console.log("AuditStorage:", await auditStorage.getAddress());

  const UserRegistry = await ethers.getContractFactory("UserRegistry");
  const userRegistry = await UserRegistry.deploy();
  await userRegistry.waitForDeployment();
  console.log("UserRegistry:", await userRegistry.getAddress());

  const ZKPVerifier = await ethers.getContractFactory("ZKPVerifier");
  const zkpVerifier = await ZKPVerifier.deploy();
  await zkpVerifier.waitForDeployment();
  console.log("ZKPVerifier:", await zkpVerifier.getAddress());

  const addresses = {
    network: "localhost",
    chainId: 31337,
    deployer: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    contracts: {
      TransactionHashStorage: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      AuditStorage: await auditStorage.getAddress(),
      UserRegistry: await userRegistry.getAddress(),
      ZKPVerifier: await zkpVerifier.getAddress()
    },
    deployedAt: new Date().toISOString()
  };

  console.log("\n" + JSON.stringify(addresses, null, 2));
}

main().catch(console.error).finally(() => process.exit(0));