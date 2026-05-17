const userDao = require('../dao/userDao');
const { verifySM2Signature } = require('../utils/cryptoUtils');

/**
 * SM2签名验证中间件
 * 用于验证请求中的SM2签名
 */
const sm2SignatureMiddleware = async (req, res, next) => {
  try {
    const signature = req.headers['x-sm2-signature'];
    const userId = req.headers['x-user-id'];

    // 没有签名或用户ID时直接通过（非强制验证）
    if (!signature || !userId) {
      return next();
    }

    const user = await userDao.findById(parseInt(userId));
    if (!user || !user.sm2_public_key) {
      return res.status(401).json({
        success: false,
        message: '用户不存在或未设置SM2公钥'
      });
    }

    // 构建签名原文：与 antiReplayMiddleware 保持一致
    const timestamp = req.headers['x-request-timestamp'] || '';
    const nonce = req.headers['x-request-nonce'] || '';
    let signatureData;
    if (req.method === 'GET') {
      signatureData = timestamp + nonce;
    } else {
      signatureData = timestamp + nonce + JSON.stringify(req.body);
    }

    const isValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);

    if (isValid) {
      req.user = user;
      next();
    } else {
      return res.status(401).json({
        success: false,
        message: '签名验证失败'
      });
    }
  } catch (error) {
    console.error('SM2签名验证失败:', error);
    return res.status(500).json({
      success: false,
      message: '签名验证过程中出现错误'
    });
  }
};

module.exports = sm2SignatureMiddleware;
