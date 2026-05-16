const { generateSM2KeyPair, signWithSM2 } = require('./backend/utils/cryptoUtils');

// 生成SM2密钥对
const keyPair = generateSM2KeyPair();
console.log('SM2 Key Pair:');
console.log('Public Key:', keyPair.publicKey);
console.log('Private Key:', keyPair.privateKey);

// 测试签名
const testData = JSON.stringify({ userId: '1', creditScore: 750 });
const signature = signWithSM2(testData, keyPair.privateKey);
console.log('\nTest Signature:', signature);
