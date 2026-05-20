/**
 * FISCO BCOS 端到端业务验证脚本
 * 验证：注册→登录→更新公钥(触发链上注册)→信用证明→借款 全流程链上存证
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const SM2_PRIVATE_KEY = 'cee21fd4eb3694729b8997b1f52793d3f05ee7e417e54c7224823b6e05f33a50';
const SM2_PUBLIC_KEY = '04c41687818b21b8a57cf9ae71c976c8b3c2c1a54d877d2ae4eafc440b13f39bc2d3d630182ce6a5326ea6185793a852d0bc2fe7056effbea67eebe877c6af04d0';

function httpReq(method, reqPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'localhost', port: 3003, path: reqPath, method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function fiscoCall(contractName, contractAddress, method, params = '') {
  return new Promise((resolve) => {
    const cmd = `call ${contractName} ${contractAddress} ${method} ${params}`.trim();
    const consoleDir = '/home/ouye/fisco-bcos-node/console';
    const tmpFile = path.join(os.tmpdir(), `fisco_e2e_${Date.now()}_${Math.random().toString(36).slice(2)}.sh`);
    const script = `#!/bin/bash\ncd "${consoleDir}" && printf '${cmd}\\nquit\\n' | java -Djdk.tls.namedGroups="SM2,secp256k1,x25519,secp256r1,secp384r1,secp521r1" -cp "apps/*:conf/:lib/*:classes/:accounts/" console.Console 1 2>&1`;
    fs.writeFileSync(tmpFile, script);
    const wslPath = tmpFile.replace(/\\/g, '/').replace(/^([A-Z]):/i, (_, d) => `/mnt/${d.toLowerCase()}`);
    exec(`wsl -e bash "${wslPath}"`, { timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      const output = stdout || '';
      const returnMatch = output.match(/Return values?:\s*\(?([^)\n]*)\)?/);
      resolve(returnMatch ? returnMatch[1].trim() : null);
    });
  });
}

// Run a Node.js snippet in a subprocess with correct module paths
function runSnippet(code) {
  return new Promise((resolve, reject) => {
    const backendDir = path.join(__dirname, '..').replace(/\\/g, '/');
    // Use path.join in the snippet to handle spaces in paths
    const absCode = `
      const path = require('path');
      const BD = '${backendDir}';
      ${code.replace(/require\('\.\/(.*?)'\)/g, "require(path.join(BD, '$1'))")}
    `;
    const tmpFile = path.join(os.tmpdir(), `snippet_${Date.now()}.js`);
    fs.writeFileSync(tmpFile, absCode);
    exec(`node "${tmpFile}"`, { timeout: 30000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      const output = stdout || stderr || '';
      // Find the last complete JSON object or last non-log line
      const lines = output.split('\n').filter(l => l.trim());
      let result = '';
      for (const line of lines) {
        const trimmed = line.trim();
        // Skip log lines (start with [timestamp] or similar)
        if (/^\[/.test(trimmed) || /^ZKP|^SM2|^区块链|^开始/.test(trimmed)) continue;
        result = trimmed;
      }
      if (result) resolve(result);
      else if (err) reject(new Error(output || err.message));
      else resolve('');
    });
  });
}

const AUDIT_ADDRESS = '0x2120a04c10aa422fec543cb40f2f0c1ccd8d6a01';

async function main() {
  console.log('========================================');
  console.log('  FISCO BCOS 端到端业务验证');
  console.log('========================================');

  // 0. Initial chain state
  console.log('\n--- 0. 初始链上记录数 ---');
  const initVal = await fiscoCall('AuditStorage', AUDIT_ADDRESS, 'getTotalRecords');
  const initCount = parseInt(initVal) || 0;
  console.log('初始链上记录数:', initCount);

  // 1. Register
  console.log('\n--- 1. 注册用户 ---');
  const username = 'e2e_' + Date.now();
  const password = 'Test@12345678';
  const regRes = await httpReq('POST', '/api/v1/auth/register', {
    username, password, sm2PublicKey: SM2_PUBLIC_KEY
  });
  console.log('注册:', regRes.status, regRes.body.success ? '✅ SUCCESS' : '❌ ' + regRes.body.message);
  if (!regRes.body.success) return;
  const userId = regRes.body.user.id;
  console.log('  userId:', userId);

  // 2. Login
  console.log('\n--- 2. 登录 ---');
  const loginRes = await httpReq('POST', '/api/v1/auth/login', { username, password });
  console.log('登录:', loginRes.status, loginRes.body.success ? '✅ SUCCESS' : '❌ ' + loginRes.body.message);
  if (!loginRes.body.success) return;
  const token = loginRes.body.token;

  // 3. Update public key (triggers blockchain registration)
  console.log('\n--- 3. 更新公钥 (触发链上注册) ---');
  const updateRes = await httpReq('PUT', `/api/v1/users/${userId}/update-sm2-key`, {
    sm2PublicKey: SM2_PUBLIC_KEY
  }, { 'Authorization': 'Bearer ' + token });
  console.log('更新公钥:', updateRes.status, updateRes.body.success ? '✅ SUCCESS' : '❌ ' + (updateRes.body.message || JSON.stringify(updateRes.body)));

  console.log('\n--- 等待链上注册 (8s) ---');
  await new Promise(r => setTimeout(r, 8000));
  const afterRegVal = await fiscoCall('AuditStorage', AUDIT_ADDRESS, 'getTotalRecords');
  const afterRegCount = parseInt(afterRegVal) || 0;
  console.log('注册后链上记录数:', afterRegCount, afterRegCount > initCount ? '✅ (+新增)' : '(未变)');

  // 4. Generate ZK proof
  console.log('\n--- 4. 生成 ZK 信用证明 ---');
  let proofResult;
  try {
    const proofJson = await runSnippet(`
      const { generateProof } = require('./services/zkService');
      generateProof(650, 600, 1).then(r => console.log(JSON.stringify(r))).catch(e => { console.error(e.message); process.exit(1); });
    `);
    proofResult = JSON.parse(proofJson);
    console.log('✅ ZK 证明生成成功');
  } catch (e) {
    console.log('❌ ZK 证明生成失败:', e.message);
    return;
  }

  // 5. Submit credit proof via API
  console.log('\n--- 5. 提交信用证明 ---');
  const proofRes = await httpReq('POST', '/api/v1/credit/generate-proof', {
    userId,
    proof: proofResult.proof,
    publicSignals: proofResult.publicSignals
  }, {
    'Authorization': 'Bearer ' + token,
    'x-user-id': String(userId),
    'x-request-timestamp': String(Date.now()),
    'x-request-nonce': crypto.randomUUID()
  });
  console.log('信用证明:', proofRes.status, proofRes.body.success ? '✅ SUCCESS' : '❌ ' + (proofRes.body.message || JSON.stringify(proofRes.body)));
  const proofId = proofRes.body.data?.proof?.proofId || proofRes.body.proofId;
  const verificationCode = proofRes.body.data?.proof?.verificationCode || proofRes.body.verificationCode;
  console.log('  proofId:', proofId);
  console.log('  verificationCode:', verificationCode);

  if (!proofId) {
    console.log('❌ 无法获取 proofId，跳过借款');
    return;
  }

  // 6. Sign and submit borrow request
  console.log('\n--- 6. 借款 500 元 ---');
  // buildSignatureData: {"amount":500,"creditProofId":"proof_xxx","userId":"123"}
  const sigData = `{"amount":500,"creditProofId":"${proofId}","userId":"${userId}"}`;
  const signature = await runSnippet(`
    const { signWithSM2 } = require('./utils/cryptoUtils');
    const sig = signWithSM2('${sigData}', '${SM2_PRIVATE_KEY}');
    process.stdout.write(sig);
  `);
  // Extract hex signature from output (may have log lines mixed in)
  const cleanSignature = signature.split('\n').filter(l => /^[0-9a-f]{100,}/.test(l))[0] || signature;

  const borrowBody = {
    userId,
    amount: 500,
    creditProof: {
      id: proofId,
      proof: proofResult.proof,
      publicSignals: proofResult.publicSignals
    },
    verificationCode,
    signature,
    term: 30
  };

  const borrowRes = await httpReq('POST', '/api/v1/loan/borrow', borrowBody, {
    'Authorization': 'Bearer ' + token,
    'x-user-id': String(userId),
    'x-request-timestamp': String(Date.now()),
    'x-request-nonce': crypto.randomUUID()
  });
  console.log('借款:', borrowRes.status, borrowRes.body.success ? '✅ SUCCESS' : '❌ ' + (borrowRes.body.message || JSON.stringify(borrowRes.body)));
  if (borrowRes.body.transaction) {
    console.log('  交易ID:', borrowRes.body.transaction.id);
  }

  // 7. Wait for blockchain
  console.log('\n--- 等待借款上链 (10s) ---');
  await new Promise(r => setTimeout(r, 10000));
  const afterBorrowVal = await fiscoCall('AuditStorage', AUDIT_ADDRESS, 'getTotalRecords');
  const afterBorrowCount = parseInt(afterBorrowVal) || 0;
  console.log('借款后链上记录数:', afterBorrowCount, afterBorrowCount > afterRegCount ? '✅ (+新增)' : '(未变)');

  // 8. Pool status
  console.log('\n--- 7. 资金池 ---');
  const poolRes = await httpReq('GET', '/api/v1/pool', null, { 'Authorization': 'Bearer ' + token });
  if (poolRes.body.data) {
    console.log('总可用:', poolRes.body.data.available_amount, '| 已借出:', poolRes.body.data.loaned_amount);
  }

  // Summary
  console.log('\n========================================');
  console.log('  链上审计: ' + initCount + ' → ' + afterBorrowCount);
  console.log('  存证伴随: ' + (afterBorrowCount > initCount ? '✅ 是' : '❌ 否'));
  console.log('========================================');
}

main().catch(console.error);
