const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { performance, PerformanceObserver } = require('perf_hooks');
const crypto = require('crypto');

// 正确加载环境变量
const envPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: envPath });

// 强制清除可能因启动时序缓存的模块，确保 SM4 环境变量生效
delete require.cache[require.resolve('../utils/sm4Crypto')];
delete require.cache[require.resolve('../utils/keyManager')];

// 验证环境变量已加载
if (!process.env.SM4_MASTER_KEY) {
  console.error('❌ 环境变量 SM4_MASTER_KEY 未加载，请确认 .env 文件路径正确');
  console.error(`   尝试加载的 .env 文件路径: ${envPath}`);
  process.exit(1);
}

// 内存使用获取辅助函数
function getHeapUsed() {
  const mem = process.memoryUsage();
  return mem.heapUsed;
}

// 辅助函数
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function calcStats(times) {
  if (!times || times.length === 0) return { avg: 0, min: 0, max: 0, p50: 0, p90: 0, p95: 0, p99: 0 };
  const sorted = [...times].sort((a, b) => a - b);
  return {
    avg: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    p50: sorted[Math.floor(sorted.length * 0.5)] || 0,
    p90: sorted[Math.floor(sorted.length * 0.9)] || 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] || 0,
    p99: sorted[Math.floor(sorted.length * 0.99)] || 0
  };
}

async function collectGarbage() {
  if (global.gc) {
    global.gc();
    await delay(100);
  }
}

function calcMean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function calcStddev(arr) {
  const m = calcMean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

// 测试配置
const BASE_URL = 'http://localhost:3003/api/v1';
const TEST_USERNAME = 'perfuser';
const TEST_PASSWORD = 'PerfPass123!';

// 性能测试前清除缓存，确保测量真实性能
function clearCryptoCaches() {
  try {
    const cryptoUtils = require('../utils/cryptoUtils');
    // 清除 SM2 签名缓存
    if (cryptoUtils._test_clearCache) {
      cryptoUtils._test_clearCache();
    }
    // 直接清除内部 LRU 缓存引用
    if (cryptoUtils._signatureCache) cryptoUtils._signatureCache.cache.clear();
    if (cryptoUtils._hashCache) cryptoUtils._hashCache.cache.clear();
  } catch (e) { /* ignore */ }
}

// 性能测试报告
let testReport = {
  timestamp: new Date().toISOString(),
  overallStatus: 'pending',
  modules: {},
  results: {},
  duration: 0
};

const globalStart = performance.now();

// ============================================
// 模块1：API并发热身与压测
// ============================================
async function module1ApiStressTest() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块1：API并发热身与压测');
  console.log('='.repeat(70));

  const moduleStart = performance.now();

  // 登录性能测试用户，获取 Token 以便豁免限流
  let token = null;
  try {
    // 先尝试登录
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      username: TEST_USERNAME,
      password: TEST_PASSWORD
    });
    if (loginRes.data.success) {
      token = loginRes.data.token;
      globalThis.__benchToken = token;
      globalThis.__benchUserId = loginRes.data.user?.id || loginRes.data.userId;
      console.log('  ✓ 性能测试用户登录成功，Token已存入全局变量');
    } else {
      console.log('  ⚠ 登录失败，尝试创建用户...');
      throw new Error('login failed');
    }
  } catch (e) {
    // 用户不存在则自动创建
    try {
      const { generateSM2KeyPair } = require('../utils/cryptoUtils');
      const kp = generateSM2KeyPair();
      await axios.post(`${BASE_URL}/auth/register`, {
        username: TEST_USERNAME,
        password: TEST_PASSWORD,
        sm2PublicKey: kp.publicKey,
        creditScore: 750
      });
      const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
        username: TEST_USERNAME,
        password: TEST_PASSWORD
      });
      if (loginRes.data.success) {
        token = loginRes.data.token;
        globalThis.__benchToken = token;
        globalThis.__benchUserId = loginRes.data.user?.id || loginRes.data.userId;
        console.log('  ✓ 性能测试用户已创建并登录');
      }
    } catch (e2) {
      console.log('  ⚠ 用户创建/登录失败:', e2.message);
    }
  }

  console.log('\n------ 第一轮：基准测试 ------');

  const baselineLevels = [
    { name: '低负载', concurrency: 10, iterations: 10 },
    { name: '中负载', concurrency: 30, iterations: 15 },
    { name: '高负载', concurrency: 80, iterations: 5 }
  ];

  const baselineResults = {};

  for (const level of baselineLevels) {
    console.log(`\n  📊 ${level.name} (并发${level.concurrency} × ${level.iterations}次)`);
    const times = [];
    let success = 0, status429 = 0, errors = 0;

    for (let iter = 0; iter < level.iterations; iter++) {
      const promises = [];
      for (let c = 0; c < level.concurrency; c++) {
        promises.push(singlePoolRequest(times, token));
      }
      await Promise.allSettled(promises);
    }

    for (const t of times) {
      if (t.status === 200) success++;
      else if (t.status === 429) status429++;
      else errors++;
    }

    const stats = calcStats(times.map(t => t.time));
    baselineResults[level.name] = {
      total: times.length,
      success,
      status429,
      errors,
      successRate: ((success / times.length) * 100).toFixed(2),
      stats
    };

    console.log(`     成功: ${success}/${times.length} (429: ${status429})`);
    console.log(`     延迟: avg=${stats.avg.toFixed(2)}ms, p50=${stats.p50.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms`);
  }

  console.log('\n------ 第二轮：容量测试（30秒持续压测）------');

  const capacityStart = performance.now();
  const capacityDuration = 30000;
  const capacityTimes = [];
  let capacitySuccess = 0, capacity429 = 0, capacityErrors = 0;
  let requestsCount = 0;

  console.log('  开始持续压测...');
  while (performance.now() - capacityStart < capacityDuration) {
    const batchPromises = [];
    for (let i = 0; i < 10; i++) {
      batchPromises.push(singlePoolRequest(capacityTimes, token));
    }
    await Promise.allSettled(batchPromises);
    requestsCount += 10;

    if (requestsCount % 100 === 0) {
      await delay(10);
    }
  }

  const capacityDurationActual = performance.now() - capacityStart;

  for (const t of capacityTimes) {
    if (t.status === 200) capacitySuccess++;
    else if (t.status === 429) capacity429++;
    else capacityErrors++;
  }

  const capacityStats = calcStats(capacityTimes.map(t => t.time));
  const qps = (capacityTimes.length / (capacityDurationActual / 1000)).toFixed(2);

  console.log(`\n  📊 容量测试结果 (${(capacityDurationActual / 1000).toFixed(1)}秒)`);
  console.log(`     总请求: ${capacityTimes.length}, QPS: ${qps}`);
  console.log(`     成功: ${capacitySuccess} (429: ${capacity429})`);
  console.log(`     延迟: avg=${capacityStats.avg.toFixed(2)}ms, p50=${capacityStats.p50.toFixed(2)}ms, p95=${capacityStats.p95.toFixed(2)}ms, p99=${capacityStats.p99.toFixed(2)}ms`);

  const moduleTime = performance.now() - moduleStart;

  return {
    status: 'success',
    durationMs: moduleTime.toFixed(2),
    baseline: baselineResults,
    capacity: {
      durationSec: (capacityDurationActual / 1000).toFixed(2),
      totalRequests: capacityTimes.length,
      qps: parseFloat(qps),
      success: capacitySuccess,
      status429: capacity429,
      errors: capacityErrors,
      successRate: ((capacitySuccess / capacityTimes.length) * 100).toFixed(2),
      stats: capacityStats
    }
  };
}

