/**
 * 设备主密钥管理器
 * 实现"设备主密钥 + 临时传输密钥"两层密钥体系
 */

/**
 * 生成随机 AES-GCM 256 位设备主密钥
 * @returns {Promise<CryptoKey>} - 设备主密钥
 */
export const generateDeviceKey = async () => {
  return await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true, // 可导出
    ['encrypt', 'decrypt']
  );
};

/**
 * 从 sessionKey JWT 派生传输密钥
 * @param {string} sessionKey - JWT 字符串
 * @returns {Promise<CryptoKey>} - 传输密钥
 */
export const deriveTransportKey = async (sessionKey) => {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(sessionKey),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  const salt = enc.encode('transport-key');
  return await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * 用传输密钥加密设备主密钥
 * @param {CryptoKey} deviceKey - 设备主密钥
 * @param {CryptoKey} transportKey - 传输密钥
 * @returns {Promise<{ciphertext: string, iv: string}>} - 加密后的设备主密钥
 */
export const encryptDeviceKey = async (deviceKey, transportKey) => {
  // 导出设备主密钥为 raw 格式
  const exportedKey = await crypto.subtle.exportKey('raw', deviceKey);
  
  // 生成随机 IV
  const iv = crypto.getRandomValues(new Uint8Array(12));
  
  // 用传输密钥加密设备主密钥
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    transportKey,
    exportedKey
  );
  
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encryptedBuffer))),
    iv: btoa(String.fromCharCode(...iv))
  };
};

/**
 * 用传输密钥解密设备主密钥
 * @param {{ciphertext: string, iv: string}} encryptedData - 加密的设备主密钥
 * @param {CryptoKey} transportKey - 传输密钥
 * @returns {Promise<CryptoKey>} - 设备主密钥
 */
export const decryptDeviceKey = async (encryptedData, transportKey) => {
  const ciphertextBuffer = new Uint8Array(
    atob(encryptedData.ciphertext).split('').map(c => c.charCodeAt(0))
  );
  const ivBuffer = new Uint8Array(
    atob(encryptedData.iv).split('').map(c => c.charCodeAt(0))
  );
  
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuffer },
    transportKey,
    ciphertextBuffer
  );
  
  return await crypto.subtle.importKey(
    'raw',
    decryptedBuffer,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
};

/**
 * 获取或生成设备主密钥
 * 完整的恢复流程：
 * 1. 从 sessionKey 派生传输密钥
 * 2. 尝试从 localStorage 解密已存储的设备主密钥
 * 3. 如果不存在，生成新的设备主密钥并加密存储
 * 4. 返回设备主密钥
 * @param {string} sessionKey - JWT 字符串
 * @returns {Promise<CryptoKey>} - 设备主密钥
 */
export const getDeviceKey = async (sessionKey) => {
  console.log('[deviceKeyManager] getDeviceKey called');
  
  // 从 sessionKey 派生传输密钥
  const transportKey = await deriveTransportKey(sessionKey);
  
  // 从 localStorage 读取加密的设备主密钥
  const encryptedDeviceKeyStr = localStorage.getItem('deviceKeyEncrypted');
  
  if (encryptedDeviceKeyStr) {
    try {
      const encryptedDeviceKey = JSON.parse(encryptedDeviceKeyStr);
      const deviceKey = await decryptDeviceKey(encryptedDeviceKey, transportKey);
      console.log('[deviceKeyManager] 设备主密钥恢复成功');
      return deviceKey;
    } catch (err) {
      console.log('[deviceKeyManager] 设备主密钥解密失败，将生成新的:', err.message);
    }
  }
  
  // 生成新的设备主密钥
  const newDeviceKey = await generateDeviceKey();
  console.log('[deviceKeyManager] 生成新的设备主密钥');
  
  // 用传输密钥加密新设备主密钥
  const encryptedNewDeviceKey = await encryptDeviceKey(newDeviceKey, transportKey);
  localStorage.setItem('deviceKeyEncrypted', JSON.stringify(encryptedNewDeviceKey));
  console.log('[deviceKeyManager] 新的设备主密钥已加密存储');
  
  return newDeviceKey;
};