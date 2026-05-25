const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const logger = require('./logger');
const crypto = require('crypto');

dotenv.config();

/**
 * 生成JWT令牌
 * @param {Object} user - 用户信息
 * @returns {string} - JWT令牌
 */
exports.generateToken = (user) => {
  if (!user.id || !user.username) {
    throw new Error('JWT payload missing required fields: id and username');
  }
  const jti = crypto.randomUUID();
  const payload = {
    id: user.id,
    username: user.username,
    jti
  };

  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    issuer: 'finzktrust'
  });
};

/**
 * 生成刷新令牌
 * @param {Object} user - 用户信息
 * @returns {string} - 刷新令牌
 */
exports.generateRefreshToken = (user) => {
  if (!user.id || !user.username) {
    throw new Error('JWT payload missing required fields: id and username');
  }
  const jti = crypto.randomUUID();
  const payload = {
    id: user.id,
    username: user.username,
    type: 'refresh',
    jti
  };

  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    issuer: 'finzktrust'
  });
};

/**
 * 验证JWT令牌
 * @param {string} token - JWT令牌
 * @returns {Object|null} - 解码后的用户信息，失败返回null
 */
exports.verifyToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET, { issuer: 'finzktrust' });
  } catch (error) {
    logger.error('Token verification failed:', { error: error.message });
    return null;
  }
};

/**
 * 验证刷新令牌
 * @param {string} token - 刷新令牌
 * @returns {Object|null} - 解码后的用户信息，失败返回null
 */
exports.verifyRefreshToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_REFRESH_SECRET, { issuer: 'finzktrust' });
  } catch (error) {
    logger.error('Refresh token verification failed:', { error: error.message });
    return null;
  }
};