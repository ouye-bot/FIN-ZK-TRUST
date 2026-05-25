const express = require('express');
const router = express.Router();
const userDao = require('../dao/userDao');
const blockchainService = require('../services/blockchainService');
const blockchainQueueService = require('../services/blockchainQueueService');
const logger = require('../utils/logger');

// 获取用户信息API
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    logger.info('Getting user info for ID:', { id });

    // 权限校验：用户只能访问自己的数据
    const currentUserId = req.user?.id;
    logger.info('Current user ID:', { currentUserId });

    if (currentUserId && currentUserId.toString() !== id.toString()) {
      logger.info('Permission denied: user tried to access another user', { currentUserId, targetId: id });
      return res.status(403).json({
        success: false,
        message: '无权限访问该资源'
      });
    }

    // 从数据库获取用户数据
    const user = await userDao.findById(parseInt(id));
    logger.info('Found user from database', { user: user ? { id: user.id, username: user.username } : null });

    if (!user) {
      logger.info('User not found in database', { id });
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 用户资产信息
    const userAssets = {
      totalAssets: '0',
      availableBalance: user.balance ? String(user.balance) : '0',
      lockedBalance: '0',
      assetList: []
    };

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        creditScore: user.credit_score || 0,
        balance: user.balance || 0,
        role: user.role || 'user',
        sm2PublicKey: user.sm2_public_key || '',
        created_at: user.created_at,
        assets: userAssets
      }
    });
  } catch (error) {
    logger.error('获取用户信息失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '获取用户信息失败'
    });
  }
});

// 更新用户SM2公钥API
router.put('/:id/update-sm2-key', async (req, res) => {
  try {
    const { id } = req.params;
    const { sm2PublicKey } = req.body;

    if (!sm2PublicKey) {
      return res.status(400).json({
        success: false,
        message: '缺少SM2公钥'
      });
    }

    if (!/^[0-9a-fA-F]{130}$/.test(sm2PublicKey)) {
      return res.status(400).json({
        success: false,
        message: 'SM2公钥格式无效'
      });
    }

    // 获取当前用户
    const user = await userDao.findById(parseInt(id));

    if (!user) {
      return res.status(404).json({
        success: false,
        message: '用户不存在'
      });
    }

    // 由于userDao没有直接更新公钥的方法，我们需要直接执行SQL
    const { execute } = require('../config/database');
    await execute(
      'UPDATE users SET sm2_public_key = ? WHERE id = ?',
      [sm2PublicKey, parseInt(id)]
    );

    // 重新获取更新后的用户
    const updatedUser = await userDao.findById(parseInt(id));

    // 异步将公钥哈希锚定到区块链 - 加入重试队列
    blockchainQueueService.enqueue('registerUserOnChain', {
      userId: parseInt(id), publicKey: sm2PublicKey
    }).catch(err => {
      logger.error('公钥锚定入队失败', { userId: id, error: err.message });
    });

    res.json({
      success: true,
      message: 'SM2公钥更新成功',
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        sm2PublicKey: updatedUser.sm2_public_key
      }
    });
  } catch (error) {
    logger.error('更新SM2公钥失败', { error: error.message });
    res.status(500).json({
      success: false,
      message: '更新SM2公钥失败'
    });
  }
});

module.exports = router;
