const jwt = require('jsonwebtoken');

// 设置JWT密钥
process.env.JWT_SECRET = 'test-secret-key';

// 生成测试令牌
const user = {
  id: 1,
  username: 'test-user'
};

const token = jwt.sign(user, process.env.JWT_SECRET, {
  expiresIn: '24h'
});

console.log('Generated token:', token);
console.log('User info:', user);