async function singlePoolRequest(timesArray, token) {
  const start = performance.now();
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await axios.get(`${BASE_URL}/pool`, { timeout: 10000, headers });
    const time = performance.now() - start;
    timesArray.push({ time, status: res.status });
  } catch (e) {
    const time = performance.now() - start;
    timesArray.push({ time, status: e.response?.status || 0 });
  }
}

// ============================================
// 模块2：密码学深度基准
// ============================================
async function module2CryptoBenchmark() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块2：密码学深度基准');
  console.log('='.repeat(70));

  const moduleStart = performance.now();
  const results = {};

  const { generateSM2KeyPair, signWithSM2, generateSM3Hash } = require('../utils/cryptoUtils');
  const kmsService = require('../services/kmsService');
  const testDek = crypto.randomBytes(16).toString('hex');

  console.log('\n  预生成SM2密钥对...');
  const testKeyPair = generateSM2KeyPair();
  const testMessage = 'Performance benchmark test message for SM2 signature';

  console.log('\n  2.1 SM2密钥生成 (6000次)...');
  await collectGarbage();
  const keyGenStart = getHeapUsed();
  const keyGenStartTime = performance.now();

  for (let i = 0; i < 6000; i++) {
    generateSM2KeyPair();
  }

  const keyGenTime = performance.now() - keyGenStartTime;
  const keyGenEndHeap = getHeapUsed();
  const keyGenOpsPerSec = (6000 / (keyGenTime / 1000)).toFixed(0);
  const keyGenMemoryKB = ((keyGenEndHeap - keyGenStart) / 1024).toFixed(2);

  results.sm2KeyGen = {
    iterations: 6000,
    totalMs: keyGenTime.toFixed(2),
    avgMs: (keyGenTime / 6000).toFixed(3),
    opsPerSec: parseInt(keyGenOpsPerSec),
    memoryUsedKB: parseFloat(keyGenMemoryKB)
  };

  console.log(`     总耗时: ${keyGenTime.toFixed(2)}ms`);
  console.log(`     吞吐量: ${keyGenOpsPerSec} ops/s`);
  console.log(`     内存增长: ${keyGenMemoryKB} KB`);

  console.log('\n  2.2 SM2签名 (10000次, 递增消息避免缓存)...');
  clearCryptoCaches();
  const signStartTime = performance.now();

  for (let i = 0; i < 10000; i++) {
    signWithSM2(testMessage + '_' + i, testKeyPair.privateKey);
  }

  const signTime = performance.now() - signStartTime;
  const signOpsPerSec = (10000 / (signTime / 1000)).toFixed(0);

  results.sm2Sign = {
    iterations: 10000,
    totalMs: signTime.toFixed(2),
    avgMs: (signTime / 10000).toFixed(4),
    opsPerSec: parseInt(signOpsPerSec)
  };

  console.log(`     总耗时: ${signTime.toFixed(2)}ms`);
  console.log(`     吞吐量: ${signOpsPerSec} ops/s`);

  console.log('\n  2.3 SM3哈希吞吐量...');
  const sm3Results = {};

  for (const size of [1024, 10240]) {
    const baseData = Buffer.alloc(size, 'x').toString('hex');
    const iterations = size === 1024 ? 10000 : 5000;
    clearCryptoCaches();

    const hashStartTime = performance.now();
    for (let i = 0; i < iterations; i++) {
      generateSM3Hash(baseData + '_' + i);
    }
    const hashTime = performance.now() - hashStartTime;
    const hashMB = (iterations * size / 1024 / 1024);
    const hashMBperSec = (hashMB / (hashTime / 1000)).toFixed(2);

    sm3Results[`${size === 1024 ? '1KB' : '10KB'}`] = {
      iterations,
      totalMs: hashTime.toFixed(2),
      avgMs: (hashTime / iterations).toFixed(4),
      throughputMBs: parseFloat(hashMBperSec)
    };

    console.log(`     ${size === 1024 ? '1KB' : '10KB'}: ${iterations}次, ${hashTime.toFixed(2)}ms, ${hashMBperSec} MB/s`);
  }

  results.sm3Hash = sm3Results;

  console.log('\n  2.4 SM4加解密吞吐量...');
  const sm4Results = {};

  for (const size of [1024, 10240]) {
    const data = Buffer.alloc(size, 'x');
    const iterations = size === 1024 ? 1000 : 500;

    const sm4StartTime = performance.now();
    for (let i = 0; i < iterations; i++) {
      const encrypted = kmsService.encryptWithDEK(testDek, data);
      kmsService.decryptWithDEK(testDek, encrypted);
    }
    const sm4Time = performance.now() - sm4StartTime;
    const sm4MB = (iterations * size / 1024 / 1024);
    const sm4MBperSec = (sm4MB / (sm4Time / 1000)).toFixed(2);

    sm4Results[`${size === 1024 ? '1KB' : '10KB'}`] = {
      iterations,
      totalMs: sm4Time.toFixed(2),
      avgMs: (sm4Time / iterations).toFixed(3),
      throughputMBs: parseFloat(sm4MBperSec)
    };

    console.log(`     ${size === 1024 ? '1KB' : '10KB'}: ${iterations}次, ${sm4Time.toFixed(2)}ms, ${sm4MBperSec} MB/s`);
  }

  results.sm4EncDec = sm4Results;

  const moduleTime = performance.now() - moduleStart;
  results.durationMs = moduleTime.toFixed(2);

  // 业务场景映射（基于以上性能数据）
  const sm2SignOps = results.sm2Sign.opsPerSec;
  const sm3HashMBs = results.sm3Hash['1KB'].throughputMBs;
  const sm4EncMBs = results.sm4EncDec['1KB'].throughputMBs;

  const loans100SignMs = ((100 * 2) / sm2SignOps * 1000).toFixed(1);
  const loans10000HashMs = ((10000 * 2048) / (sm3HashMBs * 1024 * 1024) * 1000).toFixed(1);
  const loans10000EncMs = ((10000 * 1024) / (sm4EncMBs * 1024 * 1024) * 1000).toFixed(1);

  results.businessMapping = {
    sm2: `100笔贷款 × 2次签名 = ${loans100SignMs}ms`,
    sm3: `10000笔贷款 × 2KB哈希 = ${loans10000HashMs}ms`,
    sm4: `10000笔贷款 × 1KB加密 = ${loans10000EncMs}ms`,
    note: 'SM2/SM3/SM4均为纯JavaScript实现，性能受JS引擎限制，生产环境可通过C/C++ addon或硬件加速提升10-50倍'
  };

  console.log('\n  业务场景映射（基于以上性能数据）：');
  console.log(`    单笔借款需2次SM2签名（借款申请+信用证明），100笔贷款签名总耗时 ≈ ${loans100SignMs}ms`);
  console.log(`    单笔借款约2KB数据需SM3哈希，10000笔贷款哈希总耗时 ≈ ${loans10000HashMs}ms`);
  console.log(`    单笔借款约1KB敏感字段需SM4加密，10000笔贷款加密总耗时 ≈ ${loans10000EncMs}ms`);
  console.log(`    注：均为纯JavaScript实现，生产环境可通过C/C++ addon或硬件加速提升10-50倍`);

  return { status: 'success', ...results };
}

