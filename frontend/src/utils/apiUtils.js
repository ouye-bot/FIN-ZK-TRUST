/**
 * API 工具模块
 * 提供防重放攻击和 SM2 签名的请求功能
 */

const SIGN_REQUEST_EVENT = 'finzktrust:sign-request';
const SIGN_RESPONSE_EVENT = 'finzktrust:sign-response';

const canonicalStringify = (data) => {
  if (data === null || data === undefined) return JSON.stringify(data);
  if (typeof data !== 'object') return JSON.stringify(data);
  if (Array.isArray(data)) return '[' + data.map(canonicalStringify).join(',') + ']';
  const keys = Object.keys(data).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalStringify(data[k])).join(',') + '}';
};

const generateNonce = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = new Uint8Array(32);
  crypto.getRandomValues(randomValues);
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(randomValues[i] % chars.length);
  }
  return nonce;
};

const requestSignature = (signatureData) => new Promise((resolve) => {
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

    if (sig) {
      bestSignature = sig;
      finish(sig);
    }
  };

  const timeout = setTimeout(() => {
    console.log('[apiUtils] 签名收集超时，已收集到:', bestSignature ? '有效签名' : 'null');
    finish(bestSignature);
  }, 200);

  window.addEventListener(SIGN_RESPONSE_EVENT, collectHandler);

  window.dispatchEvent(new CustomEvent(SIGN_REQUEST_EVENT, {
    detail: { data: signatureData, requestId }
  }));
});

export const fetchWithAntiReplay = async (url, options = {}, skipSignature = false) => {
  const token = localStorage.getItem('token');
  if (token) {
    options.headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
  }

  if (options.body && !options.headers?.['Content-Type']) {
    options.headers = {
      ...options.headers,
      'Content-Type': 'application/json'
    };
  }

  if (options.body) {
    const timestamp = Date.now().toString();
    const nonce = generateNonce();

    options.headers = {
      ...options.headers,
      'X-Request-Timestamp': timestamp,
      'X-Request-Nonce': nonce,
    };

    if (!skipSignature) {
      const requestBody = options.body || '{}';
      let bodyObj = {};
      try {
        bodyObj = JSON.parse(requestBody);
      } catch (e) {
        bodyObj = {};
      }
      const signatureData = timestamp + nonce + canonicalStringify(bodyObj);

      const signature = await requestSignature(signatureData);
      if (!signature) {
        throw new Error('SM2签名生成失败，请确保设备密钥已正确设置');
      }

      const userId = JSON.parse(localStorage.getItem('user'))?.id;

      options.headers = {
        ...options.headers,
        'X-User-Id': userId?.toString(),
        'X-SM2-Signature': signature,
      };
    }
  }

  return fetch(url, options);
};

export const post = async (url, data, skipSignature = false) => {
  return fetchWithAntiReplay(url, {
    method: 'POST',
    body: JSON.stringify(data)
  }, skipSignature);
};

export const put = async (url, data, skipSignature = false) => {
  return fetchWithAntiReplay(url, {
    method: 'PUT',
    body: JSON.stringify(data)
  }, skipSignature);
};

export const get = async (url) => {
  return fetchWithAntiReplay(url, {
    method: 'GET'
  });
};