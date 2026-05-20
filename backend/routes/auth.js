const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const userDao = require('../dao/userDao');
const { execute } = require('../config/database');
const { generateToken, generateRefreshToken, verifyRefreshToken } = require('../utils/authUtils');
const { generateSaltedSM3Hash, verifySM3Hash, generatePBKDF2Hash, verifyPBKDF2Hash, isPBKDF2Hash } = require('../utils/cryptoUtils');
const logger = require('../utils/logger');
const { logCryptoOperation } = require('../utils/cryptoLogger');

/**
 * @swagger
 * /auth/register:
 *   post:
 *     summary: 用户注册
 *     tags: [认证]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *               - sm2PublicKey
 *             properties:
 *               username:
 *                 type: string
 *                 example: 'newuser'
 *               password:
 *                 type: string
 *                 example: 'Password123'
 *               sm2PublicKey:
 *                 type: string
 *                 example: '041a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b'
 *     responses:
 *       200:
 *         description: 注册成功
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: '注册成功，请登录'
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: integer
 *                     username:
 *                       type: string
 *                     creditScore:
 *                       type: integer
 *                     sm2PublicKey:
 *                       type: string
 *       400:
 *         description: 参数错误或用户已存在
 */

// 注册API
router.post('/register', async (req, res) => {
  try {
    const { username, password, sm2PublicKey } = req.body;
    
    // 记录密码操作开始
    await logCryptoOperation('密码操作', username, '发起', '用户注册', { hasPassword: !!password, hasPublicKey: !!sm2PublicKey });
    
    // 验证输入
    if (!username || !password || !sm2PublicKey) {
      await logCryptoOperation('密码操作', username, '失败', '缺少必要参数');
      logger.warning('注册失败：缺少必要参数', { username, hasPassword: !!password, hasPublicKey: !!sm2PublicKey });
      return res.status(400).json({
        success: false,
        message: '用户名、密码和SM2公钥不能为空'
      });
    }

    // 验证密码强度
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z]).{8,}$/;
    if (!passwordRegex.test(password)) {
      await logCryptoOperation('密码操作', username, '失败', '密码强度不足');
      logger.warning('注册失败：密码强度不足', { username });
      return res.status(400).json({
        success: false,
        message: '密码强度不足，至少8位，包含大小写字母'
      });
    }

    // 验证SM2公钥格式
    const sm2PublicKeyRegex = /^[0-9a-fA-F]{130}$/;
    if (!sm2PublicKeyRegex.test(sm2PublicKey)) {
      await logCryptoOperation('密码操作', username, '失败', 'SM2公钥格式无效');
      logger.warning('注册失败：SM2公钥格式无效', { username });
      return res.status(400).json({
        success: false,
        message: 'SM2公钥格式无效，应为130位十六进制字符串'
      });
    }

    // 检查用户是否已存在
    const existingUser = await userDao.findByUsername(username);
    if (existingUser) {
      await logCryptoOperation('密码操作', username, '失败', '用户名已存在');
      logger.warning('注册失败：用户名已存在', { username });
      return res.status(400).json({
        success: false,
        message: '用户名已存在'
      });
    }

    // 使用 PBKDF2-SM3 生成密码哈希（国密合规慢速密钥派生）
    const pbkdf2Hash = generatePBKDF2Hash(password);

    // 创建新用户（salt 字段留空，哈希信息已包含在 password_hash 中）
    const newUser = await userDao.create({
      username: username,
      password_hash: pbkdf2Hash,
      salt: '',
      sm2_public_key: sm2PublicKey
    });

    await logCryptoOperation('密码操作', username, '成功', '注册成功');
    logger.info('用户注册成功', { username, userId: newUser.id });
    res.json({
      success: true,
      message: '注册成功，请登录',
      user: {
        id: newUser.id,
        username: newUser.username,
        creditScore: newUser.credit_score || 0,
        sm2PublicKey: newUser.sm2_public_key || ''
      }
    });
  } catch (error) {
    await logCryptoOperation('密码操作', req.body.username || 'unknown', '失败', `注册异常: ${error.message}`);
    logger.error('注册失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '注册失败'
    });
  }
});

/**
 * @swagger
 * /auth/login:
 *   post:
 *     summary: 用户登录
 *     tags: [认证]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *                 example: 'cai'
 *               password:
 *                 type: string
 *                 example: 'Password123'
 *     responses:
 *       200:
 *         description: 登录成功或需要 MFA
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: true
 *                     token:
 *                       type: string
 *                     refreshToken:
 *                       type: string
 *                     sessionKey:
 *                       type: string
 *                     user:
 *                       type: object
 *                 - type: object
 *                   properties:
 *                     success:
 *                       type: boolean
 *                       example: true
 *                     requireMfa:
 *                       type: boolean
 *                       example: true
 *                     tempToken:
 *                       type: string
 *       401:
 *         description: 认证失败
 */

