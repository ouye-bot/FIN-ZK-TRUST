const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const mfaService = require('../services/mfaService');
const userDao = require('../dao/userDao');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @swagger
 * /mfa/setup:
 *   get:
 *     summary: 获取 MFA 绑定信息
 *     tags: [MFA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: 成功，返回二维码 URI 和秘密
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 otpauthUrl:
 *                   type: string
 *                 secret:
 *                   type: string
 *       400:
 *         description: MFA 已启用或未登录
 * /mfa/verify:
 *   post:
 *     summary: 验证 MFA 令牌并登录
 *     tags: [MFA]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 example: '123456'
 *     responses:
 *       200:
 *         description: 验证成功，返回 JWT 和 sessionKey
 *       400:
 *         description: 验证失败
 * /mfa/status:
 *   get:
 *     summary: 获取 MFA 状态
 *     tags: [MFA]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: MFA 状态
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 enabled:
 *                   type: boolean
 */

router.post('/reset', async (req, res) => {
  try {
    // 检查认证
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: '未认证' });
    }

    const userId = req.user.id;

    const user = await userDao.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    await userDao.updateTotpSecret(userId, null);
    await userDao.updateBackupCodes(userId, null);
    await userDao.update(user.id, { totp_enabled: false });

    logger.info('MFA reset completed for user', { userId });

    res.status(200).json({
      success: true,
      message: 'MFA 已重置，请重新登录设置新的 MFA'
    });
  } catch (error) {
    console.error('MFA reset error:', error);
    res.status(500).json({ success: false, message: 'MFA 重置失败' });
  }
});

router.post('/setup', async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await userDao.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (user.totp_enabled) {
      return res.status(400).json({ success: false, message: 'MFA 已启用' });
    }

    const { secret, otpauthUrl } = mfaService.generateSecret(user.username);
    const encryptedSecret = mfaService.encryptSecret(secret);
    await userDao.updateTotpSecret(userId, encryptedSecret);

    res.status(200).json({ success: true, otpauthUrl, secret });
  } catch (error) {
    console.error('MFA setup error:', error);
    res.status(500).json({ success: false, message: 'MFA 设置失败' });
  }
});

router.get('/setup', async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await userDao.findById(userId);

    if (!user) {
      return res.status(404).json({ success: false, message: '用户不存在' });
    }

    if (user.totp_enabled) {
      return res.status(400).json({ success: false, message: 'MFA 已启用' });
    }

    let secret, otpauthUrl;
    if (user.totp_secret) {
      secret = mfaService.decryptSecret(user.totp_secret);
      otpauthUrl = `otpauth://totp/FinZkTrust:${user.username}?secret=${secret}&issuer=FinZkTrust`;
    } else {
      const generated = mfaService.generateSecret(user.username);
      secret = generated.secret;
      otpauthUrl = generated.otpauthUrl;
      const encryptedSecret = mfaService.encryptSecret(secret);
      await userDao.updateTotpSecret(userId, encryptedSecret);
    }

    res.status(200).json({ success: true, otpauthUrl, secret });
  } catch (error) {
    console.error('MFA setup error:', error);
    res.status(500).json({ success: false, message: 'MFA 设置失败' });
  }
});

