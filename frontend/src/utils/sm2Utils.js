import { sm2 } from 'sm-crypto';
import { encryptPrivateKey, decryptPrivateKey } from './secureKeyStore';

/**
 * 生成SM2密钥对
 * @returns {Object} 包含公钥和私钥的对象
 */
export const generateSM2KeyPair = () => {
  try {
    const keyPair = sm2.generateKeyPairHex();
    return {
      publicKey: keyPair.publicKey,
      privateKey: keyPair.privateKey
    };
  } catch (error) {
    console.error('生成SM2密钥对失败:', error);
    throw error;
  }
};

/**
 * 使用SM2私钥签名
 * @param {string} message 要签名的消息
 * @param {string} privateKey SM2私钥
 * @returns {string} 签名
 */
export const signWithSM2 = (message, privateKey) => {
  try {
    return sm2.doSignature(message, privateKey, { der: false });
  } catch (error) {
    console.error('SM2签名失败:', error);
    throw error;
  }
};

/**
 * 验证SM2签名
 * @param {string} message 原始消息
 * @param {string} signature 签名
 * @param {string} publicKey SM2公钥
 * @returns {boolean} 验证结果
 */
export const verifySM2Signature = (message, signature, publicKey) => {
  try {
    return sm2.doVerifySignature(message, signature, publicKey, { der: false });
  } catch (error) {
    console.error('SM2签名验证失败:', error);
    return false;
  }
};

/**
 * 保存SM2密钥对到本地存储（私钥加密，使用设备主密钥）
 * @param {Object} keyPair 包含公钥和私钥的对象
 * @param {CryptoKey} deviceKey 设备主密钥
 */
export const saveSM2KeyPair = async (keyPair, deviceKey) => {
  try {
    console.time('saveSM2KeyPair');

    // 保存公钥（明文）
    localStorage.setItem('sm2_public_key', keyPair.publicKey);

    // 使用设备主密钥加密私钥
    const encryptedData = await encryptPrivateKey(keyPair.privateKey, deviceKey);
    localStorage.setItem('sm2_private_key_encrypted', encryptedData.ciphertext);
    localStorage.setItem('sm2_private_key_iv', encryptedData.iv);

    // 清除旧的明文存储和旧盐值
    localStorage.removeItem('sm2KeyPair');
    localStorage.removeItem('sm2_salt');

    console.timeEnd('saveSM2KeyPair');
  } catch (error) {
    console.error('保存SM2密钥对失败:', error);
    throw error;
  }
};

/**
 * 从本地存储获取SM2密钥对（私钥解密）
 * @param {CryptoKey} deviceKey 设备主密钥
 * @returns {Promise<Object|null>} 包含公钥和私钥的对象，或null（解密失败时返回null）
 */
export const getSM2KeyPair = async (deviceKey) => {
  try {
    // 获取公钥
    let publicKey = localStorage.getItem('sm2_public_key');

    // 获取加密的私钥和IV
    let encryptedCiphertext = localStorage.getItem('sm2_private_key_encrypted');
    let iv = localStorage.getItem('sm2_private_key_iv');

    // 如果密钥对不存在，返回 null
    if (!publicKey || !encryptedCiphertext || !iv) {
      console.log('SM2密钥对不存在');
      return null;
    }

    // 使用设备主密钥解密私钥
    const privateKey = await decryptPrivateKey(
      { ciphertext: encryptedCiphertext, iv: iv },
      deviceKey
    );

    return {
      publicKey,
      privateKey
    };
  } catch (error) {
    console.log('设备主密钥解密私钥失败，可能需要迁移:', error.message);
    return null;
  }
};

/**
 * 从本地存储获取SM2密钥对（使用已派生的AES密钥）
 * @param {CryptoKey} aesKey 已派生的AES密钥
 * @returns {Promise<Object|null>} 包含公钥和私钥的对象，或null
 */
export const getSM2KeyPairWithAesKey = async (aesKey) => {
  try {
    // 获取公钥
    const publicKey = localStorage.getItem('sm2_public_key');
    if (!publicKey) {
      return null;
    }

    // 获取加密的私钥和IV
    const encryptedCiphertext = localStorage.getItem('sm2_private_key_encrypted');
    const iv = localStorage.getItem('sm2_private_key_iv');

    if (!encryptedCiphertext || !iv) {
      return null;
    }

    // 解密私钥
    const privateKey = await decryptPrivateKey(
      { ciphertext: encryptedCiphertext, iv: iv },
      aesKey
    );

    return {
      publicKey,
      privateKey
    };
  } catch (error) {
    console.error('获取SM2密钥对失败:', error);
    return null;
  }
};

/**
 * 生成签名数据
 * @param {Object} data 要签名的数据
 * @returns {string} 签名数据的字符串表示
 */
export const generateSignatureData = (data) => {
  return JSON.stringify(data);
};

/**
 * 生成严格排序的签名数据
 * @param {Object} data 要签名的数据
 * @param {Array} keyOrder 字段顺序数组
 * @returns {string} 严格排序的签名数据字符串
 */
export const generateSignatureDataStrict = (data, keyOrder) => {
  const parts = [];
  for (const key of keyOrder) {
    if (data.hasOwnProperty(key)) {
      const value = data[key];
      // 字符串加引号，数字不加引号
      if (typeof value === 'string') {
        parts.push(`"${key}":"${value}"`);
      } else {
        parts.push(`"${key}":${value}`);
      }
    }
  }
  return `{${parts.join(',')}}`;
};