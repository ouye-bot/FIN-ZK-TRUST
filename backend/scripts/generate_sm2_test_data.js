const { generateSM2KeyPair, signWithSM2 } = require('../utils/cryptoUtils');
const fs = require('fs');
const path = require('path');

// 生成真实的SM2测试数据
function generateRealSM2TestData(count = 10) {
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
  
  return testData;
}

// 保存测试数据到文件
function saveTestData(data) {
  const testDataDir = path.join(__dirname, '../test_data');
  const testDataFile = path.join(testDataDir, 'real_sm2_data.json');
  
  // 确保目录存在
  if (!fs.existsSync(testDataDir)) {
    fs.mkdirSync(testDataDir, { recursive: true });
  }
  
  // 保存数据
  fs.writeFileSync(testDataFile, JSON.stringify(data, null, 2));
  console.log(`测试数据已生成并保存到: ${testDataFile}`);
  console.log(`生成了 ${data.length} 条测试数据`);
}

// 运行生成脚本
const testData = generateRealSM2TestData(10);
saveTestData(testData);
