const userDao = require('../dao/userDao');
const { verifySM2Signature, canonicalStringify } = require('../utils/cryptoUtils');
const { getSecurityLevel } = require('../config/endpointRegistry');
const logger = require('../utils/logger');

const sm2SignatureMiddleware = async (req, res, next) => {
  try {
    const level = getSecurityLevel(req.method, req.path);

    if (level !== 'financial') {
      return next();
    }

    const userId = req.headers['x-user-id'];
    const signature = req.headers['x-sm2-signature'];

    if (!userId) {
      return res.status(403).json({ success: false, code: 'SM2_MISSING_USER_ID', message: '金融操作需要用户身份标识' });
    }
    if (!signature) {
      return res.status(403).json({ success: false, code: 'SM2_MISSING_SIGNATURE', message: '金融操作需要SM2签名' });
    }
    if (signature.length > 256) {
      return res.status(400).json({ success: false, code: 'SM2_INVALID_SIGNATURE', message: 'SM2签名格式无效' });
    }

    if (!/^\d+$/.test(userId)) {
      return res.status(400).json({ success: false, code: 'SM2_INVALID_USER_ID', message: '用户标识格式无效' });
    }

    const user = await userDao.findById(parseInt(userId, 10));
    if (!user) {
      return res.status(401).json({ success: false, code: 'SM2_USER_NOT_FOUND', message: '用户不存在' });
    }
    if (!user.sm2_public_key) {
      return res.status(403).json({ success: false, code: 'SM2_NO_PUBLIC_KEY', message: '用户未设置SM2公钥，无法执行金融操作' });
    }

    const timestamp = req.headers['x-request-timestamp'] || '';
    const nonce = req.headers['x-request-nonce'] || '';
    const signatureData = timestamp + nonce + canonicalStringify(req.body);

    const isValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);
    if (!isValid) {
      return res.status(401).json({ success: false, code: 'SM2_VERIFICATION_FAILED', message: 'SM2签名验证失败' });
    }

    if (req.user && parseInt(userId, 10) !== req.user.id) {
      return res.status(403).json({ success: false, code: 'SM2_IDENTITY_MISMATCH', message: '用户身份不一致' });
    }

    req.sm2Verified = true;
    next();
  } catch (error) {
    logger.error('SM2签名验证失败', { error: error.message });
    return res.status(500).json({ success: false, code: 'SM2_INTERNAL_ERROR', message: '签名验证过程中出现错误' });
  }
};

module.exports = sm2SignatureMiddleware;