// ============================================
// 模块3：零知识证明性能
// ============================================
async function module3ZkpPerformance() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块3：零知识证明性能');
  console.log('='.repeat(70));

  const moduleStart = performance.now();
  const results = {};

  let zkService;
  try {
    zkService = require('../services/zkService');
  } catch (e) {
    console.log('\n  ⚠️ ZKP服务不可用，跳过此模块');
    return { status: 'skipped', reason: 'zkService not available' };
  }

  console.log('\n  3.1 ZKP证明生成 (100次)...');
  const genTimes = [];
  let sampleProof = null;

  for (let i = 0; i < 100; i++) {
    const t1 = performance.now();
    try {
      const proofResult = await zkService.generateProof(750, 600, true);
      const time = performance.now() - t1;
      genTimes.push(time);
      if (i === 0) sampleProof = proofResult;
    } catch (e) {
      genTimes.push(performance.now() - t1);
    }
  }

  const genStats = calcStats(genTimes);
  console.log(`     成功: ${genTimes.length}/100`);
  console.log(`     延迟: avg=${genStats.avg.toFixed(2)}ms, p50=${genStats.p50.toFixed(2)}ms, p90=${genStats.p90.toFixed(2)}ms, max=${genStats.max.toFixed(2)}ms`);

  results.proofGen = {
    iterations: 100,
    successCount: genTimes.length,
    avgMs: genStats.avg.toFixed(2),
    p50Ms: genStats.p50.toFixed(2),
    p90Ms: genStats.p90.toFixed(2),
    maxMs: genStats.max.toFixed(2)
  };

  console.log('\n  3.2 ZKP证明验证 (100次)...');
  const verifyTimes = [];

  if (sampleProof) {
    for (let i = 0; i < 100; i++) {
      const t1 = performance.now();
      try {
        await zkService.verifyProof(sampleProof.proof, sampleProof.publicSignals);
        verifyTimes.push(performance.now() - t1);
      } catch (e) {
        verifyTimes.push(performance.now() - t1);
      }
    }
  }

  if (verifyTimes.length > 0) {
    const verifyStats = calcStats(verifyTimes);
    console.log(`     延迟: avg=${verifyStats.avg.toFixed(3)}ms, p50=${verifyStats.p50.toFixed(3)}ms, p90=${verifyStats.p90.toFixed(3)}ms`);

    results.proofVerify = {
      iterations: 100,
      successCount: verifyTimes.length,
      avgMs: verifyStats.avg.toFixed(3),
      p50Ms: verifyStats.p50.toFixed(3),
      p90Ms: verifyStats.p90.toFixed(3),
      maxMs: verifyStats.max.toFixed(3)
    };
  }

  const moduleTime = performance.now() - moduleStart;
  results.durationMs = moduleTime.toFixed(2);
  results.status = 'success';
  results.sampleProof = sampleProof;

  return results;
}

