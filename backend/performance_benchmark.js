const { verifySM2Signature, verifySM2SignaturesInParallel, generateSM3Hash, generateSM2KeyPair, signWithSM2, generateSaltedSM3Hash, verifySM3Hash } = require('./utils/cryptoUtils');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

// 测试配置
const CONFIG = {
  // 测试迭代次数
  REAL_TEST_ITERATIONS: 10,
  SIMULATED_TEST_ITERATIONS: 20,
  WARMUP_ITERATIONS: 3,
  
  // 测试数据配置
  REAL_DATA_FILE: './test_data/real_sm2_data.json',
  SIMULATED_DATA_COUNT: 100,
  
  // 结果目录
  RESULTS_DIR: './test_results',
  
  // 旧文件清理配置
  OLD_SCRIPTS_TO_DELETE: ['old_performance_test.js'],
  OLD_RESULTS_PATTERN: 'performance_results_*.json'
};

// 测试结果
const testResults = {
  timestamp: new Date().toISOString(),
  config: CONFIG,
  warmup: {
    realData: {},
    simulatedData: {}
  },
  tests: {
    realSM2Verification: {
      name: '真实SM2验证性能测试',
      results: [],
      summary: {}
    },
    simulatedCachePerformance: {
      name: '模拟缓存性能测试',
      results: [],
      summary: {}
    }
  },
  systemMetrics: {},
  analysis: {
    performanceEvaluation: {},
    optimizationSuggestions: []
  }
};

// 确保结果目录存在
function ensureResultsDir() {
  if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
  }
}

// 生成真实的SM2测试数据
function generateRealSM2TestData(count = 10) {
  console.log(`生成${count}条SM2测试数据...`);
  const testData = [];
  
  for (let i = 0; i < count; i++) {
    // 生成新的密钥对
    const keyPair = generateSM2KeyPair();
    
    // 生成测试消息
    const userId = `user_${(i + 1) * 100}`;
    const creditScore = 600 + Math.floor(Math.random() * 300); // 600-899之间的信用分数
    const message = `${userId}_credit_score_${creditScore}`;
    
    // 生成签名
    const signature = signWithSM2(message, keyPair.privateKey);
    
    // 添加到测试数据
    testData.push({
      id: i + 1,
      message,
      signature,
      publicKey: keyPair.publicKey
    });
  }
  
  // 保存测试数据到文件
  const testDataDir = path.dirname(CONFIG.REAL_DATA_FILE);
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  
  fs.writeFileSync(CONFIG.REAL_DATA_FILE, JSON.stringify(testData, null, 2));
  console.log(`测试数据已生成并保存到: ${CONFIG.REAL_DATA_FILE}`);
  
  return testData;
}

// 生成测试数据
function generateTestData(count) {
  const keyPair = generateSM2KeyPair();
  const testData = [];
  
  for (let i = 0; i < count; i++) {
    const message = `test message ${i} ${Math.random().toString(36).substring(2, 15)}`;
    const signature = signWithSM2(message, keyPair.privateKey);
    testData.push({
      id: i + 1,
      message,
      signature,
      publicKey: keyPair.publicKey
    });
  }
  
  return testData;
}

// 加载真实测试数据
function loadRealTestData() {
  try {
    if (fs.existsSync(CONFIG.REAL_DATA_FILE)) {
      const data = fs.readFileSync(CONFIG.REAL_DATA_FILE, 'utf8');
      return JSON.parse(data);
    }
    console.log('真实测试数据文件不存在，生成新的测试数据');
    return generateRealSM2TestData(10);
  } catch (error) {
    console.error('加载真实测试数据失败:', error.message);
    return generateRealSM2TestData(10);
  }
}

