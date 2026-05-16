require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

// Hardhat默认私钥账户（仅用于本地开发和竞赛演示）
const HARDHAT_PRIVATE_KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // 账户0
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // 账户1
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // 账户2
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // 账户3
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f27c8cc057bf1", // 账户4
];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
  networks: {
    hardhat: {
      chainId: 31337, // Hardhat默认私链ID
      accounts: HARDHAT_PRIVATE_KEYS.map(privateKey => ({
        privateKey,
        balance: "10000000000000000000000" // 10000 ETH
      }))
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      accounts: HARDHAT_PRIVATE_KEYS
    }
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