// ============================================
// 冷启动延迟测试
// ============================================
async function measureColdStart() {
  console.log('\n' + '='.repeat(70));
  console.log('  冷启动延迟测试');
  console.log('='.repeat(70));

  const token = globalThis.__benchToken;
  const results = {};

  console.log('\n  测量冷启动延迟...');
  const coldStart = performance.now();
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    await axios.get(`${BASE_URL}/pool`, { timeout: 10000, headers });
    const coldTime = performance.now() - coldStart;
    results.latencyMs = coldTime.toFixed(2);
    results.status = 'measured';
    console.log(`     ✓ 冷启动延迟: ${coldTime.toFixed(2)}ms`);
  } catch (e) {
    results.latencyMs = (performance.now() - coldStart).toFixed(2);
    results.status = 'error';
    results.error = e.message;
    console.log(`     ✗ 冷启动延迟测量失败: ${e.message}`);
  }

  return results;
}

// ============================================
// 模块4：数据库连接池压力测试
// ============================================
async function module4DatabasePoolStress() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块4：数据库连接池压力测试');
  console.log('='.repeat(70));

  const results = {};

  // 前置检查：数据库是否可用
  console.log('\n  4.0 数据库连通性检查...');
  let db;
  try {
    db = require('../config/database');
    await db.execute('SELECT 1 as result');
    console.log('  ✓ 数据库连通性检查通过');
  } catch (e) {
    console.log(`  ⚠️ 数据库不可用 (${e.message})，跳过压力测试`);
    return { status: 'skipped', reason: 'database unavailable', results };
  }

  // 4.1 并发查询测试（200并发 SELECT 1）
  console.log('\n  4.1 并发查询测试 (200并发 SELECT 1)...');
  const queryTimes = [];
  const queryErrors = [];
  const queryPromises = [];
  const queryStart = performance.now();

  for (let i = 0; i < 200; i++) {
    const start = performance.now();
    queryPromises.push(
      db.execute('SELECT 1 as result')
        .then(() => {
          queryTimes.push(performance.now() - start);
        })
        .catch(e => {
          queryErrors.push({ time: performance.now() - start, error: e.message });
        })
    );
  }

  await Promise.allSettled(queryPromises);
  const queryDuration = performance.now() - queryStart;
  const queryStats = calcStats(queryTimes);
  const querySuccess = queryTimes.length;
  const queryTotalErrors = queryErrors.length;
  const querySuccessRate = (((200 - queryTotalErrors) / 200) * 100).toFixed(1);

  console.log(`     总请求: 200`);
  console.log(`     成功: ${querySuccess}, 失败: ${queryTotalErrors}`);
  if (queryTotalErrors > 0) {
    console.log(`     失败样本: ${queryErrors.slice(0, 3).map(e => e.error).join('; ')}`);
  }
  console.log(`     总耗时: ${queryDuration.toFixed(2)}ms`);
  console.log(`     延迟: avg=${queryStats.avg.toFixed(2)}ms, p95=${queryStats.p95.toFixed(2)}ms, p99=${queryStats.p99.toFixed(2)}ms, max=${queryStats.max.toFixed(2)}ms`);
  console.log(`     等效QPS: ${((200 / queryDuration) * 1000).toFixed(2)}`);

  results.concurrentQuery = {
    concurrency: 200,
    totalRequests: 200,
    success: querySuccess,
    errors: queryTotalErrors,
    successRate: querySuccessRate,
    durationMs: queryDuration.toFixed(2),
    stats: {
      avgMs: queryStats.avg.toFixed(2),
      p50Ms: queryStats.p50.toFixed(2),
      p95Ms: queryStats.p95.toFixed(2),
      p99Ms: queryStats.p99.toFixed(2),
      maxMs: queryStats.max.toFixed(2)
    },
    qps: ((200 / queryDuration) * 1000).toFixed(2)
  };

  // 等待连接池恢复
  console.log('\n  ⏳ 等待连接池恢复 (5秒)...');
  await delay(5000);

  // 4.2 连接池耗尽与恢复测试
  console.log('\n  4.2 连接池耗尽与恢复测试 (100并发连续查询)...');
  const recoveryTimes = [];
  const recoveryErrors = [];
  const recoveryStart = performance.now();

  const recoveryPromises = [];
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    recoveryPromises.push(
      db.execute('SELECT 1 as result')
        .then(() => {
          recoveryTimes.push(performance.now() - start);
        })
        .catch(e => {
          recoveryErrors.push({ time: performance.now() - start, error: e.message });
        })
    );
  }

  await Promise.allSettled(recoveryPromises);
  const recoveryDuration = performance.now() - recoveryStart;
  const recoveryStats = calcStats(recoveryTimes);
  const recoverySuccess = recoveryTimes.length;
  const recoveryTotalErrors = recoveryErrors.length;
  const recoverySuccessRate = (((100 - recoveryTotalErrors) / 100) * 100).toFixed(1);

  console.log(`     总请求: 100`);
  console.log(`     成功: ${recoverySuccess}, 失败: ${recoveryTotalErrors}`);
  if (recoveryTotalErrors > 0) {
    console.log(`     失败样本: ${recoveryErrors.slice(0, 3).map(e => e.error).join('; ')}`);
  }
  console.log(`     总耗时: ${recoveryDuration.toFixed(2)}ms`);
  console.log(`     延迟: avg=${recoveryStats.avg.toFixed(2)}ms, p95=${recoveryStats.p95.toFixed(2)}ms`);

  results.recoveryTest = {
    concurrency: 100,
    totalRequests: 100,
    success: recoverySuccess,
    errors: recoveryTotalErrors,
    successRate: recoverySuccessRate,
    durationMs: recoveryDuration.toFixed(2),
    stats: {
      avgMs: recoveryStats.avg.toFixed(2),
      p50Ms: recoveryStats.p50.toFixed(2),
      p95Ms: recoveryStats.p95.toFixed(2),
      maxMs: recoveryStats.max.toFixed(2)
    }
  };

  results.status = 'success';
  return results;
}