// 缓存预热
async function warmupCache(testData, iterations, testName) {
  console.log(`开始${testName}缓存预热...`);
  
  const warmupResults = [];
  
  for (let i = 0; i < iterations; i++) {
    const startTime = performance.now();
    
    for (const data of testData) {
      verifySM2Signature(data.message, data.signature, data.publicKey);
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    const averageTime = duration / testData.length;
    
    warmupResults.push({
      iteration: i + 1,
      duration,
      averageTime
    });
  }
  
  const totalDuration = warmupResults.reduce((sum, result) => sum + result.duration, 0);
  const averageDuration = totalDuration / iterations;
  
  console.log(`缓存预热完成: 总耗时${totalDuration.toFixed(2)}ms，平均${averageDuration.toFixed(4)}ms/次`);
  
  return {
    results: warmupResults,
    totalDuration,
    averageDuration
  };
}

// 运行真实SM2验证测试
async function runRealSM2VerificationTest(testData, iterations) {
  console.log('开始真实SM2验证性能测试...');
  
  const testResults = [];
  
  for (let i = 0; i < iterations; i++) {
    const iterationResults = [];
    const startTime = performance.now();
    
    for (const data of testData) {
      const requestStartTime = performance.now();
      
      try {
        const result = verifySM2Signature(data.message, data.signature, data.publicKey);
        const requestEndTime = performance.now();
        const responseTime = requestEndTime - requestStartTime;
        
        iterationResults.push({
          dataId: data.id,
          success: result,
          responseTime,
          error: null
        });
      } catch (error) {
        const requestEndTime = performance.now();
        const responseTime = requestEndTime - requestStartTime;
        
        iterationResults.push({
          dataId: data.id,
          success: false,
          responseTime,
          error: error.message
        });
      }
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    const successCount = iterationResults.filter(r => r.success).length;
    const successRate = (successCount / iterationResults.length) * 100;
    const averageResponseTime = iterationResults.reduce((sum, r) => sum + r.responseTime, 0) / iterationResults.length;
    const minResponseTime = Math.min(...iterationResults.map(r => r.responseTime));
    const maxResponseTime = Math.max(...iterationResults.map(r => r.responseTime));
    
    testResults.push({
      iteration: i + 1,
      duration,
      successCount,
      successRate,
      averageResponseTime,
      minResponseTime,
      maxResponseTime,
      detailedResults: iterationResults
    });
  }
  
  return testResults;
}

// 运行模拟缓存性能测试
async function runSimulatedCachePerformanceTest(testData, iterations) {
  console.log('开始模拟缓存性能测试...');
  
  const testResults = [];
  
  for (let i = 0; i < iterations; i++) {
    const iterationResults = [];
    const startTime = performance.now();
    
    for (const data of testData) {
      const requestStartTime = performance.now();
      
      try {
        const result = verifySM2Signature(data.message, data.signature, data.publicKey);
        const requestEndTime = performance.now();
        const responseTime = requestEndTime - requestStartTime;
        
        iterationResults.push({
          dataId: data.id,
          success: result,
          responseTime,
          error: null
        });
      } catch (error) {
        const requestEndTime = performance.now();
        const responseTime = requestEndTime - requestStartTime;
        
        iterationResults.push({
          dataId: data.id,
          success: false,
          responseTime,
          error: error.message
        });
      }
    }
    
    const endTime = performance.now();
    const duration = endTime - startTime;
    const successCount = iterationResults.filter(r => r.success).length;
    const successRate = (successCount / iterationResults.length) * 100;
    const averageResponseTime = iterationResults.reduce((sum, r) => sum + r.responseTime, 0) / iterationResults.length;
    
    testResults.push({
      iteration: i + 1,
      duration,
      successCount,
      successRate,
      averageResponseTime,
      detailedResults: iterationResults
    });
  }
  
  return testResults;
}

// 分析测试结果
function analyzeResults() {
  console.log('分析测试结果...');
  
  // 分析真实SM2验证测试结果
  const realSM2Results = testResults.tests.realSM2Verification.results;
  if (realSM2Results.length > 0) {
    const totalRequests = realSM2Results.length * realSM2Results[0].detailedResults.length;
    const totalSuccessCount = realSM2Results.reduce((sum, result) => sum + result.successCount, 0);
    const overallSuccessRate = (totalSuccessCount / totalRequests) * 100;
    
    const allResponseTimes = realSM2Results.flatMap(result => 
      result.detailedResults.map(r => r.responseTime)
    );
    const minResponseTime = Math.min(...allResponseTimes);
    const maxResponseTime = Math.max(...allResponseTimes);
    const averageResponseTime = allResponseTimes.reduce((sum, time) => sum + time, 0) / allResponseTimes.length;
    
    testResults.tests.realSM2Verification.summary = {
      totalRequests,
      totalSuccessCount,
      overallSuccessRate,
      minResponseTime,
      maxResponseTime,
      averageResponseTime
    };
  }
  
  // 分析模拟缓存性能测试结果
  const simulatedResults = testResults.tests.simulatedCachePerformance.results;
  if (simulatedResults.length > 0) {
    const initialResponseTime = simulatedResults[0].averageResponseTime;
    const finalResponseTime = simulatedResults[simulatedResults.length - 1].averageResponseTime;
    const performanceImprovement = ((initialResponseTime - finalResponseTime) / initialResponseTime) * 100;
    
    testResults.tests.simulatedCachePerformance.summary = {
      initialResponseTime,
      finalResponseTime,
      performanceImprovement
    };
  }
  
  // 性能评估
  const evaluation = {
    stability: '良好',
    responseSpeed: '良好',
    cacheEffect: '良好'
  };
  
  if (testResults.tests.realSM2Verification.summary) {
    const successRate = testResults.tests.realSM2Verification.summary.overallSuccessRate;
    const avgResponseTime = testResults.tests.realSM2Verification.summary.averageResponseTime;
    
    if (successRate >= 100) {
      evaluation.stability = '优秀';
    } else if (successRate < 95) {
      evaluation.stability = '需要改进';
    }
    
    if (avgResponseTime < 5) {
      evaluation.responseSpeed = '优秀';
    } else if (avgResponseTime > 20) {
      evaluation.responseSpeed = '需要改进';
    }
  }
  
  if (testResults.tests.simulatedCachePerformance.summary) {
    const improvement = testResults.tests.simulatedCachePerformance.summary.performanceImprovement;
    
    if (improvement > 40) {
      evaluation.cacheEffect = '显著';
    } else if (improvement < 20) {
      evaluation.cacheEffect = '需要改进';
    }
  }
  
  testResults.analysis.performanceEvaluation = evaluation;
  
  // 优化建议
  const suggestions = [];
  
  if (evaluation.stability !== '优秀') {
    suggestions.push('提高系统稳定性，确保100%的请求成功率');
  }
  
  if (evaluation.responseSpeed !== '优秀') {
    suggestions.push('优化SM2验证算法实现，降低响应时间');
    suggestions.push('提高并发处理能力，优化线程池配置');
  }
  
  if (evaluation.cacheEffect !== '显著') {
    suggestions.push('增加缓存容量，实现LRU淘汰策略');
    suggestions.push('考虑使用缓存服务器分离架构');
  }
  
  suggestions.push('实现系统资源使用实时监控');
  suggestions.push('进行多用户并发负载测试');
  suggestions.push('定期轮换密钥对，确保系统安全性');
  
  testResults.analysis.optimizationSuggestions = suggestions;
}

// 保存测试结果
function saveResults() {
  ensureResultsDir();
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resultFile = path.join(CONFIG.RESULTS_DIR, `performance_results_${timestamp}.json`);
  
  fs.writeFileSync(resultFile, JSON.stringify(testResults, null, 2));
  console.log(`测试结果已保存到: ${resultFile}`);
  
  // 同时保存为最新结果
  const latestResultFile = path.join(CONFIG.RESULTS_DIR, 'performance_results_latest.json');
  fs.writeFileSync(latestResultFile, JSON.stringify(testResults, null, 2));
}

// 清理旧文件
function cleanOldFiles() {
  console.log('清理旧文件...');
  
  // 清理旧脚本
  CONFIG.OLD_SCRIPTS_TO_DELETE.forEach(script => {
    const scriptPath = path.join(__dirname, script);
    if (fs.existsSync(scriptPath)) {
      fs.unlinkSync(scriptPath);
      console.log(`已删除旧脚本: ${script}`);
    }
  });
  
  // 清理旧结果文件
  if (fs.existsSync(CONFIG.RESULTS_DIR)) {
    const files = fs.readdirSync(CONFIG.RESULTS_DIR);
    files.forEach(file => {
      if (file.match(CONFIG.OLD_RESULTS_PATTERN)) {
        const filePath = path.join(CONFIG.RESULTS_DIR, file);
        fs.unlinkSync(filePath);
        console.log(`已删除旧结果文件: ${file}`);
      }
    });
  }
}

// 运行所有测试
async function runAllTests() {
  console.log('开始性能基准测试...');
  console.log('====================================');
  
  try {
    // 准备阶段
    ensureResultsDir();
    
    // 生成并加载测试数据
    console.log('生成并加载测试数据...');
    const realTestData = loadRealTestData();
    const simulatedTestData = generateTestData(CONFIG.SIMULATED_DATA_COUNT);
    
    // 预热阶段
    console.log('\n预热阶段:');
    testResults.warmup.realData = await warmupCache(realTestData, CONFIG.WARMUP_ITERATIONS, '真实数据');
    testResults.warmup.simulatedData = await warmupCache(simulatedTestData, CONFIG.WARMUP_ITERATIONS, '模拟数据');
    
    // 测试执行阶段
    console.log('\n测试执行阶段:');
    testResults.tests.realSM2Verification.results = await runRealSM2VerificationTest(realTestData, CONFIG.REAL_TEST_ITERATIONS);
    testResults.tests.simulatedCachePerformance.results = await runSimulatedCachePerformanceTest(simulatedTestData, CONFIG.SIMULATED_TEST_ITERATIONS);
    
    // 结果分析阶段
    console.log('\n结果分析阶段:');
    analyzeResults();
    saveResults();
    
    // 清理阶段
    console.log('\n清理阶段:');
    cleanOldFiles();
    
    // 输出测试摘要
    console.log('\n====================================');
    console.log('性能基准测试完成！');
    console.log('\n测试结果摘要:');
    console.log(`\n1. 真实SM2验证测试:`);
    if (testResults.tests.realSM2Verification.summary) {
      const summary = testResults.tests.realSM2Verification.summary;
      console.log(`   总请求数: ${summary.totalRequests}`);
      console.log(`   成功率: ${summary.overallSuccessRate.toFixed(2)}%`);
      console.log(`   平均响应时间: ${summary.averageResponseTime.toFixed(4)}ms`);
      console.log(`   最小响应时间: ${summary.minResponseTime.toFixed(4)}ms`);
      console.log(`   最大响应时间: ${summary.maxResponseTime.toFixed(4)}ms`);
    }
    
    console.log(`\n2. 模拟缓存性能测试:`);
    if (testResults.tests.simulatedCachePerformance.summary) {
      const summary = testResults.tests.simulatedCachePerformance.summary;
      console.log(`   初始响应时间: ${summary.initialResponseTime.toFixed(4)}ms`);
      console.log(`   最终响应时间: ${summary.finalResponseTime.toFixed(4)}ms`);
      console.log(`   性能提升: ${summary.performanceImprovement.toFixed(2)}%`);
    }
    
    console.log(`\n3. 性能评估:`);
    console.log(`   稳定性: ${testResults.analysis.performanceEvaluation.stability}`);
    console.log(`   响应速度: ${testResults.analysis.performanceEvaluation.responseSpeed}`);
    console.log(`   缓存效果: ${testResults.analysis.performanceEvaluation.cacheEffect}`);
    
    console.log(`\n4. 优化建议:`);
    testResults.analysis.optimizationSuggestions.forEach((suggestion, index) => {
      console.log(`   ${index + 1}. ${suggestion}`);
    });
    
    console.log('\n====================================');
  } catch (error) {
    console.error('性能测试失败:', error);
  }
}

// 运行测试
runAllTests();
