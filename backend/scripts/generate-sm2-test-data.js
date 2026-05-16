const { generateSM2KeyPair, signWithSM2 } = require('../utils/cryptoUtils');
const fs = require('fs');
const path = require('path');

class SM2TestDataGenerator {
  constructor() {
    this.testData = [];
  }

  generateData(uniqueCount = 5, totalCount = 100) {
    console.log(`生成SM2测试数据: ${uniqueCount}组唯一数据，共${totalCount}条`);
    
    try {
      // 生成唯一数据
      const uniqueData = [];
      for (let i = 0; i < uniqueCount; i++) {
        const keyPair = generateSM2KeyPair();
        const transactionData = {
          userId: `user${i}`,
          amount: Math.floor(Math.random() * 10000) + 100,
          timestamp: Date.now() + i,
          type: i % 2 === 0 ? 'loan' : 'invest'
        };
        const dataStr = JSON.stringify(transactionData);
        const signature = signWithSM2(dataStr, keyPair.privateKey);
        
        uniqueData.push({
          publicKey: keyPair.publicKey,
          data: transactionData,
          dataStr: dataStr,
          signature: signature,
          preHash: false
        });
      }
      
      // 生成重复数据
      for (let i = 0; i < totalCount; i++) {
        const index = i % uniqueCount;
        this.testData.push({
          ...uniqueData[index],
          id: `test_${i}`
        });
      }
      
      console.log(`✓ 生成成功，共${this.testData.length}条数据`);
      return this.testData;
    } catch (error) {
      console.error('生成测试数据失败:', error.message);
      return [];
    }
  }

  saveData(outputFile) {
    try {
      const outputPath = path.join(__dirname, '../test_data', outputFile);
      const outputDir = path.dirname(outputPath);
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      fs.writeFileSync(outputPath, JSON.stringify(this.testData, null, 2));
      console.log(`✓ 测试数据已保存到: ${outputPath}`);
      return true;
    } catch (error) {
      console.error('保存测试数据失败:', error.message);
      return false;
    }
  }
}

// 运行生成器
if (require.main === module) {
  const generator = new SM2TestDataGenerator();
  generator.generateData(5, 100);
  generator.saveData('sm2-test-data.json');
}

module.exports = SM2TestDataGenerator;