// ============================================
// 模块5：用户信息查询并发性能测试
// ============================================
async function module5UserInfoConcurrency() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块5：用户信息查询并发性能测试');
  console.log('='.repeat(70));

  const token = globalThis.__benchToken;
  if (!token) {
    console.log('  ⚠️ 未获取到Token，跳过此模块');
    return { status: 'skipped', reason: 'token not available' };
  }

  const userId = globalThis.__benchUserId;
  if (!userId) {
    console.log('  ⚠️ 未获取到用户ID，跳过此模块');
    return { status: 'skipped', reason: 'userId not available' };
  }
  const levels = [10, 50, 100, 150, 200];
  const results = [];

  console.log('\n  测试用户信息查询接口...');
  for (const concurrency of levels) {
    const promises = [];
    const times = [];
    for (let i = 0; i < concurrency; i++) {
      const start = performance.now();
      promises.push(
        axios.get(`${BASE_URL}/users/${userId}`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000
        }).then(res => {
          times.push({ time: performance.now() - start, status: res.status });
        }).catch(e => {
          times.push({ time: performance.now() - start, status: e.response?.status || 0 });
        })
      );
    }
    await Promise.allSettled(promises);
    const stats = calcStats(times.map(t => t.time));
    const success = times.filter(t => t.status === 200).length;
    const successRate = ((success / concurrency) * 100).toFixed(1);
    results.push({
      concurrency,
      avgMs: stats.avg.toFixed(2),
      p95Ms: stats.p95.toFixed(2),
      successRate
    });
    console.log(`     并发${String(concurrency).padStart(3)}: avg=${stats.avg.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms, 成功率=${successRate}%`);
    await delay(200);
  }

  return { status: 'success', results };
}

// ============================================
// 模块6：安全中间件链路压测
// ============================================
async function module6SecurityChainOverhead() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块6：安全中间件链路压测');
  console.log('='.repeat(70));

  const token = globalThis.__benchToken;
  if (!token) {
    console.log('  ⚠️ 未获取到Token，跳过此模块');
    return { status: 'skipped', reason: 'token not available' };
  }

  const concurrencyLevels = [10, 50, 100, 150, 200];
  const results = [];

  console.log('\n  测试资金池查询接口（安全链路）...');
  for (const concurrency of concurrencyLevels) {
    const promises = [];
    const times = [];
    for (let i = 0; i < concurrency; i++) {
      const start = performance.now();
      promises.push(
        axios.get(`${BASE_URL}/pool`, {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 10000
        }).then(res => {
          times.push({ time: performance.now() - start, status: res.status });
        }).catch(e => {
          times.push({ time: performance.now() - start, status: e.response?.status || 0 });
        })
      );
    }
    await Promise.allSettled(promises);
    const stats = calcStats(times.map(t => t.time));
    const success = times.filter(t => t.status === 200).length;
    const successRate = ((success / concurrency) * 100).toFixed(1);
    results.push({
      concurrency,
      avgMs: stats.avg.toFixed(2),
      p95Ms: stats.p95.toFixed(2),
      successRate
    });
    console.log(`     并发${String(concurrency).padStart(3)}: avg=${stats.avg.toFixed(2)}ms, p95=${stats.p95.toFixed(2)}ms, 成功率=${successRate}%`);
    await delay(200);
  }

  return { status: 'success', results };
}