// 登录API
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    await logCryptoOperation('密码验证', username, '发起', '用户登录验证');
    logger.info('登录尝试', { username });

    // 查找用户
    const user = await userDao.findByUsername(username);

    if (!user) {
      await logCryptoOperation('密码验证', username, '失败', '用户不存在');
      logger.warning('登录失败：用户不存在', { username });
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 验证密码（支持 PBKDF2-SM3 新格式 + SM3 旧格式透明升级）
    let isPasswordValid = false;
    let needUpgrade = false;

    if (isPBKDF2Hash(user.password_hash)) {
      // 新用户：PBKDF2-SM3 验证
      isPasswordValid = verifyPBKDF2Hash(password, user.password_hash);
    } else if (user.password_hash && user.salt) {
      // 旧用户（加盐 SM3）：验证后透明升级为 PBKDF2
      isPasswordValid = verifySM3Hash(password, user.password_hash, user.salt);
      if (isPasswordValid) needUpgrade = true;
    } else if (user.password_hash) {
      // 极旧用户（无盐 SM3）：验证后透明升级
      const { hash: noSaltHash } = generateSaltedSM3Hash(password, '');
      isPasswordValid = user.password_hash === noSaltHash;
      if (isPasswordValid) needUpgrade = true;
    }

    // 透明升级：旧 SM3 哈希 → PBKDF2-SM3
    if (isPasswordValid && needUpgrade) {
      const pbkdf2Hash = generatePBKDF2Hash(password);
      await execute('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', [pbkdf2Hash, '', user.id]);
      logger.info('用户密码哈希已透明升级为 PBKDF2-SM3', { username });
    }

    if (!isPasswordValid) {
      await logCryptoOperation('密码验证', username, '失败', '密码错误');
      logger.warning('登录失败：密码错误', { username });
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      });
    }

    // 检查 MFA 是否启用
    const totpData = await userDao.getTotpData(user.id);

    if (totpData && totpData.totpEnabled) {
      // MFA 已启用，签发临时令牌
      const tempToken = jwt.sign(
        { userId: user.id, mfaPending: true },
        process.env.JWT_SECRET,
        { expiresIn: '5m' }
      );

      await logCryptoOperation('密码验证', username, '成功', 'MFA 待验证');
      logger.info('用户登录成功（需 MFA 验证）', { username, userId: user.id });
      return res.status(200).json({
        success: true,
        requireMfa: true,
        tempToken
      });
    }

    // MFA 未启用，生成完整的 JWT
    const token = generateToken(user);
    const refreshToken = generateRefreshToken(user);

    // 签发 sessionKey 用于设备主密钥恢复
    const sessionKey = jwt.sign(
      { userId: user.id, purpose: 'key-session' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    await logCryptoOperation('密码验证', username, '成功', '登录成功');
    logger.info('用户登录成功', { username, userId: user.id });
    res.json({
      success: true,
      token,
      refreshToken,
      sessionKey,
      user: {
        id: user.id,
        username: user.username,
        creditScore: user.credit_score || 0
      }
    });
  } catch (error) {
    await logCryptoOperation('密码验证', req.body.username || 'unknown', '失败', `登录异常: ${error.message}`);
    logger.error('登录失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '登录失败'
    });
  }
});

// 刷新令牌API
router.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      logger.warning('刷新令牌失败：缺少刷新令牌', {});
      return res.status(400).json({
        success: false,
        message: '缺少刷新令牌'
      });
    }

    // 验证刷新令牌
    const decoded = verifyRefreshToken(refreshToken);
    if (!decoded || decoded.type !== 'refresh') {
      logger.warning('刷新令牌失败：无效的刷新令牌', {});
      return res.status(401).json({
        success: false,
        message: '无效的刷新令牌'
      });
    }

    // 查找用户
    const user = await userDao.findById(decoded.id);

    if (!user) {
      logger.warning('刷新令牌失败：用户不存在', { userId: decoded.id });
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 生成新的访问令牌
    const newToken = generateToken(user);
    const newRefreshToken = generateRefreshToken(user);

    logger.info('刷新令牌成功', { userId: user.id, username: user.username });
    res.json({
      success: true,
      token: newToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    logger.error('刷新令牌失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '刷新令牌失败'
    });
  }
});

module.exports = router;