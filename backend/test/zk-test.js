const path = require('path');
const backendDir = path.join(__dirname, '..').replace(/\\/g, '/');
console.log('Backend dir:', backendDir);
try {
  const zkService = require(backendDir + '/services/zkService');
  console.log('Loaded zkService, keys:', Object.keys(zkService));
} catch (e) {
  console.error('Failed:', e.message);
}