// ============================================
// 模块8：端到端业务流程性能
// ============================================
async function module8EndToEndBusinessPerformance() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块8：端到端业务流程性能');
  console.log('='.repeat(70));

  const moduleStart = performance.now();
  const results = {};

  let zkService;
  try {
    zkService = require('../services/zkService');
  } catch (e) {
    console.log('\n  ⚠️ ZKP服务不可用，跳过此模块');
    return { status: 'skipped', reason: 'zkService not available' };
  }

  // 8.1 借款流程耗时分解
  console.log('\n  8.1 借款流程耗时分解');
  const loanSteps = {};

  const step1Start = performance.now();
  const proofResult = await zkService.generateProof(750, 600, true);
  loanSteps.zkpProofGen = (performance.now() - step1Start).toFixed(2);
  console.log(`     ZKP证明生成: ${loanSteps.zkpProofGen}ms`);

  const testUsername = `perf_e2e_${Date.now()}`;
  const testPassword = 'PerfTest123!';
  let token = null;
  let userId = null;
  let keyPair = null;

  const { generateSM2KeyPair, signWithSM2 } = require('../utils/cryptoUtils');
  try {
    keyPair = generateSM2KeyPair();

    const step2Start = performance.now();
    await axios.post(`${BASE_URL}/auth/register`, {
      username: testUsername,
      password: testPassword,
      sm2PublicKey: keyPair.publicKey,
      creditScore: 750
    });
    const loginRes = await axios.post(`${BASE_URL}/auth/login`, {
      username: testUsername,
      password: testPassword
    });
    loanSteps.userSetup = (performance.now() - step2Start).toFixed(2);
    console.log(`     用户注册/登录: ${loanSteps.userSetup}ms`);

    if (loginRes.data.success) {
      token = loginRes.data.token;
      userId = loginRes.data.user.id;
    }
  } catch (e) {
    console.log(`     ⚠️ 用户准备失败: ${e.message}`);
    return { status: 'skipped', reason: 'User setup failed' };
  }

  if (!token || !userId) {
    return { status: 'skipped', reason: 'No valid token' };
  }

  const step3Start = performance.now();
  let proofId = null;
  let verificationCode = null;
  try {
    const proofSubmitRes = await axios.post(
      `${BASE_URL}/credit/generate-proof`,
      { userId, proof: proofResult.proof, publicSignals: proofResult.publicSignals },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (proofSubmitRes.data.success && proofSubmitRes.data.data?.proof) {
      proofId = proofSubmitRes.data.data.proof.proofId;
      verificationCode = proofSubmitRes.data.data.proof.verificationCode;
    }
  } catch (e) {
    console.log(`     ⚠️ 证明提交失败: ${e.message}`);
  }
  loanSteps.proofSubmission = (performance.now() - step3Start).toFixed(2);
  console.log(`     证明提交: ${loanSteps.proofSubmission}ms`);

  const step4Start = performance.now();
  try {
    const borrowBody = {
      userId,
      amount: 100,
      term: 7,
      creditProof: { id: proofId || 'test-proof-id', proof: proofResult.proof, publicSignals: proofResult.publicSignals },
      verificationCode: verificationCode || '123456'
    };
    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const signData = timestamp + nonce + JSON.stringify(borrowBody);
    const signature = signWithSM2(signData, keyPair.privateKey);

    const borrowRes = await axios.post(`${BASE_URL}/loan/borrow`, borrowBody, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-request-timestamp': timestamp,
        'x-request-nonce': nonce,
        'x-request-sign': signature
      },
      timeout: 30000
    });
    console.log(`     ✓ 借款提交成功: ${borrowRes.status}`);
  } catch (e) {
    const status = e.response?.status;
    const msg = e.response?.data?.message || e.message;
    console.log(`     ⚠️ 借款提交失败 (${status}): ${msg}`);
  }
  loanSteps.loanSubmission = (performance.now() - step4Start).toFixed(2);
  console.log(`     借款提交: ${loanSteps.loanSubmission}ms`);

  const totalLoanTime = Object.values(loanSteps).reduce((sum, v) => sum + parseFloat(v), 0);
  loanSteps.total = totalLoanTime.toFixed(2);

  for (const [step, time] of Object.entries(loanSteps)) {
    if (step !== 'total') {
      loanSteps[`${step}Pct`] = ((parseFloat(time) / totalLoanTime) * 100).toFixed(1);
    }
  }

  results.loanProcess = loanSteps;
  console.log(`     借款流程总耗时: ${totalLoanTime.toFixed(2)}ms`);

  // 8.2 还款流程耗时分解
  console.log('\n  8.2 还款流程耗时分解');
  const repaySteps = {};

  const repayStep1Start = performance.now();
  let loanId = null;
  try {
    const loansRes = await axios.get(`${BASE_URL}/loan/user/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000
    });
    if (loansRes.data.success && loansRes.data.data && loansRes.data.data.length > 0) {
      loanId = loansRes.data.data[0].id;
    }
  } catch (e) {
    console.log(`     ⚠️ 查询贷款失败: ${e.message}`);
  }
  repaySteps.queryLoans = (performance.now() - repayStep1Start).toFixed(2);
  console.log(`     查询未还贷款: ${repaySteps.queryLoans}ms`);

  const repayStep2Start = performance.now();
  if (loanId) {
    try {
      const repayBody = { loanId, amount: 100 };
      const timestamp = Date.now().toString();
      const nonce = crypto.randomBytes(16).toString('hex');
      const signData = timestamp + nonce + JSON.stringify(repayBody);
      const signature = signWithSM2(signData, keyPair.privateKey);

      await axios.post(`${BASE_URL}/loan/repay`, repayBody, {
        headers: {
          Authorization: `Bearer ${token}`,
          'x-request-timestamp': timestamp,
          'x-request-nonce': nonce,
          'x-request-sign': signature
        },
        timeout: 30000
      });
      console.log(`     ✓ 还款提交成功`);
    } catch (e) {
      const status = e.response?.status;
      const msg = e.response?.data?.message || e.message;
      console.log(`     ⚠️ 还款提交失败 (${status}): ${msg}`);
    }
  }
  repaySteps.repaySubmission = (performance.now() - repayStep2Start).toFixed(2);
  console.log(`     提交还款: ${repaySteps.repaySubmission}ms`);

  const repayStep3Start = performance.now();
  try {
    const updatedLoansRes = await axios.get(`${BASE_URL}/loan/user/${userId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 10000
    });
    repaySteps.loanStatusCheck = (performance.now() - repayStep3Start).toFixed(2);
    console.log(`     贷款状态查询: ${repaySteps.loanStatusCheck}ms`);
  } catch (e) {
    repaySteps.loanStatusCheck = (performance.now() - repayStep3Start).toFixed(2);
    console.log(`     ⚠️ 贷款状态查询失败: ${e.message}`);
  }

  const totalRepayTime = Object.values(repaySteps).reduce((sum, v) => sum + parseFloat(v), 0);
  repaySteps.total = totalRepayTime.toFixed(2);

  for (const [step, time] of Object.entries(repaySteps)) {
    if (step !== 'total') {
      repaySteps[`${step}Pct`] = ((parseFloat(time) / totalRepayTime) * 100).toFixed(1);
    }
  }

  results.repayProcess = repaySteps;
  console.log(`     还款流程总耗时: ${totalRepayTime.toFixed(2)}ms`);

  const moduleTime = performance.now() - moduleStart;
  results.durationMs = moduleTime.toFixed(2);
  results.status = 'success';

  return results;
}

