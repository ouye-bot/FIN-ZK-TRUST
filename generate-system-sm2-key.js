const { generateSM2KeyPair } = require('./backend/utils/cryptoUtils');

// 为system用户生成SM2密钥对
const keyPair = generateSM2KeyPair();
console.log('System User SM2 Key Pair:');
console.log('Public Key:', keyPair.publicKey);
console.log('Private Key:', keyPair.privateKey);
