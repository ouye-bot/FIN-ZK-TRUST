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
      return res.status(403).json({ success: false, message: '金融操作需要用户身份标识' });
    }
    if (!signature) {
      return res.status(403).json({ success: false, message: '金融操作需要SM2签名' });
    }

    const user = await userDao.findById(parseInt(userId));
    if (!user) {
      return res.status(401).json({ success: false, message: '用户不存在' });
    }
    if (!user.sm2_public_key) {
      return res.status(403).json({ success: false, message: '用户未设置SM2公钥，无法执行金融操作' });
    }

    const timestamp = req.headers['x-request-timestamp'] || '';
    const nonce = req.headers['x-request-nonce'] || '';
    const signatureData = timestamp + nonce + canonicalStringify(req.body);

    const isValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'SM2签名验证失败' });
    }

    req.sm2Verified = true;
    next();
  } catch (error) {
    logger.error('SM2签名验证失败', { error: error.message });
    return res.status(500).json({ success: false, message: '签名验证过程中出现错误' });
  }
};

module.exports = sm2SignatureMiddleware;