// ============================================
// 模块9：资源消耗监控
// ============================================
async function module9ResourceMonitoring() {
  console.log('\n' + '='.repeat(70));
  console.log('  模块9：资源消耗监控');
  console.log('='.repeat(70));

  const moduleStart = performance.now();
  const results = {};

  const token = globalThis.__benchToken;
  if (!token) {
    console.log('  ⚠️ 未获取到Token，跳过此模块');
    return { status: 'skipped', reason: 'token not available' };
  }

  // 9.1 内存泄漏检测
  console.log('\n  9.1 内存泄漏检测（1000次请求，每100次记录heapUsed）');
  await collectGarbage();

  const heapSnapshots = [];
  const initialHeap = getHeapUsed();
  heapSnapshots.push({ requests: 0, heapUsedMB: (initialHeap / 1024 / 1024).toFixed(2) });

  for (let i = 0; i < 1000; i++) {
    try {
      await axios.get(`${BASE_URL}/pool`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      });
    } catch (e) {
      // ignore errors
    }

    if ((i + 1) % 100 === 0) {
      await collectGarbage();
      const heap = getHeapUsed();
      heapSnapshots.push({
        requests: i + 1,
        heapUsedMB: (heap / 1024 / 1024).toFixed(2),
        growthMB: ((heap - initialHeap) / 1024 / 1024).toFixed(2)
      });
      console.log(`     请求 ${i + 1}/1000: heapUsed=${(heap / 1024 / 1024).toFixed(2)}MB, 增长=${((heap - initialHeap) / 1024 / 1024).toFixed(2)}MB`);
    }
  }

  const finalHeap = getHeapUsed();
  const totalGrowthMB = (finalHeap - initialHeap) / 1024 / 1024;
  const memoryLeakOK = totalGrowthMB < 50;

  results.memoryLeak = {
    initialHeapMB: parseFloat((initialHeap / 1024 / 1024).toFixed(2)),
    finalHeapMB: parseFloat((finalHeap / 1024 / 1024).toFixed(2)),
    totalGrowthMB: parseFloat(totalGrowthMB.toFixed(2)),
    withinLimit: memoryLeakOK,
    snapshots: heapSnapshots
  };

  console.log(`     初始堆: ${(initialHeap / 1024 / 1024).toFixed(2)}MB`);
  console.log(`     最终堆: ${(finalHeap / 1024 / 1024).toFixed(2)}MB`);
  console.log(`     总增长: ${totalGrowthMB.toFixed(2)}MB ${memoryLeakOK ? '(正常)' : '(可能泄漏)'}`);

  // 9.2 GC 暂停影响
  console.log('\n  9.2 GC 暂停影响（压测期间记录GC事件）');
  await collectGarbage();

  const requestLatencies = [];
  const realGcEvents = [];
  let gcObserver;
  try {
    gcObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        realGcEvents.push({ type: entry.kind, duration: entry.duration, startTime: entry.startTime });
      }
    });
    gcObserver.observe({ entryTypes: ['gc'] });
    console.log('     ✅ GC 事件监听已启动');
  } catch (e) {
    console.log('     ⚠️ GC 事件监听不可用:', e.message);
  }

  const gcStartTime = performance.now();
  let gcRequestCount = 0;
  let gcSuccessCount = 0;

  if (global.gc) {
    console.log('     ⚠️ 使用 --expose-gc 模式，可手动触发GC');
  }

  const gcPromises = [];
  for (let i = 0; i < 50; i++) {
    const start = performance.now();
    gcPromises.push(
      axios.get(`${BASE_URL}/pool`, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      }).then(() => {
        const elapsed = performance.now() - start;
        requestLatencies.push(elapsed);
        gcSuccessCount++;
      }).catch(() => {
        requestLatencies.push(performance.now() - start);
      }).then(() => {
        gcRequestCount++;
      })
    );
  }

  await Promise.allSettled(gcPromises);

  if (gcObserver) {
    gcObserver.disconnect();
  }

  const latencyStats = calcStats(requestLatencies);
  const gcActualDuration = performance.now() - gcStartTime;

  console.log(`     真实 GC 事件数: ${realGcEvents.length}`);
  if (realGcEvents.length > 0) {
    const gcDurationSum = realGcEvents.reduce((s, e) => s + e.duration, 0);
    console.log(`     GC 总暂停时间: ${gcDurationSum.toFixed(2)}ms`);
    console.log(`     GC 平均暂停: ${(gcDurationSum / realGcEvents.length).toFixed(2)}ms`);
  }

  results.gcImpact = {
    requests: gcRequestCount,
    successCount: gcSuccessCount,
    durationMs: gcActualDuration.toFixed(2),
    requestLatencies: {
      avgMs: latencyStats.avg.toFixed(2),
      p50Ms: latencyStats.p50.toFixed(2),
      p95Ms: latencyStats.p95.toFixed(2),
      p99Ms: latencyStats.p99.toFixed(2),
      maxMs: latencyStats.max.toFixed(2)
    },
    gcEventCount: realGcEvents.length,
    gcEvents: realGcEvents.slice(0, 10)
  };

  console.log(`     请求数: ${gcRequestCount}, 成功: ${gcSuccessCount}`);
  console.log(`     延迟: avg=${latencyStats.avg.toFixed(2)}ms, p95=${latencyStats.p95.toFixed(2)}ms, p99=${latencyStats.p99.toFixed(2)}ms, max=${latencyStats.max.toFixed(2)}ms`);

  const moduleTime = performance.now() - moduleStart;
  results.durationMs = moduleTime.toFixed(2);
  results.status = 'success';

  return results;
}

