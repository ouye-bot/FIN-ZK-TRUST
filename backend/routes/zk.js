const express = require('express');
const router = express.Router();
const { runTask, getStats } = require('../services/zkProcessPool');
const zkQueue = require('../services/zkQueue');
const path = require('path');
const cryptoNode = require('crypto');
const fs = require('fs');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const proofDao = require('../dao/proofDao');
const { execute } = require('../config/database');
const logger = require('../utils/logger');
const { verifyProof } = require('../services/zkService');

// 查询用户是否有逾期借款
async function checkUserHasOverdue(userId) {
  const rows = await execute(
    "SELECT COUNT(*) AS cnt FROM transactions WHERE user_id = ? AND type = 'loan' AND status = 'overdue'",
    [userId]
  );
  return rows[0].cnt > 0;
}

// 获取电路文件路径
const wasmPath = path.join(__dirname, '../../circuits/build/credit.wasm');
const zkeyPath = path.join(__dirname, '../../circuits/build/credit_final.zkey');

// POST /zk/generate-proof
router.post('/generate-proof', async (req, res) => {
  const { creditScore, threshold, userId } = req.body;
  if (typeof creditScore !== 'number' || typeof threshold !== 'number') {
    return res.status(400).json({ success: false, message: 'Invalid input' });
  }
  try {
    if (!fs.existsSync(wasmPath)) {
      return res.status(500).json({ success: false, message: '电路文件未找到: credit.wasm' });
    }

    if (!fs.existsSync(zkeyPath)) {
      return res.status(500).json({ success: false, message: '证明密钥文件未找到: credit_final.zkey' });
    }

    // 查询用户逾期状态
    let hasNoOverdue = 1;
    if (userId) {
      const hasOverdue = await checkUserHasOverdue(parseInt(userId));
      hasNoOverdue = hasOverdue ? 0 : 1;
      logger.info('ZKP生成-用户逾期状态', { userId, hasNoOverdue });
    }

    const taskId = await zkQueue.addTask({ creditScore, threshold, hasNoOverdue });

    const workerTaskId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

    runTask({
      id: workerTaskId,
      type: 'generate',
      args: [creditScore, threshold, hasNoOverdue]
    }).then(async result => {
      await zkQueue.updateTaskStatus(taskId, 'completed', result, null);
    }).catch(async err => {
      await zkQueue.updateTaskStatus(taskId, 'failed', null, err.message);
    });

    res.status(202).json({
      success: true,
      taskId,
      status: 'queued',
      message: '证明生成任务已提交，请轮询任务状态'
    });
  } catch (e) {
    if (e.message.includes('queue is full')) {
      return res.status(503).json({ success: false, message: e.message });
    }
    res.status(500).json({ success: false, message: e.message });
  }
});

// GET /zk/task/:taskId - 查询任务状态
router.get('/task/:taskId', async (req, res) => {
  const status = await zkQueue.getTaskStatus(req.params.taskId);
  if (!status) {
    return res.status(404).json({ success: false, message: '任务不存在或已过期' });
  }
  res.json({ success: true, ...status });
});

// Verify credit proof (真正验证 ZKP，不再硬编码)
router.post('/verify-proof', async (req, res) => {
  try {
    const { userId, verificationCode } = req.body;

    if (!userId || !verificationCode) {
      return res.status(400).json({ success: false, message: '缺少必要参数' });
    }

    // 从数据库查找对应的信用证明（时序安全比较验证口令）
    const proofs = await proofDao.findByUserId(parseInt(userId));
    const matchingProof = proofs.find(p => {
      if (!p.verification_code || !verificationCode) return false;
      const a = Buffer.from(p.verification_code, 'utf8');
      const b = Buffer.from(verificationCode, 'utf8');
      return a.length === b.length && cryptoNode.timingSafeEqual(a, b);
    });

    if (!matchingProof) {
      return res.json({ success: false, message: '验证口令无效' });
    }

    if (new Date(matchingProof.expires_at) <= new Date()) {
      return res.json({ success: false, message: '信用证明已过期' });
    }

    // 如果存储了 ZKP proof，进行真正的零知识证明验证
    let isValid = false;
    if (matchingProof.zk_proof && matchingProof.public_signals) {
      try {
        const proof = JSON.parse(matchingProof.zk_proof);
        const publicSignals = JSON.parse(matchingProof.public_signals);
        isValid = await verifyProof(proof, publicSignals);
      } catch (verifyErr) {
        logger.error('ZKP 链上验证异常', { error: verifyErr.message, userId });
        isValid = false;
      }
    } else {
      // ZKP数据缺失，验证失败
      logger.error('信用证明无 ZKP 数据，验证失败', { userId, proofId: matchingProof.proof_id });
      isValid = false;
    }

    if (!isValid) {
      return res.json({ success: false, message: '零知识证明验证失败' });
    }

    // 记录验证费用交易（使用数据库而非进程内存）
    await transactionDao.create({
      user_id: parseInt(userId),
      type: 'proof_fee',
      amount: 10,
      status: 'completed'
    });

    res.json({ success: true, message: '证明验证成功' });
  } catch (error) {
    logger.error('证明验证失败', { error: error.message });
    res.status(500).json({ success: false, message: '证明验证失败' });
  }
});

// 所有废弃端点已移除（/lend, /repay, /collect-loan, /all-loans, /all-lends）
// 请使用 /api/v1/loan 和 /api/v1/credit 下的正式端点

module.exports = router;
