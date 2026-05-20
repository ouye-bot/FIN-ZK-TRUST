/**
 * FISCO BCOS 合约部署脚本
 * 纯 Node.js 实现，使用 FISCO BCOS JSON-RPC sendTransaction 接口
 *
 * FISCO BCOS 2.x 交易格式（sm_crypto=false 时使用 ECDSA 签名）:
 *   签名数据: keccak256(rlp([randomid, blockLimit, to, data, value, gasPrice, gasLimit, chainId, groupId, extraData]))
 *   发送格式: rlp([randomid, blockLimit, to, data, value, gasPrice, gasLimit, v, r, s])
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const RPC_URL = process.env.FISCO_BCOS_RPC_URL || 'http://127.0.0.1:8545';
const CHAIN_ID = parseInt(process.env.FISCO_BCOS_CHAIN_ID || '1');
const GROUP_ID = parseInt(process.env.FISCO_BCOS_GROUP_ID || '1');

// FISCO BCOS 预置测试账户私钥（开发测试用）
const PRIVATE_KEY =
  process.env.FISCO_BCOS_PRIVATE_KEY ||
  '0x4c0883a69102937d6231471b5dbb6204fe512961708279f0ccfd5c3ef3e2e6c4';

// ========== JSON-RPC 工具函数 ==========

function rpcCall(method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() });
    const url = new URL(RPC_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname || '/',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 30000
    };

    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
          else resolve(parsed.result);
        } catch (e) {
          reject(new Error(`RPC parse error: ${data.substring(0, 300)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('RPC timeout')); });
    req.write(body);
    req.end();
  });
}

// ========== FISCO BCOS 交易签名 ==========

// 将数值转为 RLP 兼容的 hex 字符串（ethers v5 RLP 要求偶数长度 hex）
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
  // FISCO BCOS 2.x 交易签名（sm_crypto=false, ECDSA）
  // 签名前数据: RLP([randomid, gasPrice, gasLimit, blockLimit, to, value, data, chainId, groupId, extraData])

  const fields = [
    randomid,          // bytes32 随机数
    toRlpHex(gasPrice),
    toRlpHex(gasLimit),
    blockLimit,
    to || '0x',        // 合约创建时 to 为空
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

  const signedFields = [
    ...fields,
    toRlpHex(v),
    sig.r,
    sig.s
  ];

  return ethers.utils.RLP.encode(signedFields);
}

// ========== 主流程 ==========

async function main() {
  console.log('=== FISCO BCOS 合约部署 ===\n');
  console.log(`节点: ${RPC_URL}, 链ID: ${CHAIN_ID}, 组ID: ${GROUP_ID}\n`);

  // 1. 验证连接
  let version;
  try {
    version = await rpcCall('getClientVersion');
    console.log(`节点版本: ${version['FISCO-BCOS Version']}`);
  } catch (e) {
    console.error('无法连接 FISCO BCOS 节点:', e.message);
    process.exit(1);
  }

  // 获取当前区块
  const blockHex = await rpcCall('getBlockNumber', [GROUP_ID]);
  const currentBlock = parseInt(blockHex, 16);
  console.log(`当前区块: ${currentBlock}\n`);

  // 2. 部署者信息
  const wallet = new ethers.Wallet(PRIVATE_KEY);
  const sender = wallet.address;
  console.log(`部署者地址: ${sender}\n`);

  // 3. 加载合约
  const artifactsDir = path.join(__dirname, '../../contracts/artifacts/contracts');
  const contracts = {};

  for (const name of ['AuditStorage', 'ZKPVerifier', 'Verifier']) {
    const artifactPath = path.join(artifactsDir, `${name}.sol/${name}.json`);
    if (!fs.existsSync(artifactPath)) {
      console.error(`找不到 ${name} 编译产物: ${artifactPath}`);
      process.exit(1);
    }
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    contracts[name] = { abi: artifact.abi, bytecode: artifact.bytecode };
    console.log(`已加载 ${name}: ABI ${artifact.abi.length} 条, bytecode ${artifact.bytecode.length} 字符`);
  }

  console.log('');

  // 4. 部署合约
  const deployed = {};

  for (const [name, { abi, bytecode }] of Object.entries(contracts)) {
    console.log(`正在部署 ${name}...`);

    try {
      // 随机 ID
      const randomid = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      // blockLimit = 当前区块 + 500
      const blockLimit = ethers.utils.hexlify(currentBlock + 500);

      const txParams = {
        randomid,
        blockLimit,
        to: '0x',        // 空地址 = 合约创建
        data: bytecode,
        value: '0x0',
        gasPrice: '0x0',
        gasLimit: ethers.utils.hexlify(300000000), // 300M（与 genesis 配置一致）
        chainId: CHAIN_ID,
        groupId: GROUP_ID,
        extraData: '0x'
      };

      const signedTx = signFiscoTx(PRIVATE_KEY, txParams);

      // 发送交易（FISCO BCOS sendRawTransaction 返回交易哈希字符串）
      const txHash = await rpcCall('sendRawTransaction', [GROUP_ID, signedTx]);
      console.log(`  交易哈希: ${txHash}`);

      // 等待上链后查询 receipt 获取合约地址
      await new Promise(r => setTimeout(r, 1500));
      const receipt = await rpcCall('getTransactionReceipt', [GROUP_ID, txHash]);

      if (receipt && receipt.contractAddress) {
        deployed[name] = receipt.contractAddress;
        console.log(`✓ ${name} 部署成功!`);
        console.log(`  合约地址: ${receipt.contractAddress}`);
        console.log(`  区块高度: ${parseInt(receipt.blockNumber, 16)}`);
      } else {
        console.log(`✗ ${name} 部署未能获取合约地址`);
        console.log(`  Receipt:`, JSON.stringify(receipt));
      }
    } catch (error) {
      console.error(`✗ ${name} 部署失败: ${error.message}`);
    }
  }

  console.log('');

  // 5. 授权部署者为操作员
  if (deployed.AuditStorage) {
    console.log('\n正在授权部署者为 AuditStorage 操作员...');
    try {
      const authData = new ethers.utils.Interface(['function authorizeOperator(address)'])
        .encodeFunctionData('authorizeOperator', [sender]);

      const randomid2 = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      const blockLimit2 = ethers.utils.hexlify(currentBlock + 500);
      const signedAuth = signFiscoTx(PRIVATE_KEY, {
        randomid: randomid2, blockLimit: blockLimit2,
        to: deployed.AuditStorage, data: authData,
        value: '0x0', gasPrice: '0x0', gasLimit: ethers.utils.hexlify(300000000),
        chainId: CHAIN_ID, groupId: GROUP_ID, extraData: '0x'
      });
      await rpcCall('sendRawTransaction', [GROUP_ID, signedAuth]);
      console.log('✓ AuditStorage 授权成功');
    } catch (e) {
      console.error('AuditStorage 授权失败:', e.message);
    }
  }

  if (deployed.ZKPVerifier) {
    console.log('正在授权部署者为 ZKPVerifier 操作员...');
    try {
      const authData = new ethers.utils.Interface(['function authorizeOperator(address)'])
        .encodeFunctionData('authorizeOperator', [sender]);

      const randomid3 = ethers.utils.hexlify(ethers.utils.randomBytes(32));
      const blockLimit3 = ethers.utils.hexlify(currentBlock + 500);
      const signedAuth = signFiscoTx(PRIVATE_KEY, {
        randomid: randomid3, blockLimit: blockLimit3,
        to: deployed.ZKPVerifier, data: authData,
        value: '0x0', gasPrice: '0x0', gasLimit: ethers.utils.hexlify(300000000),
        chainId: CHAIN_ID, groupId: GROUP_ID, extraData: '0x'
      });
      await rpcCall('sendRawTransaction', [GROUP_ID, signedAuth]);
      console.log('✓ ZKPVerifier 授权成功');
    } catch (e) {
      console.error('ZKPVerifier 授权失败:', e.message);
    }
  }

  // 6. 写入地址文件
  if (Object.keys(deployed).length > 0) {
    const addressesPath = path.join(__dirname, '../contract-addresses.json');
    let addresses = {};
    if (fs.existsSync(addressesPath)) {
      addresses = JSON.parse(fs.readFileSync(addressesPath, 'utf8'));
    }

    addresses['fisco-bcos'] = {
      network: 'fisco-bcos',
      chainId: CHAIN_ID,
      groupId: GROUP_ID,
      rpcUrl: RPC_URL,
      deployer: sender,
      contracts: { ...addresses['fisco-bcos']?.contracts, ...deployed },
      deployedAt: new Date().toISOString()
    };

    fs.writeFileSync(addressesPath, JSON.stringify(addresses, null, 2));
    console.log(`合约地址已写入: ${addressesPath}`);
    console.log(JSON.stringify(addresses['fisco-bcos'], null, 2));
  } else {
    console.log('没有合约部署成功');
  }

  console.log('\n=== 完成 ===');
}

main().catch(error => {
  console.error('部署异常:', error.message);
  process.exit(1);
});