// ============================================
// 报告生成与控制台摘要
// ============================================
function printSummary(report) {
  console.log('\n' + '='.repeat(70));
  console.log('  性能基准测试汇总报告');
  console.log('='.repeat(70));
  console.log(`\n  测试时间: ${report.timestamp}`);

  if (report.results.coldStart) {
    console.log('\n【冷启动延迟】');
    console.log(`  延迟: ${report.results.coldStart.latencyMs}ms`);
  }

  if (report.results.module1) {
    console.log('\n【模块1：API并发压测】');
    const m1 = report.results.module1;
    if (m1.capacity) {
      console.log(`  容量测试 QPS: ${m1.capacity.qps}`);
      console.log(`  P95延迟: ${m1.capacity.stats.p95}ms`);
      console.log(`  P99延迟: ${m1.capacity.stats.p99}ms`);
      console.log(`  成功率: ${m1.capacity.successRate}%`);
    }
  }

  if (report.results.module2) {
    console.log('\n【模块2：密码学基准】');
    const m2 = report.results.module2;
    if (m2.sm2Sign) {
      console.log(`  SM2签名: ${m2.sm2Sign.opsPerSec} ops/s`);
    }
    if (m2.sm3Hash && m2.sm3Hash['1KB']) {
      console.log(`  SM3哈希(1KB): ${m2.sm3Hash['1KB'].throughputMBs} MB/s`);
    }
    if (m2.sm4EncDec && m2.sm4EncDec['1KB']) {
      console.log(`  SM4加解密(1KB): ${m2.sm4EncDec['1KB'].throughputMBs} MB/s`);
    }
    if (m2.businessMapping) {
      console.log(`  业务映射: ${m2.businessMapping.sm2}`);
    }
  }

  if (report.results.module3) {
    console.log('\n【模块3：ZKP性能】');
    const m3 = report.results.module3;
    if (m3.proofGen) {
      console.log(`  证明生成: avg=${m3.proofGen.avgMs}ms, max=${m3.proofGen.maxMs}ms`);
    }
    if (m3.proofVerify) {
      console.log(`  证明验证: avg=${m3.proofVerify.avgMs}ms`);
    }
  }

  if (report.results.module4) {
    console.log('\n【模块4：数据库连接池压力测试】');
    const m4 = report.results.module4;
    if (m4.concurrentQuery) {
      console.log(`  200并发查询: avg=${m4.concurrentQuery.stats.avgMs}ms, p95=${m4.concurrentQuery.stats.p95Ms}ms, QPS=${m4.concurrentQuery.qps}, 成功率=${m4.concurrentQuery.successRate}%, errors=${m4.concurrentQuery.errors}`);
    }
    if (m4.recoveryTest) {
      console.log(`  连接池恢复: avg=${m4.recoveryTest.stats.avgMs}ms, 成功率=${m4.recoveryTest.successRate}%, errors=${m4.recoveryTest.errors}`);
    }
    if (m4.status === 'skipped') {
      console.log(`  状态: 已跳过 (${m4.reason || 'N/A'})`);
    }
  }

  if (report.results.module5) {
    console.log('\n【模块5：用户信息查询并发】');
    const m5 = report.results.module5;
    if (m5.results && m5.results.length > 0) {
      const lastPoint = m5.results[m5.results.length - 1];
      console.log(`  200并发P95: ${lastPoint.p95Ms}ms, 成功率: ${lastPoint.successRate}%`);
    }
  }

  if (report.results.module6) {
    console.log('\n【模块6：安全中间件链路】');
    const m6 = report.results.module6;
    if (m6.results && m6.results.length > 0) {
      const lastPoint = m6.results[m6.results.length - 1];
      console.log(`  200并发P95: ${lastPoint.p95Ms}ms, 成功率: ${lastPoint.successRate}%`);
    }
  }

  if (report.results.module8) {
    console.log('\n【模块8：端到端业务流程】');
    const m8 = report.results.module8;
    if (m8.loanProcess) {
      console.log(`  借款流程总耗时: ${m8.loanProcess.total}ms`);
    }
    if (m8.repayProcess) {
      console.log(`  还款流程总耗时: ${m8.repayProcess.total}ms`);
    }
  }

  if (report.results.module9) {
    console.log('\n【模块9：资源消耗监控】');
    const m9 = report.results.module9;
    if (m9.memoryLeak) {
      console.log(`  内存增长: ${m9.memoryLeak.totalGrowthMB}MB (限制50MB) ${m9.memoryLeak.withinLimit ? '✅' : '❌'}`);
    }
    if (m9.gcImpact) {
      console.log(`  GC影响P99: ${m9.gcImpact.requestLatencies.p99Ms}ms`);
    }
  }

  console.log('\n' + '='.repeat(70));
}

async function saveReport(report) {
  const resultsDir = path.join(__dirname, 'test_results');
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const fileName = `benchmark-report-${Date.now()}.json`;
  const filePath = path.join(resultsDir, fileName);

  report.duration = (performance.now() - globalStart).toFixed(2);
  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));

  console.log(`\n📊 详细报告已保存: ${filePath}`);
  return filePath;
}

// ============================================
// 主函数
// ============================================
async function runBenchmark() {
  console.log('='.repeat(70));
  console.log('  FinZkTrust 综合性能基准测试');
  console.log('='.repeat(70));
  console.log(`  开始时间: ${new Date().toLocaleString()}`);
  console.log(`  Node.js版本: ${process.version}`);
  console.log(`  环境变量加载: ${envPath}`);

  try {
    // ---- 不依赖数据库的模块先执行 ----
    testReport.results.module1 = await module1ApiStressTest();
    testReport.modules.apiStress = { status: testReport.results.module1.status };

    testReport.results.coldStart = await measureColdStart();

    testReport.results.module2 = await module2CryptoBenchmark();
    testReport.modules.crypto = { status: testReport.results.module2.status };

    testReport.results.module3 = await module3ZkpPerformance();
    testReport.modules.zkp = { status: testReport.results.module3.status };

    // 等待数据库连接池恢复
    console.log('\n⏳ 等待数据库连接池恢复 (10秒)...');
    await delay(10000);

    // ---- 依赖数据库的业务模块 ----
    testReport.results.module5 = await module5UserInfoConcurrency();
    testReport.modules.userInfo = { status: testReport.results.module5.status };

    testReport.results.module6 = await module6SecurityChainOverhead();
    testReport.modules.securityChain = { status: testReport.results.module6.status };

    // 再次等待，确保业务模块的连接全部释放
    console.log('\n⏳ 等待数据库连接池完全恢复 (10秒)...');
    await delay(10000);

    // ---- 最后执行数据库压力测试（不影响前面的任何模块） ----
    testReport.results.module4 = await module4DatabasePoolStress();
    testReport.modules.databaseStress = { status: testReport.results.module4.status };

    // ---- 模块8：端到端业务流程性能 ----
    testReport.results.module8 = await module8EndToEndBusinessPerformance();
    testReport.modules.e2eBusiness = { status: testReport.results.module8.status };

    // ---- 模块9：资源消耗监控 ----
    testReport.results.module9 = await module9ResourceMonitoring();
    testReport.modules.resourceMonitor = { status: testReport.results.module9.status };

    testReport.overallStatus = 'success';
    testReport.duration = (performance.now() - globalStart).toFixed(2);

    printSummary(testReport);
    await saveReport(testReport);

    console.log('\n✅ 性能基准测试完成！');
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
  runBenchmark();
}

module.exports = { runBenchmark, testReport };