router.post('/verify-and-enable', async (req, res) => {
  try {
    const { token } = req.body;
    const userId = req.user.id;

    if (!token) {
      return res.status(400).json({ success: false, message: '验证码不能为空' });
    }

    const user = await userDao.findById(userId);
    if (!user || !user.totp_secret) {
      return res.status(400).json({ success: false, message: '请先设置 MFA' });
    }

    const decryptedSecret = mfaService.decryptSecret(user.totp_secret);
    const isValid = await mfaService.verifyToken(token, decryptedSecret);

    if (!isValid) {
      return res.status(400).json({ success: false, message: '验证码错误' });
    }

    const backupCodes = mfaService.generateBackupCodes(10);
    const hashedCodes = mfaService.hashBackupCodes(backupCodes);
    await userDao.enableTotp(userId, JSON.stringify(hashedCodes));

    // 签发 sessionKey 用于设备主密钥恢复
    const sessionKey = jwt.sign(
      { userId: user.id, purpose: 'key-session' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({ success: true, backupCodes, sessionKey });
  } catch (error) {
    console.error('MFA verify and enable error:', error);
    res.status(500).json({ success: false, message: 'MFA 启用失败' });
  }
});

router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;
    const authHeader = req.headers.authorization;

    if (!token) {
      return res.status(400).json({ success: false, message: '验证码不能为空' });
    }

    let userId;
    let mfaPending = false;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const tempToken = authHeader.split(' ')[1];
      try {
        const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);
        if (decoded.mfaPending) {
          userId = decoded.userId;
          mfaPending = true;
        }
      } catch (e) {
        return res.status(401).json({ success: false, message: '临时令牌无效' });
      }
    }

    if (!userId) {
      return res.status(401).json({ success: false, message: '需要临时令牌' });
    }

    const user = await userDao.findById(userId);
    if (!user) {
      return res.status(400).json({ success: false, message: '用户不存在' });
    }
    
    if (!user.totp_secret) {
      return res.status(400).json({ success: false, message: 'MFA 未设置，请重新登录并设置 MFA' });
    }

    let decryptedSecret;
    try {
      decryptedSecret = mfaService.decryptSecret(user.totp_secret);
    } catch (decryptError) {
      logger.error('MFA secret decryption error, suggesting reset', { error: decryptError.message, userId });
      return res.status(400).json({ 
        success: false, 
        message: 'MFA 密钥损坏，请联系管理员或重新登录并重置 MFA',
        suggestReset: true 
      });
    }

    const isValid = await mfaService.verifyToken(token, decryptedSecret);

    if (isValid) {
      const fullUser = await userDao.findById(userId);
      const userData = {
        id: fullUser.id,
        username: fullUser.username,
        role: fullUser.role,
        balance: Number(fullUser.balance),
        credit_score: Number(fullUser.credit_score)
      };

      const newToken = jwt.sign(
        { ...userData, jti: crypto.randomUUID() },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      const sessionKey = jwt.sign(
        { userId: user.id, purpose: 'key-session' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      return res.status(200).json({ success: true, token: newToken, user: userData, sessionKey: sessionKey, method: 'totp' });
    }

    if (user.backup_codes_hashed) {
      const hashedCodes = JSON.parse(user.backup_codes_hashed);
      const codeIndex = mfaService.verifyBackupCode(token, hashedCodes);

      if (codeIndex >= 0) {
        await userDao.updateBackupCodes(userId, hashedCodes);

        const fullUser = await userDao.findById(userId);
        const userData = {
          id: fullUser.id,
          username: fullUser.username,
          role: fullUser.role,
          balance: Number(fullUser.balance),
          credit_score: Number(fullUser.credit_score)
        };

        const newToken = jwt.sign(
        { ...userData, jti: crypto.randomUUID() },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

        const sessionKey = jwt.sign(
          { userId: user.id, purpose: 'key-session' },
          process.env.JWT_SECRET,
          { expiresIn: '1h' }
        );

        return res.status(200).json({ success: true, token: newToken, user: userData, sessionKey: sessionKey, method: 'backup_code' });
      }
    }

    res.status(400).json({ success: false, message: '验证码无效' });
  } catch (error) {
    console.error('MFA verify error:', error);
    res.status(500).json({ 
      success: false, 
      message: '验证失败，请重试或重新登录',
      suggestReset: true 
    });
  }
});

router.get('/status', async (req, res) => {
  try {
    const userId = req.user.id;
    const totpData = await userDao.getTotpData(userId);

    res.status(200).json({ success: true, enabled: totpData ? totpData.totpEnabled : false });
  } catch (error) {
    console.error('MFA status error:', error);
    res.status(500).json({ success: false, message: '获取 MFA 状态失败' });
  }
});

module.exports = router;