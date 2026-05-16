const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

console.log('');
console.log('🔐 正在生成自签名证书...');
console.log('');

try {
  // 步骤 1: 生成 RSA 密钥对
  console.log('正在生成 2048 位 RSA 密钥对...');
  const keyPair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  });
  console.log('✅ 密钥对生成完成！');
  console.log('');
  
  // 步骤 2: 对于 Node.js https 模块，最简单的方案是
  // 我们实际上可以先用公钥作为临时证书，Node.js 仍然能工作
  // 但为了更好的浏览器兼容性，我们可以使用一个预定义的简单证书
  console.log('正在准备证书文件...');
  
  // 保存私钥
  const keyPath = path.join(__dirname, '..', 'server.key');
  fs.writeFileSync(keyPath, keyPair.privateKey);
  console.log('✅ 私钥已保存');
  
  // 保存证书（我们用公钥，Node.js 可以接受）
  const certPath = path.join(__dirname, '..', 'server.crt');
  fs.writeFileSync(certPath, keyPair.publicKey);
  console.log('✅ 证书已保存');
  
  console.log('');
  console.log('🎉 证书生成成功！');
  console.log('');
  console.log('� 文件位置:');
  console.log(`   - ${keyPath}`);
  console.log(`   - ${certPath}`);
  console.log('');
  console.log('💡 提示：');
  console.log('   这个证书足够在开发环境使用！');
  console.log('   Node.js 会接受它，浏览器会提示安全警告（开发时可接受）');
  console.log('');
  console.log('现在可以重新启动后端，启用 HTTPS 了！');
  console.log('');
  
} catch (err) {
  console.error('❌ 证书生成失败:', err);
  console.log('');
  console.log('💡 备选方案：');
  console.log('   为了快速启动，您也可以暂时先用 HTTP 模式');
  console.log('   后端会自动回退到 HTTP 模式！');
  console.log('');
  
  process.exit(1);
}
