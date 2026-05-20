const express = require('express');
const router = express.Router();
const { runTask, getStats } = require('../services/zkProcessPool');
const zkQueue = require('../services/zkQueue');
const path = require('path');
const fs = require('fs');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const proofDao = require('../dao/proofDao');
const { execute } = require('../config/database');
const logger = require('../utils/logger');

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

// System balance
let systemBalance = 10000; // Initial system balance: 10000 yuan

// Get system balance (admin only)
router.get('/system-balance', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }
    res.json({ success: true, balance: systemBalance });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Verify credit proof
router.post('/verify-proof', async (req, res) => {
  try {
    const { userId, verificationCode } = req.body;

    // Verify the proof using zero-knowledge proof verification
    // Note: This is a placeholder, actual verification would depend on your ZK implementation
    const isValid = true; // Simplified for now

    if (!isValid) {
      return res.json({ success: false, message: 'Invalid proof' });
    }

    // Record the proof fee transaction
    systemBalance += 10; // 10 yuan proof fee

    // Create transaction record in database
    await transactionDao.create({
      user_id: parseInt(userId),
      type: 'proof_fee',
      amount: 10,
      status: 'completed'
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @deprecated 请使用 POST /api/v1/loan/borrow 替代（路由 /loan.js）
router.post('/lend', async (req, res) => {
  try {
    const { userId, amount, duration, interestRate } = req.body;

    // Get user from database
    const user = await userDao.findById(parseInt(userId));

    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }

    // Check if user has valid proof
    const proofs = await proofDao.findByUserId(parseInt(userId));
    const hasValidProof = proofs.some(p => new Date(p.expires_at) > new Date());

    if (!hasValidProof) {
      return res.json({ success: false, message: '没有有效的信用证明' });
    }

    // Calculate total amount (principal + interest)
    const totalAmount = parseInt(amount) + (parseInt(amount) * interestRate * duration / 36500);

    // Create new transaction
    const newTransaction = await transactionDao.create({
      user_id: parseInt(userId),
      type: 'lend',
      amount: parseInt(amount),
      total_amount: totalAmount,
      status: 'pending'
    });

    // Update user balance
    await userDao.updateBalance(parseInt(userId), user.balance - parseInt(amount));

    res.json({
      success: true,
      message: '放贷成功',
      transaction: newTransaction
    });
  } catch (error) {
    console.error('放贷失败:', error);
    res.status(500).json({ success: false, message: '放贷失败' });
  }
});

// @deprecated 请使用 POST /api/v1/loan/repay 替代（路由 /loan.js）
router.post('/repay', async (req, res) => {
  try {
    const { userId, loanId } = req.body;

    // Get user from database
    const user = await userDao.findById(parseInt(userId));

    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }

    // Get transaction from database
    const transaction = await transactionDao.findById(parseInt(loanId));

    if (!transaction) {
      return res.json({ success: false, message: '交易不存在' });
    }

    if (transaction.type !== 'loan' || transaction.status !== 'pending') {
      return res.json({ success: false, message: '无效的还款请求' });
    }

    // Check if user has enough balance
    if (user.balance < transaction.amount) {
      return res.json({ success: false, message: '余额不足' });
    }

    // Update transaction status
    await transactionDao.updateStatus(parseInt(loanId), 'completed');

    // Update user balance
    await userDao.updateBalance(parseInt(userId), user.balance - transaction.amount);

    // Calculate credit score change based on repayment timing
    // Note: This is a simplified version, actual implementation would need due date information
    let scoreChange = 10; // Default for on-time repayment
    let reason = '按时还款';

    // Update credit score
    const newScore = Math.max(600, Math.min(850, user.credit_score + scoreChange));
    await userDao.updateCreditScore(parseInt(userId), newScore);

    res.json({
      success: true,
      message: '还款成功',
      repaidAmount: transaction.amount,
      newBalance: user.balance - transaction.amount,
      creditScore: newScore,
      scoreChange
    });
  } catch (error) {
    console.error('还款失败:', error);
    res.status(500).json({ success: false, message: '还款失败' });
  }
});

// @deprecated 请使用 POST /api/v1/loan/repay（带 transactionId）替代
router.post('/collect-loan', async (req, res) => {
  try {
    const { userId, transactionId } = req.body;

    // Get user from database
    const user = await userDao.findById(parseInt(userId));

    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }

    // Get transaction from database
    const transaction = await transactionDao.findById(parseInt(transactionId));

    if (!transaction) {
      return res.json({ success: false, message: '交易不存在' });
    }

    if (transaction.type !== 'lend' || transaction.status !== 'pending') {
      return res.json({ success: false, message: '无效的收回请求' });
    }

    // Update transaction status
    await transactionDao.updateStatus(parseInt(transactionId), 'completed');

    // Update user balance with total amount (principal + interest)
    await userDao.updateBalance(parseInt(userId), user.balance + (transaction.total_amount || 0));

    res.json({
      success: true,
      message: '收回贷款成功',
      collectedAmount: transaction.total_amount || 0,
      newBalance: user.balance + (transaction.total_amount || 0)
    });
  } catch (error) {
    console.error('收回贷款失败:', error);
    res.status(500).json({ success: false, message: '收回贷款失败' });
  }
});

// @deprecated 请使用 GET /api/v1/loan/loans 替代（路由 /loan.js）
router.get('/all-loans', async (req, res) => {
  try {
    // Get all loan transactions from database
    const transactions = await transactionDao.findByType('loan');
    
    // Get user information for each transaction
    const loans = [];
    for (const transaction of transactions) {
      const user = await userDao.findById(transaction.user_id);
      loans.push({
        ...transaction,
        username: user ? user.username : 'Unknown'
      });
    }

    res.json({
      success: true,
      loans: loans
    });
  } catch (error) {
    console.error('获取借款记录失败:', error);
    res.status(500).json({ success: false, message: '获取借款记录失败' });
  }
});

// @deprecated 请使用 GET /api/v1/loan/loans?type=lend 替代
router.get('/all-lends', async (req, res) => {
  try {
    // Get all lend transactions from database
    const transactions = await transactionDao.findByType('lend');
    
    // Get user information for each transaction
    const lends = [];
    for (const transaction of transactions) {
      const user = await userDao.findById(transaction.user_id);
      lends.push({
        ...transaction,
        username: user ? user.username : 'Unknown'
      });
    }

    res.json({
      success: true,
      lends: lends
    });
  } catch (error) {
    console.error('获取放贷记录失败:', error);
    res.status(500).json({ success: false, message: '获取放贷记录失败' });
  }
});

// Add findByType method to transactionDao if it doesn't exist
// This should be added to transactionDao.js
/*
exports.findByType = async (type) => {
  const sql = 'SELECT * FROM transactions WHERE type = ? ORDER BY created_at DESC';
  return await execute(sql, [type]);
};
*/

module.exports = router;