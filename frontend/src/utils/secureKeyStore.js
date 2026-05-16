/**
 * 安全密钥存储模块
 * 使用AES-GCM对SM2私钥进行加密存储
 */

/**
 * 从密码派生AES-GCM密钥
 * @param {string} password - 用户密码
 * @param {string} salt - 盐值（Base64字符串）
 * @returns {Promise<CryptoKey>} - 派生的AES密钥
 */
export const deriveKey = async (password, salt) => {
  console.log('[secureKeyStore] deriveKey called');
  const saltBuffer = new Uint8Array(atob(salt).split('').map(c => c.charCodeAt(0)));

  const passwordBuffer = new TextEncoder().encode(password);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  console.log('[secureKeyStore] Starting PBKDF2 derivation in main thread...');
  const startTime = Date.now();
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    {
      name: 'AES-GCM',
      length: 256
    },
    false,
    ['encrypt', 'decrypt']
  );
  console.log('[secureKeyStore] PBKDF2 derivation completed in', Date.now() - startTime, 'ms');

  return aesKey;
};

/**
 * 生成随机盐值
 * @returns {string} - 16字节盐值的Base64字符串
 */
export const generateSalt = () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...salt));
};

/**
 * 加密SM2私钥
 * @param {string} privateKeyString - SM2私钥字符串
 * @param {CryptoKey} aesKey - AES-GCM密钥
 * @returns {Promise<Object>} - 加密结果 {ciphertext, iv}
 */
export const encryptPrivateKey = async (privateKeyString, aesKey) => {
  console.log('[secureKeyStore] encryptPrivateKey called');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const privateKeyBuffer = new TextEncoder().encode(privateKeyString);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    aesKey,
    privateKeyBuffer
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv))
  };
};

/**
 * 解密SM2私钥
 * @param {Object} encryptedData - 加密数据 {ciphertext, iv}
 * @param {CryptoKey} aesKey - AES-GCM密钥
 * @returns {Promise<string>} - 解密后的私钥字符串
 */
export const decryptPrivateKey = async (encryptedData, aesKey) => {
  try {
    const ciphertextBuffer = new Uint8Array(atob(encryptedData.ciphertext).split('').map(c => c.charCodeAt(0)));
    const ivBuffer = new Uint8Array(atob(encryptedData.iv).split('').map(c => c.charCodeAt(0)));

    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: ivBuffer
      },
      aesKey,
      ciphertextBuffer
    );

    return new TextDecoder().decode(decryptedBuffer);
  } catch (error) {
    throw new Error('无法解密私钥，请检查密码是否正确');
  }
};