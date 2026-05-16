/**
 * API 工具模块
 * 提供防重放攻击的签名请求功能
 */

// 签名请求事件名
const SIGN_REQUEST_EVENT = 'finzktrust:sign-request';
const SIGN_RESPONSE_EVENT = 'finzktrust:sign-response';

/**
 * 生成32位随机字符串
 * @returns {string} 32位随机字符串
 */
const generateNonce = () => {
  let nonce = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
};

/**
 * 封装的fetch请求，自动添加防重放攻击所需的请求头
 * @param {string} url 请求URL
 * @param {Object} options 请求选项
 * @param {boolean} skipSignature 是否跳过SM2签名（用于注册等不需要签名的接口）
 * @returns {Promise} fetch请求的Promise
 */
export const fetchWithAntiReplay = async (url, options = {}, skipSignature = false) => {
  // 添加Authorization头
  const token = localStorage.getItem('token');
  if (token) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
  }

  // 确保Content-Type头
  if (options.method === 'POST' && !options.headers?.['Content-Type']) {
    options.headers = {
      ...options.headers,
      'Content-Type': 'application/json'
    };
  }

  // 对POST请求添加防重放攻击请求头（除非明确跳过）
  if (options.method === 'POST' && !skipSignature) {
    // 生成时间戳和随机数
    const timestamp = Date.now().toString();
    const nonce = generateNonce();

    // 获取请求体
    const requestBody = options.body || JSON.stringify({});

    // 构建签名原文：时间戳+随机数+请求体JSON字符串
    const signatureData = timestamp + nonce + requestBody;

    // 封装签名请求函数，短暂收集所有响应（优先采用非 null 的签名）
    const requestSignature = () => new Promise((resolve) => {
      const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      console.log('[apiUtils] 请求签名，requestId:', requestId);
      
      let resolved = false;
      let bestSignature = null;

      const finish = (sig) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        window.removeEventListener(SIGN_RESPONSE_EVENT, collectHandler);
        resolve(sig);
      };

      const collectHandler = (e) => {
        if (e.detail.requestId !== requestId) return;
        const sig = e.detail.signature || null;
        console.log('[apiUtils] 收集到签名响应，signature:', sig ? '存在' : 'null');

        // 只要有非 null 的签名，立即采用
        if (sig) {
          bestSignature = sig;
          finish(sig);
        }
        // 如果是 null，不立即结束，等待其他响应
      };

      const timeout = setTimeout(() => {
        console.log('[apiUtils] 签名收集超时，已收集到:', bestSignature ? '有效签名' : 'null');
        finish(bestSignature); // 可能为 null，调用方就知道失败了
      }, 200); // 200ms 足够处理两个并行的 handler 响应

      window.addEventListener(SIGN_RESPONSE_EVENT, collectHandler);

      window.dispatchEvent(new CustomEvent(SIGN_REQUEST_EVENT, {
        detail: { data: signatureData, requestId }
      }));
    });

    // 发送签名请求（单次，但会短暂收集所有响应）
    let signature = await requestSignature();

    // 若收集结果为 null，抛出错误
    if (!signature) {
      throw new Error('SM2签名生成失败，请确保设备密钥已正确设置');
    }

    // 签名成功，添加防重放请求头
    options.headers = {
      ...options.headers,
      'X-Request-Timestamp': timestamp,
      'X-Request-Nonce': nonce,
      'X-Request-Sign': signature
    };
  }

  // 执行fetch请求
  return fetch(url, options);
};

/**
 * 简化的POST请求函数
 * @param {string} url 请求URL
 * @param {Object} data 请求数据
 * @param {boolean} skipSignature 是否跳过SM2签名（用于注册等不需要签名的接口）
 * @returns {Promise} fetch请求的Promise
 */
export const post = async (url, data, skipSignature = false) => {
  return fetchWithAntiReplay(url, {
    method: 'POST',
    body: JSON.stringify(data)
  }, skipSignature);
};

/**
 * 简化的GET请求函数
 * @param {string} url 请求URL
 * @returns {Promise} fetch请求的Promise
 */
export const get = async (url) => {
  return fetchWithAntiReplay(url, {
    method: 'GET'
  });
};