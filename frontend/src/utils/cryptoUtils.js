import { sm2, sm3 } from 'sm-crypto';

/**
 * 生成SM2密钥对
 * @returns {Object} - 包含公钥和私钥的对象
 */
export const generateSM2KeyPair = () => {
  const keyPair = sm2.generateKeyPairHex();
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey
  };
};

/**
 * 使用SM2私钥签名
 * @param {string} message - 要签名的消息
 * @param {string} privateKey - SM2私钥
 * @returns {string} - 签名
 */
export const signWithSM2 = (message, privateKey) => {
  return sm2.doSignature(message, privateKey, { der: false });
};

/**
 * 使用SM2公钥验证签名
 * @param {string} message - 原始消息
 * @param {string} signature - 签名
 * @param {string} publicKey - SM2公钥
 * @returns {boolean} - 验证结果
 */
export const verifySM2Signature = (message, signature, publicKey) => {
  return sm2.doVerifySignature(message, signature, publicKey, { der: false });
};

/**
 * 生成SM3哈希
 * @param {string} data - 要哈希的数据
 * @returns {string} - 哈希值
 */
export const generateSM3Hash = (data) => {
  return sm3(data);
};
