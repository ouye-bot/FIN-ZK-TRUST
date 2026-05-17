/**
 * 统一输入校验工具
 * 所有路由使用相同的校验模式，避免重复代码
 */

const SM2_PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{130}$/;
const SM2_PRIVATE_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const SM3_HASH_PATTERN = /^[0-9a-fA-F]{64}$/;

function validateRequired(fields, data) {
  const missing = [];
  for (const field of fields) {
    if (data[field] === undefined || data[field] === null || data[field] === '') {
      missing.push(field);
    }
  }
  if (missing.length > 0) {
    throw new Error(`缺少必填字段: ${missing.join(', ')}`);
  }
}

function validateRange(value, min, max, fieldName) {
  const num = Number(value);
  if (isNaN(num) || num < min || num > max) {
    throw new Error(`${fieldName} 必须在 ${min}-${max} 之间`);
  }
  return num;
}

function validateSM2PublicKey(publicKey) {
  if (!publicKey || typeof publicKey !== 'string') {
    throw new Error('SM2 公钥不能为空');
  }
  if (!SM2_PUBLIC_KEY_PATTERN.test(publicKey)) {
    throw new Error('SM2 公钥格式无效：必须为 130 位十六进制字符串（04 开头）');
  }
}

function validateSM2PrivateKey(privateKey) {
  if (!privateKey || typeof privateKey !== 'string') {
    throw new Error('SM2 私钥不能为空');
  }
  if (!SM2_PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error('SM2 私钥格式无效：必须为 64 位十六进制字符串');
  }
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    throw new Error('密码不能为空');
  }
  if (password.length < 8) {
    throw new Error('密码长度至少 8 位');
  }
  if (!/(?=.*[a-z])(?=.*[A-Z])/.test(password)) {
    throw new Error('密码必须包含大小写字母');
  }
}

module.exports = {
  validateRequired,
  validateRange,
  validateSM2PublicKey,
  validateSM2PrivateKey,
  validatePassword,
  SM2_PUBLIC_KEY_PATTERN,
  SM2_PRIVATE_KEY_PATTERN,
  SM3_HASH_PATTERN
};