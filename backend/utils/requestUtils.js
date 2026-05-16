const { signSM2 } = require('./cryptoUtils');

/**
 * 生成随机的32位Nonce
 * @returns {string} 32位随机字符串
 */
function generateNonce() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * 生成请求头
 * @param {string} method - 请求方法 (GET, POST)
 * @param {object} body - 请求体 (POST时使用)
 * @param {string} privateKey - SM2私钥
 * @returns {object} 请求头对象
 */
exports.generateRequestHeaders = function(method, body, privateKey) {
  const timestamp = Date.now().toString();
  const nonce = generateNonce();
  
  // 构建签名原文
  let signatureData;
  if (method === 'GET') {
    signatureData = timestamp + nonce;
  } else {
    const requestBodyStr = JSON.stringify(body || {});
    signatureData = timestamp + nonce + requestBodyStr;
  }
  
  // SM2签名
  const signature = signSM2(signatureData, privateKey);
  
  return {
    'X-Request-Timestamp': timestamp,
    'X-Request-Nonce': nonce,
    'X-Request-Sign': signature
  };
};

/**
 * 验证请求头
 * @param {object} headers - 请求头对象
 * @param {string} method - 请求方法
 * @param {object} body - 请求体
 * @param {string} publicKey - SM2公钥
 * @returns {object} 验证结果
 */
exports.validateRequestHeaders = function(headers, method, body, publicKey) {
  const timestamp = headers['x-request-timestamp'];
  const nonce = headers['x-request-nonce'];
  const signature = headers['x-request-sign'];
  
  if (!timestamp || !nonce || !signature) {
    return { valid: false, message: '缺少必要的请求头字段' };
  }
  
  // 验证时间戳
  const now = Date.now();
  const requestTime = parseInt(timestamp);
  if (isNaN(requestTime) || now - requestTime > 5 * 60 * 1000) {
    return { valid: false, message: '请求已过期' };
  }
  
  // 验证Nonce
  if (typeof nonce !== 'string' || nonce.length !== 32) {
    return { valid: false, message: '无效的随机数Nonce' };
  }
  
  // 构建签名原文
  let signatureData;
  if (method === 'GET') {
    signatureData = timestamp + nonce;
  } else {
    const requestBodyStr = JSON.stringify(body || {});
    signatureData = timestamp + nonce + requestBodyStr;
  }
  
  // 验证签名
  const { verifySM2Signature } = require('./cryptoUtils');
  const isSignatureValid = verifySM2Signature(signatureData, signature, publicKey);
  if (!isSignatureValid) {
    return { valid: false, message: '请求签名无效' };
  }
  
  return { valid: true, message: '验证通过' };
};