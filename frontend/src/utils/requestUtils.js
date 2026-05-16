/**
 * 生成随机的32位Nonce
 * @returns {string} 32位随机字符串
 */
export function generateNonce() {
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
export function generateRequestHeaders(method, body, privateKey) {
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
  
  // SM2签名 - 这里需要使用前端的SM2签名函数
  // 假设前端已经有signSM2函数
  const signature = signSM2(signatureData, privateKey);
  
  return {
    'X-Request-Timestamp': timestamp,
    'X-Request-Nonce': nonce,
    'X-Request-Sign': signature
  };
}

/**
 * 辅助函数：获取用户SM2私钥
 * @returns {string|null} SM2私钥
 */
export function getSM2PrivateKey() {
  return localStorage.getItem('sm2PrivateKey');
}

/**
 * 带签名的API请求
 * @param {string} url - 请求URL
 * @param {object} options - 请求选项
 * @returns {Promise} 请求结果
 */
export async function signedRequest(url, options = {}) {
  const method = options.method || 'GET';
  const body = options.body;
  const privateKey = getSM2PrivateKey();
  
  if (!privateKey) {
    throw new Error('SM2私钥不存在');
  }
  
  // 生成请求头
  const headers = generateRequestHeaders(method, body, privateKey);
  
  // 合并请求头
  const requestOptions = {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...options.headers
    }
  };
  
  // 发送请求
  const response = await fetch(url, requestOptions);
  return response.json();
}

// 假设前端的SM2签名函数
export function signSM2(data, privateKey) {
  // 这里需要实现前端的SM2签名逻辑
  // 可以使用现有的SM2库
  console.warn('SM2签名函数需要实现');
  return 'mock-signature'; // 临时返回模拟签名
}