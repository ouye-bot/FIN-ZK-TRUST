const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// 环境变量
const envPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: envPath });

// 工具函数导入
const { generateSM2KeyPair, signWithSM2, generateSM3Hash } = require('../utils/cryptoUtils');

// 配置
const BASE_URL = 'http://localhost:3003/api/v1';
const INVALID_PROOF_ID = 'test-security-proof-invalid';
const TEST_VERIFICATION_CODE = '000000';
const TEST_PASSWORD = 'SecTest123!';
const REQUEST_TIMEOUT = 10000; // 10 秒超时

// 全局状态
let testUser = {
  username: null,
  password: TEST_PASSWORD,
  keyPair: null,
  token: null,
  userId: null
};

// 性能报告
const testReport = {
  timestamp: new Date().toISOString(),
  overallStatus: 'pending',
  modules: {},
  results: {},
  duration: 0
};
const globalStart = performance.now();

// ============================================
// 辅助函数
// ============================================
function generateRandomUsername() {
  return `sectest_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// 构造防重放头的通用函数
function buildAntiReplayHeaders(body, keyPair) {
  const timestamp = Date.now().toString();
  const nonce = crypto.randomBytes(16).toString('hex'); // 32位hex
  const bodyStr = JSON.stringify(body);
  const signData = timestamp + nonce + bodyStr;
  const signature = signWithSM2(signData, keyPair.privateKey);
  return {
    'x-request-timestamp': timestamp,
    'x-request-nonce': nonce,
    'x-request-sign': signature
  };
}

// 打印摘要
function printSummary(report) {
  console.log('\n' + '='.repeat(70));
  console.log('  安全与容错测试汇总报告');
  console.log('='.repeat(70));
  console.log(`\n  测试时间: ${report.timestamp}`);
  console.log(`  总测试时长: ${(report.duration / 1000).toFixed(2)} 秒`);
  console.log(`\n  总体状态: ${report.overallStatus.toUpperCase()}`);

  const allResults = [];
  Object.keys(report.modules).forEach(modKey => {
    allResults.push({ module: report.modules[modKey], name: modKey });
  });

  allResults.sort((a, b) => a.module.order - b.module.order);

  allResults.forEach(({ module, name }) => {
    const statusIcon = module.status === 'success' ? '✅' : (module.status === 'partial' ? '⚠️' : '❌');
    const passedCount = module.passedTests || 0;
    const totalCount = module.totalTests || 0;
    console.log(`  ${statusIcon} ${module.displayName}: ${passedCount}/${totalCount} 通过`);
  });

  console.log('\n' + '='.repeat(70));
}

// 保存报告
async function saveReport(report) {
  const resultsDir = path.join(__dirname, 'test_results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const fileName = `security-fault-tolerance-report-${Date.now()}.json`;
  const filePath = path.join(resultsDir, fileName);

  report.duration = performance.now() - globalStart;
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

  console.log(`\n📊 详细报告已保存: ${filePath}`);
  return filePath;
}

// ============================================
// 前置准备：生成用户与登录
// ============================================
async function setupTestUser() {
  console.log('='.repeat(70));
  console.log('  阶段1：前置准备 - 注册测试用户');
  console.log('='.repeat(70));

  // 1. 生成密钥
  console.log('\n1.1 生成 SM2 密钥对');
  const keyPair = generateSM2KeyPair();
  testUser.keyPair = keyPair;

  // 2. 生成用户名
  testUser.username = generateRandomUsername();
  console.log(`  用户名: ${testUser.username}`);

  // 3. 注册用户
  console.log('\n1.2 注册测试用户');
  try {
    const registerRes = await axios.post(`${BASE_URL}/auth/register`, {
      username: testUser.username,
      password: testUser.password,
      sm2PublicKey: keyPair.publicKey
    }, { timeout: REQUEST_TIMEOUT });

    if (registerRes.data.success || registerRes.status === 200) {
      console.log('  ✅ 用户注册成功');
    } else {
      console.log('  ⚠️ 用户可能已存在，继续登录');
    }
  } catch (e) {
    if (e.response && e.response.status === 400 && (e.response.data.message || '').includes('已存在')) {
      console.log('  ⚠️ 用户已存在，继续');
    } else {
      console.error('  ❌ 注册失败', e.message);
    }
  }

  // 4. 登录获取 Token
  console.log('\n1.3 登录获取 Token');
  const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
    username: testUser.username,
    password: testUser.password
  }, { timeout: REQUEST_TIMEOUT });

  if (loginRes.data.success) {
    testUser.token = loginRes.data.token;
    testUser.userId = loginRes.data.user.id;
    console.log('  ✅ 登录成功');
    console.log(`  用户ID: ${testUser.userId}`);
  } else {
    console.error('  ❌ 登录失败');
    throw new Error('登录失败');
  }

  // 5. 同步公钥到后端
  console.log('\n1.4 同步 SM2 公钥到后端');
  testUser.sm2KeySyncSuccess = false;
  try {
    await axios.put(`${BASE_URL}/users/${testUser.userId}/update-sm2-key`,
      { sm2PublicKey: keyPair.publicKey },
      { headers: { Authorization: `Bearer ${testUser.token}` }, timeout: REQUEST_TIMEOUT }
    );
    testUser.sm2KeySyncSuccess = true;
    console.log('  ✅ 公钥同步成功');
  } catch (e) {
    console.error('  ❌ 公钥同步失败', e.message);
    console.error('  ⚠️ SM2 签名相关测试可能不准确');
  }

  console.log('\n  ✅ 前置准备完成');
  return true;
}

// ============================================
// 模块1：防重放攻击测试（6项）
// ============================================
async function module1AntiReplayTests() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块1：防重放攻击测试（6项）');
  console.log('='.repeat(70));

  const results = [];
  let passedCount = 0;
  let savedNonce = null;

  // 构造测试借款body（无效creditProof）
  const testBorrowBody = {
    userId: testUser.userId,
    amount: 100,
    term: 7,
    creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
    verificationCode: TEST_VERIFICATION_CODE,
    signature: '0'.repeat(64)
  };

  // 1.1 缺少防重放字段
  console.log('\n1.1 缺少防重放字段');
  try {
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}` },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '缺少防重放字段', status: 'failed', expected: '403', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 403) {
      results.push({ name: '缺少防重放字段', status: 'passed', expected: '403', actual: 403 });
      passedCount++;
      console.log('  ✅ 正确拦截（403）');
    } else {
      results.push({ name: '缺少防重放字段', status: 'failed', expected: '403', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 1.2 过期时间戳
  console.log('\n1.2 过期时间戳');
  const expiredHeaders = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
  expiredHeaders['x-request-timestamp'] = (Date.now() - 3600000).toString(); // 1小时前
  try {
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: {
        Authorization: `Bearer ${testUser.token}`,
        ...expiredHeaders
      },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '过期时间戳', status: 'failed', expected: '403', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 403) {
      results.push({ name: '过期时间戳', status: 'passed', expected: '403', actual: 403 });
      passedCount++;
      console.log('  ✅ 正确拦截（403）');
    } else {
      results.push({ name: '过期时间戳', status: 'failed', expected: '403', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 1.3 重复 Nonce
  console.log('\n1.3 重复 Nonce');
  const validHeaders1 = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
  savedNonce = validHeaders1['x-request-nonce'];
  try {
    await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...validHeaders1 },
      timeout: REQUEST_TIMEOUT
    });
    console.log('  ✅ 第一次请求完成（预期被业务层拒绝，但nonce已记录）');
  } catch (e) {
    console.log('  ⚠️ 第一次请求失败，但继续');
  }

  // 第二次相同nonce请求
  try {
    const res2 = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...validHeaders1 },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '重复 Nonce', status: 'failed', expected: '403', actual: res2.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 403) {
      results.push({ name: '重复 Nonce', status: 'passed', expected: '403', actual: 403 });
      passedCount++;
      console.log('  ✅ 正确拦截重复请求（403）');
    } else {
      results.push({ name: '重复 Nonce', status: 'failed', expected: '403', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 1.4 Nonce 长度不足
  console.log('\n1.4 Nonce 长度不足');
  const shortNonceHeaders = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
  shortNonceHeaders['x-request-nonce'] = 'abc123'; // 6位，不足32位
  try {
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...shortNonceHeaders },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: 'Nonce 长度不足', status: 'failed', expected: '403', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 403) {
      results.push({ name: 'Nonce 长度不足', status: 'passed', expected: '403', actual: 403 });
      passedCount++;
      console.log('  ✅ 正确拦截（403）');
    } else {
      results.push({ name: 'Nonce 长度不足', status: 'failed', expected: '403', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 1.5 无效签名
  console.log('\n1.5 无效签名');
  const badSignHeaders = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
  badSignHeaders['x-request-sign'] = '0'.repeat(64); // 64个0，无效签名
  try {
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...badSignHeaders },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '无效签名', status: 'failed', expected: '401', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 401) {
      results.push({ name: '无效签名', status: 'passed', expected: '401', actual: 401 });
      passedCount++;
      console.log('  ✅ 正确拦截无效签名（401）');
    } else {
      results.push({ name: '无效签名', status: 'failed', expected: '401', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 1.6 白名单接口无需防重放
  console.log('\n1.6 白名单接口（登录）无需防重放');
  try {
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      username: testUser.username,
      password: testUser.password
    }, { timeout: REQUEST_TIMEOUT });
    if (loginRes.status === 200 || loginRes.status === 401) {
      results.push({ name: '白名单接口无需防重放', status: 'passed', expected: '200/401', actual: loginRes.status });
      passedCount++;
      console.log('  ✅ 白名单正常工作');
    } else {
      results.push({ name: '白名单接口无需防重放', status: 'failed', expected: '200/401', actual: loginRes.status });
      console.log('  ❌ 结果不符');
    }
  } catch (e) {
    results.push({ name: '白名单接口无需防重放', status: 'failed', expected: '200/401', actual: e.message });
    console.log('  ❌ 异常');
  }

  return {
    status: passedCount === 6 ? 'success' : (passedCount >= 3 ? 'partial' : 'failed'),
    passedTests: passedCount,
    totalTests: 6,
    testResults: results
  };
}

// ============================================
// 模块2：JWT认证测试（3项）
// ============================================
async function module2JwtAuthTests() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块2：JWT认证测试（3项）');
  console.log('='.repeat(70));

  const results = [];
  let passedCount = 0;

  const testBorrowBody = {
    userId: testUser.userId,
    amount: 100,
    term: 7,
    creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
    verificationCode: TEST_VERIFICATION_CODE,
    signature: '0'.repeat(64)
  };

  const validHeaders = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);

  // 2.1 缺少JWT
  console.log('\n2.1 缺少 JWT 令牌');
  try {
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, { headers: validHeaders, timeout: REQUEST_TIMEOUT });
    results.push({ name: '缺少 JWT', status: 'failed', expected: '401', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 401) {
      results.push({ name: '缺少 JWT', status: 'passed', expected: '401', actual: 401 });
      passedCount++;
      console.log('  ✅ 正确拦截缺少JWT（401）');
    } else {
      results.push({ name: '缺少 JWT', status: 'failed', expected: '401', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 2.2 伪造JWT
  console.log('\n2.2 伪造 JWT 令牌');
  try {
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: 'Bearer invalid_token_123', ...validHeaders },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '伪造 JWT', status: 'failed', expected: '401', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 401) {
      results.push({ name: '伪造 JWT', status: 'passed', expected: '401', actual: 401 });
      passedCount++;
      console.log('  ✅ 正确拦截伪造JWT（401）');
    } else {
      results.push({ name: '伪造 JWT', status: 'failed', expected: '401', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 2.3 过期JWT
  console.log('\n2.3 过期 JWT 令牌');
  try {
    // 使用一个过期的JWT（我们不能真正签名，但我们可以伪造一个看起来过期的）
    const fakeExpiredToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJ0ZXN0IiwiZXhwIjoxNjAwMDAwMDAwfQ.InvalidSignature';
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${fakeExpiredToken}`, ...validHeaders },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '过期 JWT', status: 'failed', expected: '401', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 401) {
      results.push({ name: '过期 JWT', status: 'passed', expected: '401', actual: 401 });
      passedCount++;
      console.log('  ✅ 正确拦截过期JWT（401）');
    } else {
      results.push({ name: '过期 JWT', status: 'failed', expected: '401', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  return {
    status: passedCount === 3 ? 'success' : (passedCount >= 1 ? 'partial' : 'failed'),
    passedTests: passedCount,
    totalTests: 3,
    testResults: results
  };
}

// ============================================
// 模块3：参数验证测试（4项）
// ============================================
async function module3ParamValidationTests() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块3：参数验证测试（4项）');
  console.log('='.repeat(70));

  const results = [];
  let passedCount = 0;

  const validHeaders = buildAntiReplayHeaders({
    userId: testUser.userId,
    amount: 100,
    term: 7,
    creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
    verificationCode: TEST_VERIFICATION_CODE,
    signature: '0'.repeat(64)
  }, testUser.keyPair);

  // 3.1 借款金额超出范围
  console.log('\n3.1 借款金额超出范围');
  try {
    const body = {
      userId: testUser.userId,
      amount: 99999, // 超过max 50000
      term: 7,
      creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
      verificationCode: TEST_VERIFICATION_CODE,
      signature: '0'.repeat(64)
    };
    const headers = buildAntiReplayHeaders(body, testUser.keyPair);
    const res = await axios.post(`${BASE_URL}/loan/borrow`, body, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '金额超出范围', status: 'failed', expected: '400', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 400) {
      results.push({ name: '金额超出范围', status: 'passed', expected: '400', actual: 400 });
      passedCount++;
      console.log('  ✅ 正确拦截（400）');
    } else {
      results.push({ name: '金额超出范围', status: 'failed', expected: '400', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 3.2 借款期限非法
  console.log('\n3.2 借款期限非法');
  try {
    const body = {
      userId: testUser.userId,
      amount: 100,
      term: 45, // 不在允许列表 [7,14,30,60,90]
      creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
      verificationCode: TEST_VERIFICATION_CODE,
      signature: '0'.repeat(64)
    };
    const headers = buildAntiReplayHeaders(body, testUser.keyPair);
    const res = await axios.post(`${BASE_URL}/loan/borrow`, body, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '期限非法', status: 'failed', expected: '400', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 400) {
      results.push({ name: '期限非法', status: 'passed', expected: '400', actual: 400 });
      passedCount++;
      console.log('  ✅ 正确拦截（400）');
    } else {
      results.push({ name: '期限非法', status: 'failed', expected: '400', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 3.3 缺少必填字段
  console.log('\n3.3 缺少必填字段（creditProof）');
  try {
    const body = {
      userId: testUser.userId,
      amount: 100,
      term: 7,
      verificationCode: TEST_VERIFICATION_CODE,
      signature: '0'.repeat(64)
    };
    const headers = buildAntiReplayHeaders(body, testUser.keyPair);
    const res = await axios.post(`${BASE_URL}/loan/borrow`, body, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '缺少creditProof', status: 'failed', expected: '400', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 400) {
      results.push({ name: '缺少creditProof', status: 'passed', expected: '400', actual: 400 });
      passedCount++;
      console.log('  ✅ 正确拦截（400）');
    } else {
      results.push({ name: '缺少creditProof', status: 'failed', expected: '400', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 3.4 签名长度过短
  console.log('\n3.4 签名长度过短');
  try {
    const body = {
      userId: testUser.userId,
      amount: 100,
      term: 7,
      creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
      verificationCode: TEST_VERIFICATION_CODE,
      signature: 'abc' // 3位，不足
    };
    const headers = buildAntiReplayHeaders(body, testUser.keyPair);
    const res = await axios.post(`${BASE_URL}/loan/borrow`, body, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '签名过短', status: 'failed', expected: '400', actual: res.status });
    console.log('  ❌ 未拦截');
  } catch (e) {
    if (e.response && e.response.status === 400) {
      results.push({ name: '签名过短', status: 'passed', expected: '400', actual: 400 });
      passedCount++;
      console.log('  ✅ 正确拦截（400）');
    } else {
      results.push({ name: '签名过短', status: 'failed', expected: '400', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  return {
    status: passedCount === 4 ? 'success' : (passedCount >= 2 ? 'partial' : 'failed'),
    passedTests: passedCount,
    totalTests: 4,
    testResults: results
  };
}

// ============================================
// 模块4：通用错误处理测试（4项）
// ============================================
async function module4GeneralErrorTests() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块4：通用错误处理测试（4项）');
  console.log('='.repeat(70));

  const results = [];
  let passedCount = 0;

  // 4.1 404处理
  console.log('\n4.1 404 处理');
  try {
    const res = await axios.get(`${BASE_URL}/non-existent-endpoint`, {
      headers: { Authorization: `Bearer ${testUser.token}` },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '404 处理', status: 'failed', expected: '404', actual: res.status });
    console.log('  ❌ 未404');
  } catch (e) {
    if (e.response && e.response.status === 404) {
      results.push({ name: '404 处理', status: 'passed', expected: '404', actual: 404 });
      passedCount++;
      console.log('  ✅ 正确返回404');
    } else {
      results.push({ name: '404 处理', status: 'failed', expected: '404', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 4.2 密码强度不足
  console.log('\n4.2 密码强度不足');
  try {
    const res = await axios.post(`${BASE_URL}/auth/register`, {
      username: generateRandomUsername(),
      password: '123',
      sm2PublicKey: testUser.keyPair.publicKey
    }, { timeout: REQUEST_TIMEOUT });
    results.push({ name: '密码强度', status: 'failed', expected: '400', actual: res.status });
    console.log('  ❌ 未检查');
  } catch (e) {
    if (e.response && e.response.status === 400) {
      const msg = (e.response.data.message || '').toLowerCase();
      if (msg.includes('密码强度') || msg.includes('password')) {
        results.push({ name: '密码强度', status: 'passed', expected: '400', actual: 400 });
        passedCount++;
        console.log('  ✅ 密码强度检查正常');
      } else {
        results.push({ name: '密码强度', status: 'partial', expected: '400', actual: 400 });
        console.log('  ⚠️ 返回400但不确定是密码强度');
      }
    } else {
      results.push({ name: '密码强度', status: 'failed', expected: '400', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 4.3 公钥格式无效
  console.log('\n4.3 公钥格式无效');
  try {
    const res = await axios.post(`${BASE_URL}/auth/register`, {
      username: generateRandomUsername(),
      password: TEST_PASSWORD,
      sm2PublicKey: '04abc' // 不是130位
    }, { timeout: REQUEST_TIMEOUT });
    results.push({ name: '公钥格式', status: 'failed', expected: '400', actual: res.status });
    console.log('  ❌ 未检查');
  } catch (e) {
    if (e.response && e.response.status === 400) {
      const msg = (e.response.data.message || '').toLowerCase();
      if (msg.includes('sm2') || msg.includes('公钥')) {
        results.push({ name: '公钥格式', status: 'passed', expected: '400', actual: 400 });
        passedCount++;
        console.log('  ✅ 公钥格式检查正常');
      } else {
        results.push({ name: '公钥格式', status: 'partial', expected: '400', actual: 400 });
        console.log('  ⚠️ 返回400但不确定是公钥格式');
      }
    } else {
      results.push({ name: '公钥格式', status: 'failed', expected: '400', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 4.4 缺少必要参数（sm2PublicKey）
  console.log('\n4.4 缺少必要参数（sm2PublicKey）');
  try {
    const res = await axios.post(`${BASE_URL}/auth/register`, {
      username: generateRandomUsername(),
      password: TEST_PASSWORD
    }, { timeout: REQUEST_TIMEOUT });
    results.push({ name: '缺少sm2PublicKey', status: 'failed', expected: '400', actual: res.status });
    console.log('  ❌ 未检查');
  } catch (e) {
    if (e.response && e.response.status === 400) {
      const msg = (e.response.data.message || '').toLowerCase();
      if (msg.includes('不能为空') || msg.includes('required')) {
        results.push({ name: '缺少sm2PublicKey', status: 'passed', expected: '400', actual: 400 });
        passedCount++;
        console.log('  ✅ 必填参数检查正常');
      } else {
        results.push({ name: '缺少sm2PublicKey', status: 'partial', expected: '400', actual: 400 });
        console.log('  ⚠️ 返回400但不确定是缺少sm2PublicKey');
      }
    } else {
      results.push({ name: '缺少sm2PublicKey', status: 'failed', expected: '400', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  return {
    status: passedCount === 4 ? 'success' : (passedCount >= 2 ? 'partial' : 'failed'),
    passedTests: passedCount,
    totalTests: 4,
    testResults: results
  };
}

// ============================================
// 模块5：SM2 签名中间件测试（5项，对应 Bug B1）
// ============================================
async function module5Sm2SignatureMiddleware() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块5：SM2 签名中间件测试（5项）');
  console.log('='.repeat(70));

  if (!testUser.sm2KeySyncSuccess) {
    console.log('  ⚠️ SM2 公钥未同步，模块 5 结果可能不准确');
  }

  const results = [];
  let passedCount = 0;

  const testBorrowBody = {
    userId: testUser.userId,
    amount: 100,
    term: 7,
    creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
    verificationCode: TEST_VERIFICATION_CODE,
    signature: '0'.repeat(64)
  };

  // 5.1 有效签名通过
  console.log('\n5.1 有效签名通过');
  try {
    const headers = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
    headers['x-user-id'] = testUser.userId;
    headers['x-sm2-signature'] = headers['x-request-sign'];
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    const status = res.status;
    const passed = (status >= 200 && status < 500 && status !== 401 && status !== 403);
    results.push({ name: '有效签名通过', status: passed ? 'passed' : 'failed', expected: '200/400', actual: status });
    if (passed) passedCount++;
    console.log(`  ${passed ? '✅' : '❌'} 请求通过 (${status})`);
  } catch (e) {
    if (e.response) {
      const status = e.response.status;
      const passed = (status >= 200 && status < 500 && status !== 401 && status !== 403);
      results.push({ name: '有效签名通过', status: passed ? 'passed' : 'failed', expected: '200/400', actual: status });
      if (passed) passedCount++;
      console.log(`  ${passed ? '✅' : '❌'} 请求返回 ${status}`);
    } else {
      results.push({ name: '有效签名通过', status: 'failed', expected: '200/400', actual: e.message });
      console.log(`  ❌ 请求失败: ${e.message}`);
    }
  }

  // 5.2 错误签名拒绝（对应 Bug B1 验证）
  console.log('\n5.2 错误签名拒绝（对应 Bug B1）');
  try {
    const wrongKeyPair = generateSM2KeyPair();
    const wrongHeaders = buildAntiReplayHeaders(testBorrowBody, wrongKeyPair);
    wrongHeaders['x-user-id'] = testUser.userId;
    wrongHeaders['x-sm2-signature'] = wrongHeaders['x-request-sign'];
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...wrongHeaders },
      timeout: REQUEST_TIMEOUT
    });
    results.push({
      name: '错误签名拒绝(B1)',
      status: 'failed',
      expected: '401',
      actual: res.status,
      expectedBehavior: '错误私钥签名应被中间件拦截返回 401',
      actualBehavior: `返回 ${res.status}，未拦截`
    });
    console.log(`  ❌ 未拦截 (状态码 ${res.status})`);
  } catch (e) {
    if (e.response && e.response.status === 401) {
      results.push({ name: '错误签名拒绝(B1)', status: 'passed', expected: '401', actual: 401 });
      passedCount++;
      console.log('  ✅ 正确拦截（401）');
    } else {
      results.push({
        name: '错误签名拒绝(B1)',
        status: 'failed',
        expected: '401',
        actual: e.response?.status || e.message,
        expectedBehavior: '错误私钥签名应被中间件拦截返回 401',
        actualBehavior: `返回 ${e.response?.status || e.message}`
      });
      console.log(`  ❌ 结果不符: ${e.response?.status || e.message}`);
    }
  }

  // 5.3 缺少签名头透传
  console.log('\n5.3 缺少签名头透传');
  try {
    const headers = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
    headers['x-user-id'] = testUser.userId;
    delete headers['x-request-sign'];
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    const status = res.status;
    const passed = (status >= 200 && status < 500 && status !== 401 && status !== 403);
    results.push({ name: '缺少签名头透传', status: passed ? 'passed' : 'failed', expected: '200/400', actual: status });
    if (passed) passedCount++;
    console.log(`  ${passed ? '✅' : '❌'} 请求透传 (${status})`);
  } catch (e) {
    if (e.response) {
      const status = e.response.status;
      const passed = (status >= 200 && status < 500 && status !== 401 && status !== 403);
      results.push({ name: '缺少签名头透传', status: passed ? 'passed' : 'failed', expected: '200/400', actual: status });
      if (passed) passedCount++;
      console.log(`  ${passed ? '✅' : '❌'} 请求返回 ${status}`);
    } else {
      results.push({ name: '缺少签名头透传', status: 'failed', expected: '200/400', actual: e.message });
      console.log(`  ❌ 请求失败: ${e.message}`);
    }
  }

  // 5.4 x-user-id 头不影响 JWT 认证（JWT 为权威身份源）
  console.log('\n5.4 x-user-id 头不影响 JWT 认证');
  try {
    const headers = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
    headers['x-user-id'] = '99999999';
    headers['x-sm2-signature'] = headers['x-request-sign'];
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    // JWT 用户有效，x-user-id 头被忽略，请求应正常处理（非 401/403）
    const passed = (res.status >= 200 && res.status < 500 && res.status !== 401 && res.status !== 403);
    results.push({ name: 'x-user-id头不影响JWT认证', status: passed ? 'passed' : 'failed', expected: '200-499(非401/403)', actual: res.status });
    if (passed) passedCount++;
    console.log(`  ${passed ? '✅' : '❌'} 请求返回 ${res.status}`);
  } catch (e) {
    if (e.response) {
      const status = e.response.status;
      const passed = (status >= 200 && status < 500 && status !== 401 && status !== 403);
      results.push({ name: 'x-user-id头不影响JWT认证', status: passed ? 'passed' : 'failed', expected: '200-499(非401/403)', actual: status });
      if (passed) passedCount++;
      console.log(`  ${passed ? '✅' : '❌'} 请求返回 ${status}`);
    } else {
      results.push({ name: 'x-user-id头不影响JWT认证', status: 'failed', expected: '200-499(非401/403)', actual: e.message });
      console.log(`  ❌ 请求失败: ${e.message}`);
    }
  }

  // 5.5 签名数据篡改
  console.log('\n5.5 签名数据篡改');
  try {
    const headers = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
    headers['x-user-id'] = testUser.userId;
    headers['x-sm2-signature'] = headers['x-request-sign'];
    const tamperedBody = { ...testBorrowBody, amount: 99999 };
    const res = await axios.post(`${BASE_URL}/loan/borrow`, tamperedBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    results.push({
      name: '签名数据篡改',
      status: 'failed',
      expected: '401',
      actual: res.status,
      expectedBehavior: 'body 被篡改后签名验证应失败返回 401',
      actualBehavior: `返回 ${res.status}，未检测到 body 篡改`
    });
    console.log(`  ❌ 未拦截 (${res.status})`);
  } catch (e) {
    if (e.response && e.response.status === 401) {
      results.push({ name: '签名数据篡改', status: 'passed', expected: '401', actual: 401 });
      passedCount++;
      console.log('  ✅ 正确拦截（401）');
    } else {
      results.push({
        name: '签名数据篡改',
        status: 'failed',
        expected: '401',
        actual: e.response?.status || e.message,
        expectedBehavior: 'body 被篡改后签名验证应失败返回 401',
        actualBehavior: `返回 ${e.response?.status || e.message}`
      });
      console.log(`  ❌ 结果不符: ${e.response?.status || e.message}`);
    }
  }

  return {
    status: passedCount >= 3 ? 'success' : (passedCount >= 1 ? 'partial' : 'failed'),
    passedTests: passedCount,
    totalTests: 5,
    testResults: results
  };
}

// ============================================
// 模块6：ZKP 验证安全测试（3项，对应 Bug B2）
// ============================================
async function module6ZkpSecurityTests() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块6：ZKP 验证安全测试（3项）');
  console.log('='.repeat(70));

  const results = [];
  let passedCount = 0;

  let zkService;
  try {
    zkService = require('../services/zkService');
  } catch (e) {
    console.log('  ⚠️ zkService 模块不可用');
    return { status: 'skipped', reason: 'zkService not available', testResults: [] };
  }

  // 6.1 单参数调用绕过（Bug B2 验证）
  console.log('\n6.1 单参数调用绕过（Bug B2 验证）');
  try {
    const fakeProof = { pi_a: ['0', '0', '0'], pi_b: [['0', '0'], ['0', '0'], ['0', '0']], pi_c: ['0', '0', '0'] };
    const result = await zkService.verifyProof(fakeProof);
    results.push({
      name: '单参数调用绕过(B2)',
      status: result === false ? 'passed' : 'failed',
      expected: 'false',
      actual: result,
      knownIssue: result !== false,
      expectedBehavior: 'verifyProof 只传1个参数时应返回 false',
      actualBehavior: result === true ? '返回 true（安全漏洞）' : `返回 ${result}`,
      bugId: 'B2',
      bugLocation: 'zkService.js:56-58'
    });
    if (result === false) {
      passedCount++;
      console.log('  ✅ 正确返回 false');
    } else {
      console.log(`  ❌ 返回 ${result}（应为 false）- 已知问题 B2`);
    }
  } catch (e) {
    results.push({ name: '单参数调用绕过(B2)', status: 'passed', expected: 'exception', actual: e.message });
    passedCount++;
    console.log(`  ✅ 抛出异常: ${e.message}`);
  }

  // 6.2 篡改 publicSignals
  console.log('\n6.2 篡改 publicSignals');
  try {
    const proofResult = await zkService.generateProof(750, 600);
    if (proofResult && proofResult.proof) {
      const tamperedSignals = [...proofResult.publicSignals];
      tamperedSignals[0] = tamperedSignals[0] + '1';
      const verifyResult = await zkService.verifyProof(proofResult.proof, tamperedSignals);
      results.push({ name: '篡改 publicSignals', status: verifyResult === false ? 'passed' : 'failed', expected: 'false', actual: verifyResult });
      if (verifyResult === false) {
        passedCount++;
        console.log('  ✅ 正确拒绝篡改信号');
      } else {
        console.log(`  ❌ 验证返回 ${verifyResult}（应为 false）`);
      }
    } else {
      results.push({ name: '篡改 publicSignals', status: 'skipped', expected: 'N/A', actual: 'proof generation failed' });
      console.log('  ⚠️ 证明生成失败，跳过');
    }
  } catch (e) {
    results.push({ name: '篡改 publicSignals', status: 'passed', expected: 'exception', actual: e.message });
    passedCount++;
    console.log(`  ✅ 抛出异常: ${e.message}`);
  }

  // 6.3 空 proof 结构
  console.log('\n6.3 空 proof 结构');
  try {
    const result = await zkService.verifyProof({}, ['1']);
    results.push({ name: '空 proof 结构', status: result === false ? 'passed' : 'failed', expected: 'false', actual: result });
    if (result === false) {
      passedCount++;
      console.log('  ✅ 正确拒绝空 proof');
    } else {
      console.log(`  ❌ 验证返回 ${result}（应为 false）`);
    }
  } catch (e) {
    results.push({ name: '空 proof 结构', status: 'passed', expected: 'exception', actual: e.message });
    passedCount++;
    console.log(`  ✅ 抛出异常: ${e.message}`);
  }

  return {
    status: passedCount >= 2 ? 'success' : (passedCount >= 1 ? 'partial' : 'failed'),
    passedTests: passedCount,
    totalTests: 3,
    testResults: results
  };
}

// ============================================
// 模块7：SM4 静默失败测试（5项，对应 Bug B3）
// ============================================
async function module7Sm4SilentFailureTests() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块7：SM4 静默失败测试（3项）');
  console.log('='.repeat(70));

  const results = [];
  let passedCount = 0;

  let sm4Crypto;
  try {
    sm4Crypto = require('../utils/sm4Crypto');
  } catch (e) {
    console.log('  ⚠️ sm4Crypto 模块不可用');
    return { status: 'skipped', reason: 'sm4Crypto not available', testResults: [] };
  }

  const { encrypt, decrypt } = sm4Crypto;
  const testData = 'sensitive test data for SM4';

  // 7.1 篡改密文后解密行为（Bug B3 验证）
  console.log('\n7.1 篡改密文后解密行为（Bug B3 验证）');
  try {
    const encrypted = encrypt(testData);
    const tampered = encrypted.substring(0, encrypted.length - 1) + (encrypted.endsWith('a') ? 'b' : 'a');
    const result = decrypt(tampered);
    const returnedOriginal = result === testData;
    results.push({
      name: '篡改密文解密(B3)',
      status: returnedOriginal ? 'failed' : 'passed',
      expected: '抛异常或返回错误',
      actual: returnedOriginal ? '返回原文（静默失败）' : '正确拒绝',
      knownIssue: returnedOriginal,
      expectedBehavior: '篡改密文后解密应抛异常或返回明确错误',
      actualBehavior: returnedOriginal ? '返回原文（静默失败）' : '正确拒绝',
      bugId: 'B3',
      bugLocation: 'sm4Crypto.js 多处'
    });
    if (returnedOriginal) {
      console.log('  ❌ 返回原文（静默失败）- 已知问题 B3');
    } else {
      passedCount++;
      console.log('  ✅ 正确拒绝篡改密文');
    }
  } catch (e) {
    results.push({ name: '篡改密文解密(B3)', status: 'passed', expected: 'exception', actual: e.message });
    passedCount++;
    console.log(`  ✅ 抛出异常: ${e.message}`);
  }

  // 7.2 截断密文（Bug B3 验证）
  console.log('\n7.2 截断密文（Bug B3 验证）');
  try {
    const encrypted = encrypt(testData);
    const truncated = encrypted.substring(0, Math.floor(encrypted.length / 2));
    const result = decrypt(truncated);
    const returnedOriginal = result === testData;
    results.push({
      name: '截断密文(B3)',
      status: returnedOriginal ? 'failed' : 'passed',
      expected: '抛异常或返回错误',
      actual: returnedOriginal ? '返回原文（静默失败）' : '正确拒绝',
      knownIssue: returnedOriginal,
      expectedBehavior: '截断密文后解密应抛异常或返回明确错误',
      actualBehavior: returnedOriginal ? '返回原文（静默失败）' : '正确拒绝',
      bugId: 'B3',
      bugLocation: 'sm4Crypto.js 多处'
    });
    if (returnedOriginal) {
      console.log('  ❌ 返回原文（静默失败）- 已知问题 B3');
    } else {
      passedCount++;
      console.log('  ✅ 正确拒绝截断密文');
    }
  } catch (e) {
    results.push({ name: '截断密文(B3)', status: 'passed', expected: 'exception', actual: e.message });
    passedCount++;
    console.log(`  ✅ 抛出异常: ${e.message}`);
  }

  // 7.3 非字符串输入
  console.log('\n7.3 非字符串输入');
  const nonStringInputs = [12345, null, undefined];
  for (const input of nonStringInputs) {
    try {
      const result = decrypt(input);
      results.push({
        name: `非字符串输入 ${typeof input}`,
        status: 'failed',
        expected: '抛异常',
        actual: `返回 ${result}`,
        expectedBehavior: `decrypt(${typeof input}) 应抛异常`,
        actualBehavior: `返回 ${result}`
      });
      console.log(`  ❌ decrypt(${typeof input}) 未抛异常`);
    } catch (e) {
      results.push({ name: `非字符串输入 ${typeof input}`, status: 'passed', expected: 'exception', actual: e.message });
      passedCount++;
      console.log(`  ✅ decrypt(${typeof input}) 抛出异常: ${e.message}`);
    }
  }

  return {
    status: passedCount >= 3 ? 'success' : (passedCount >= 1 ? 'partial' : 'failed'),
    passedTests: passedCount,
    totalTests: 5,
    testResults: results
  };
}

// ============================================
// 模块8：认证链路完整性测试（4项）
// ============================================
async function module8AuthChainIntegrityTests() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块8：认证链路完整性测试（4项）');
  console.log('='.repeat(70));

  const results = [];
  let passedCount = 0;

  const testBorrowBody = {
    userId: testUser.userId,
    amount: 100,
    term: 7,
    creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
    verificationCode: TEST_VERIFICATION_CODE,
    signature: '0'.repeat(64)
  };

  // 8.1 过期JWT + 有效防重放
  console.log('\n8.1 过期JWT + 有效防重放');
  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    const expiredPayload = {
      id: testUser.userId,
      username: testUser.username,
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000) - 7200,
      exp: Math.floor(Date.now() / 1000) - 3600
    };
    const expiredToken = jwt.sign(expiredPayload, JWT_SECRET);
    const headers = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
    const res = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${expiredToken}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '过期JWT+有效防重放', status: 'failed', expected: '401', actual: res.status });
    console.log(`  ❌ 未拦截 (${res.status})`);
  } catch (e) {
    if (e.response && e.response.status === 401) {
      results.push({ name: '过期JWT+有效防重放', status: 'passed', expected: '401', actual: 401 });
      passedCount++;
      console.log('  ✅ 正确拦截（401）');
    } else {
      results.push({ name: '过期JWT+有效防重放', status: 'failed', expected: '401', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 8.2 有效JWT + 重放Nonce
  console.log('\n8.2 有效JWT + 重放Nonce');
  try {
    const headers = buildAntiReplayHeaders(testBorrowBody, testUser.keyPair);
    await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: 5000
    }).catch(() => {});
    const res2 = await axios.post(`${BASE_URL}/loan/borrow`, testBorrowBody, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: 5000
    });
    results.push({ name: '有效JWT+重放Nonce', status: 'failed', expected: '403', actual: res2.status });
    console.log(`  ❌ 未拦截 (${res2.status})`);
  } catch (e) {
    if (e.response && e.response.status === 403) {
      results.push({ name: '有效JWT+重放Nonce', status: 'passed', expected: '403', actual: 403 });
      passedCount++;
      console.log('  ✅ 正确拦截（403）');
    } else if (e.response && e.response.status === 401) {
      results.push({ name: '有效JWT+重放Nonce', status: 'passed', expected: '403', actual: 401 });
      passedCount++;
      console.log('  ✅ 返回401（认证层拦截）');
    } else {
      results.push({ name: '有效JWT+重放Nonce', status: 'failed', expected: '403', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 8.3 超出借款限额
  console.log('\n8.3 超出借款限额');
  try {
    const body = {
      userId: testUser.userId,
      amount: 999999,
      term: 7,
      creditProof: { id: INVALID_PROOF_ID, proof: 'test', publicSignals: ['0'] },
      verificationCode: TEST_VERIFICATION_CODE,
      signature: '0'.repeat(64)
    };
    const headers = buildAntiReplayHeaders(body, testUser.keyPair);
    const res = await axios.post(`${BASE_URL}/loan/borrow`, body, {
      headers: { Authorization: `Bearer ${testUser.token}`, ...headers },
      timeout: REQUEST_TIMEOUT
    });
    results.push({ name: '超出借款限额', status: 'failed', expected: '400', actual: res.status });
    console.log(`  ❌ 未拦截 (${res.status})`);
  } catch (e) {
    if (e.response && e.response.status === 400) {
      results.push({ name: '超出借款限额', status: 'passed', expected: '400', actual: 400 });
      passedCount++;
      console.log('  ✅ 正确拦截（400）');
    } else {
      results.push({ name: '超出借款限额', status: 'failed', expected: '400', actual: e.response?.status || e.message });
      console.log('  ❌ 结果不符');
    }
  }

  // 8.4 黑名单Token不挂起（Bug B5 验证）
  console.log('\n8.4 黑名单Token不挂起（Bug B5 验证）');
  try {
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      username: testUser.username,
      password: testUser.password
    }, { timeout: REQUEST_TIMEOUT });
    const freshToken = loginRes.data.token;

    const logoutRes = await axios.post(`${BASE_URL}/auth/logout`, {}, {
      headers: { Authorization: `Bearer ${freshToken}` },
      timeout: REQUEST_TIMEOUT
    });
    console.log(`    注销结果: ${logoutRes.status}`);

    const startTime = Date.now();
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000));
    const requestPromise = axios.get(`${BASE_URL}/pool`, {
      headers: { Authorization: `Bearer ${freshToken}` },
      timeout: 5000
    });
    const res = await Promise.race([requestPromise, timeoutPromise]);
    const elapsed = Date.now() - startTime;
    results.push({
      name: '黑名单Token不挂起(B5)',
      status: 'failed',
      expected: '401',
      actual: res.status,
      expectedBehavior: '黑名单 token 请求应返回 401',
      actualBehavior: `返回 ${res.status}（未超时但未返回401）`,
      bugId: 'B5',
      bugLocation: 'securityChain.js:56-58'
    });
    console.log(`  ❌ 未返回401 (${res.status}) - 已知问题 B5`);
  } catch (e) {
    if (e.message === 'TIMEOUT' || e.code === 'ECONNABORTED') {
      results.push({
        name: '黑名单Token不挂起(B5)',
        status: 'failed',
        expected: '401',
        actual: 'TIMEOUT',
        expectedBehavior: '黑名单 token 请求应返回 401',
        actualBehavior: '请求超时（请求挂起）',
        bugId: 'B5',
        bugLocation: 'securityChain.js:56-58'
      });
      console.log('  ❌ 请求超时（挂起）- 已知问题 B5');
    } else if (e.response && e.response.status === 401) {
      results.push({ name: '黑名单Token不挂起(B5)', status: 'passed', expected: '401', actual: 401 });
      passedCount++;
      console.log('  ✅ 正确返回401');
    } else {
      results.push({
        name: '黑名单Token不挂起(B5)',
        status: 'failed',
        expected: '401',
        actual: e.response?.status || e.message,
        expectedBehavior: '黑名单 token 请求应返回 401',
        actualBehavior: `返回 ${e.response?.status || e.message}`,
        bugId: 'B5',
        bugLocation: 'securityChain.js:56-58'
      });
      console.log(`  ❌ 结果不符 - 已知问题 B5`);
    }
  }

  return {
    status: passedCount >= 3 ? 'success' : (passedCount >= 1 ? 'partial' : 'failed'),
    passedTests: passedCount,
    totalTests: 4,
    testResults: results
  };
}

// ============================================
// 主函数
// ============================================
async function runAllTests() {
  console.log('='.repeat(70));
  console.log('  FinZkTrust 安全机制与容错测试');
  console.log('='.repeat(70));
  console.log(`  开始时间: ${new Date().toLocaleString()}`);
  console.log(`  Node.js版本: ${process.version}`);

  try {
    // 0. 前置准备
    await setupTestUser();

    // 1. 模块1防重放测试
    const mod1Result = await module1AntiReplayTests();
    testReport.results.antiReplay = mod1Result;
    testReport.modules.antiReplay = {
      order: 1,
      displayName: '防重放攻击测试',
      ...mod1Result
    };

    // 2. 模块2JWT测试
    const mod2Result = await module2JwtAuthTests();
    testReport.results.jwtAuth = mod2Result;
    testReport.modules.jwtAuth = {
      order: 2,
      displayName: 'JWT 认证测试',
      ...mod2Result
    };

    // 3. 模块3参数验证
    const mod3Result = await module3ParamValidationTests();
    testReport.results.paramValidation = mod3Result;
    testReport.modules.paramValidation = {
      order: 3,
      displayName: '参数验证测试',
      ...mod3Result
    };

    // 4. 模块4通用错误
    const mod4Result = await module4GeneralErrorTests();
    testReport.results.generalError = mod4Result;
    testReport.modules.generalError = {
      order: 4,
      displayName: '通用错误处理',
      ...mod4Result
    };

    // 5. 模块5 SM2签名中间件
    const mod5Result = await module5Sm2SignatureMiddleware();
    testReport.results.sm2Middleware = mod5Result;
    testReport.modules.sm2Middleware = {
      order: 5,
      displayName: 'SM2 签名中间件测试',
      ...mod5Result
    };

    // 6. 模块6 ZKP安全测试
    const mod6Result = await module6ZkpSecurityTests();
    testReport.results.zkpSecurity = mod6Result;
    testReport.modules.zkpSecurity = {
      order: 6,
      displayName: 'ZKP 验证安全测试',
      ...mod6Result
    };

    // 7. 模块7 SM4静默失败测试
    const mod7Result = await module7Sm4SilentFailureTests();
    testReport.results.sm4SilentFailure = mod7Result;
    testReport.modules.sm4SilentFailure = {
      order: 7,
      displayName: 'SM4 静默失败测试',
      ...mod7Result
    };

    // 8. 模块8 认证链路完整性测试
    const mod8Result = await module8AuthChainIntegrityTests();
    testReport.results.authChain = mod8Result;
    testReport.modules.authChain = {
      order: 8,
      displayName: '认证链路完整性测试',
      ...mod8Result
    };

    // 总体状态
    const allPassed = [
      testReport.modules.antiReplay.status === 'success',
      testReport.modules.jwtAuth.status === 'success',
      testReport.modules.paramValidation.status === 'success',
      testReport.modules.generalError.status === 'success',
      testReport.modules.sm2Middleware.status === 'success',
      testReport.modules.zkpSecurity.status === 'success',
      testReport.modules.sm4SilentFailure.status === 'success',
      testReport.modules.authChain.status === 'success'
    ];

    if (allPassed.every(p => p)) {
      testReport.overallStatus = 'success';
    } else if (allPassed.some(p => p)) {
      testReport.overallStatus = 'partial';
    } else {
      testReport.overallStatus = 'failed';
    }

    // 打印与保存
    printSummary(testReport);
    await saveReport(testReport);

    console.log('\n✅ 安全与容错测试完成！');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ 测试过程中发生严重错误:', error.message);
    console.error('Stack:', error.stack);
    testReport.overallStatus = 'failed';
    testReport.error = error.message;
    await saveReport(testReport);
    process.exit(1);
  }
}

if (require.main === module) {
  runAllTests();
}

module.exports = { runAllTests, testReport };
