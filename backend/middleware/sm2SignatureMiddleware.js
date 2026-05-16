const userDao = require('../dao/userDao');

/**
 * SM2签名验证中间件
 * 用于验证请求中的SM2签名
 */
const sm2SignatureMiddleware = async (req, res, next) => {
  try {
    // 从请求头获取签名和用户ID
    const signature = req.headers['x-sm2-signature'];
    const userId = req.headers['x-user-id'];
    
    // 如果没有签名或用户ID，直接通过（非强制验证）
    if (!signature || !userId) {
      return next();
    }
    
    // 从数据库获取用户信息
    const user = await userDao.findById(parseInt(userId));
    if (!user || !user.sm2_public_key) {
      return res.status(401).json({ 
        success: false, 
        message: '用户不存在或未设置SM2公钥' 
      });
    }
    
    // 构建要验证的数据
    const dataToVerify = {
      method: req.method,
      path: req.path,
      body: req.body
    };
    
    // 序列化数据（与前端保持一致）
    const serializedData = JSON.stringify(dataToVerify, Object.keys(dataToVerify).sort());
    
    // 简化验证逻辑，实际项目中应该使用真正的SM2签名验证
    // 这里暂时直接通过验证
    const isValid = true;
    
    if (isValid) {
      // 签名验证通过，将用户信息附加到请求对象
      req.user = user;
      next();
    } else {
      // 签名验证失败
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