const { readJsonFile, writeJsonFile } = require('./backend/utils/fileUtils');
const poolService = require('./backend/services/poolService');
const { getLoanLimit } = require('./backend/routes/credit');

// 测试用例
const testCases = [
  {
    name: '测试1: 可借额度计算 - 信用分600',
    creditScore: 600,
    expectedLimit: 3500 // 600分属于较差，基础额度5000，系数0.7
  },
  {
    name: '测试2: 可借额度计算 - 信用分700',
    creditScore: 700,
    expectedLimit: 8000 // 700分属于一般，基础额度10000，系数0.8
  },
  {
    name: '测试3: 可借额度计算 - 信用分800',
    creditScore: 800,
    expectedLimit: 18000 // 800分属于良好，基础额度20000，系数0.9
  },
  {
    name: '测试4: 可借额度计算 - 信用分900',
    creditScore: 900,
    expectedLimit: 50000 // 900分属于优秀，基础额度50000，系数1.0
  }
];

// 执行测试
async function runTests() {
  console.log('开始执行业务流程测试...');
  
  // 测试1: 可借额度计算
  console.log('\n=== 测试可借额度计算 ===');
  for (const testCase of testCases) {
    const actualLimit = getLoanLimit(testCase.creditScore);
    const passed = actualLimit === testCase.expectedLimit;
    console.log(`${testCase.name}: ${passed ? '通过' : '失败'} (实际: ${actualLimit}, 期望: ${testCase.expectedLimit})`);
  }
  
  // 测试2: 资金池初始化
  console.log('\n=== 测试资金池初始化 ===');
  try {
    const initialized = await poolService.initializePool();
    console.log(`资金池初始化: ${initialized ? '成功' : '失败'}`);
  } catch (error) {
    console.log(`资金池初始化: 失败 - ${error.message}`);
  }
  
  // 测试3: 资金池信息获取
  console.log('\n=== 测试资金池信息获取 ===');
  try {
    const poolInfo = await poolService.getPoolInfo();
    console.log(`资金池信息获取: 成功`);
    console.log(`  总余额: ${poolInfo.totalBalance}`);
    console.log(`  用户资金池余额: ${poolInfo.userPoolBalance}`);
    console.log(`  原始资金池余额: ${poolInfo.originalPoolBalance}`);
  } catch (error) {
    console.log(`资金池信息获取: 失败 - ${error.message}`);
  }
  
  // 测试4: 模拟借款流程
  console.log('\n=== 测试借款流程 ===');
  try {
    // 模拟用户数据
    const users = await readJsonFile('users.json') || [];
    if (users.length === 0) {
      console.log('用户数据为空，无法测试借款流程');
    } else {
      const testUser = users[0];
      console.log(`测试用户: ${testUser.username} (信用分: ${testUser.creditScore})`);
      
      // 计算可借额度
      const loanLimit = getLoanLimit(testUser.creditScore);
      console.log(`可借额度: ${loanLimit}`);
      
      // 模拟借款
      const borrowAmount = 1000;
      console.log(`模拟借款: ${borrowAmount} 元`);
      
      try {
        const result = await poolService.borrowFromPool(testUser.id, borrowAmount, 30);
        console.log(`借款操作: 成功`);
        console.log(`  交易ID: ${result.transaction.id}`);
        console.log(`  利息: ${result.transaction.interest}`);
        console.log(`  应还总额: ${result.transaction.totalRepay}`);
        
        // 检查用户余额更新
        const updatedUsers = await readJsonFile('users.json');
        const updatedUser = updatedUsers.find(u => u.id === testUser.id);
        console.log(`  用户余额: ${updatedUser.balance}`);
        
        // 检查资金池余额更新
        const updatedPoolInfo = await poolService.getPoolInfo();
        console.log(`  资金池总余额: ${updatedPoolInfo.totalBalance}`);
        
      } catch (error) {
        console.log(`借款操作: 失败 - ${error.message}`);
      }
    }
  } catch (error) {
    console.log(`借款流程测试: 失败 - ${error.message}`);
  }
  
  // 测试5: 模拟还款流程
  console.log('\n=== 测试还款流程 ===');
  try {
    // 获取交易记录
    const transactions = await readJsonFile('transactions.json') || [];
    const loanTransactions = transactions.filter(t => t.type === 'loan' && t.status === 'pending');
    
    if (loanTransactions.length === 0) {
      console.log('无待还款交易，无法测试还款流程');
    } else {
      const testTransaction = loanTransactions[0];
      console.log(`测试交易: ID ${testTransaction.id} (金额: ${testTransaction.amount})`);
      
      // 模拟还款
      try {
        const result = await poolService.repay(testTransaction.toUserId, testTransaction.amount, testTransaction.interest);
        console.log(`还款操作: 成功`);
        
        // 检查资金池余额更新
        const updatedPoolInfo = await poolService.getPoolInfo();
        console.log(`  资金池总余额: ${updatedPoolInfo.totalBalance}`);
        
      } catch (error) {
        console.log(`还款操作: 失败 - ${error.message}`);
      }
    }
  } catch (error) {
    console.log(`还款流程测试: 失败 - ${error.message}`);
  }
  
  console.log('\n业务流程测试完成！');
}

// 运行测试
runTests().catch(console.error);
