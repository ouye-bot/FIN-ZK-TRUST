const { execute } = require('../config/database');
const blockchainService = require('./blockchainService');
const logger = require('../utils/logger');

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 30000; // 30 秒基础重试间隔
const PROCESSOR_INTERVAL_MS = 60000; // 每 60 秒处理一次队列

/**
 * 将区块链写入操作加入重试队列
 * @param {string} operationType - 操作类型
 * @param {Object} payload - 操作参数
 * @returns {Promise<number>} - 队列记录 ID
 */
exports.enqueue = async (operationType, payload) => {
  const result = await execute(
    `INSERT INTO blockchain_queue (operation_type, payload, status, max_retries)
     VALUES (?, ?, 'pending', ?)`,
    [operationType, JSON.stringify(payload), MAX_RETRIES]
  );
  const queueId = result.insertId;
  logger.info('区块链操作已加入队列', { queueId, operationType });

  // 异步尝试立即执行（不阻塞调用方）
  processOne(queueId).catch(() => {});

  return queueId;
};

/**
 * 执行单个队列项
 */
async function processOne(queueId) {
  const rows = await execute(
    `SELECT * FROM blockchain_queue WHERE id = ? AND status = 'pending' FOR UPDATE`,
    [queueId]
  );
  if (rows.length === 0) return;

  const item = rows[0];
  const payload = JSON.parse(item.payload);

  await execute(
    `UPDATE blockchain_queue SET status = 'processing' WHERE id = ?`,
    [queueId]
  );

  try {
    const result = await dispatchOperation(item.operation_type, payload);

    if (result.success) {
      await execute(
        `UPDATE blockchain_queue SET status = 'completed', completed_at = NOW() WHERE id = ?`,
        [queueId]
      );
      logger.info('队列项执行成功', { queueId, operationType: item.operation_type });
    } else {
      throw new Error(result.error || '区块链操作返回失败');
    }
  } catch (err) {
    const newRetryCount = item.retry_count + 1;
    if (newRetryCount >= item.max_retries) {
      await execute(
        `UPDATE blockchain_queue SET status = 'failed', retry_count = ?, last_error = ? WHERE id = ?`,
        [newRetryCount, err.message, queueId]
      );
      logger.error('队列项执行失败（已达最大重试次数）', { queueId, retryCount: newRetryCount, error: err.message });
    } else {
      const delay = BASE_DELAY_MS * Math.pow(2, newRetryCount - 1);
      const nextRetry = new Date(Date.now() + delay);
      await execute(
        `UPDATE blockchain_queue SET status = 'pending', retry_count = ?, last_error = ?, next_retry_at = ? WHERE id = ?`,
        [newRetryCount, err.message, nextRetry, queueId]
      );
      logger.warning('队列项执行失败，将重试', { queueId, retryCount: newRetryCount, nextRetry: nextRetry.toISOString() });
    }
  }
}

/**
 * 分发操作到对应的区块链服务方法
 */
async function dispatchOperation(operationType, payload) {
  switch (operationType) {
    case 'storeAuditHash':
      // storeAuditHash(sm3Hash, timestamp, transactionType, userId)
      return await blockchainService.storeAuditHash(
        payload.sm3Hash, payload.timestamp, payload.transactionType, payload.userId
      );
    case 'storeTransactionHash':
      // storeTransactionHash(transactionId, transactionData, transactionType, userId)
      return await blockchainService.storeTransactionHash(
        payload.transactionId, payload.transactionData, payload.transactionType, payload.userId
      );
    case 'registerUserOnChain':
      // registerUserOnChain(userId, publicKey)
      return await blockchainService.registerUserOnChain(
        payload.userId, payload.publicKey
      );
    case 'verifyZKPOnChain':
      // verifyZKPOnChain(proof, publicSignals, userAddress, sm3Hash)
      return await blockchainService.verifyZKPOnChain(
        payload.proof, payload.publicSignals, payload.userAddress, payload.sm3Hash
      );
    default:
      throw new Error(`未知的操作类型: ${operationType}`);
  }
}

/**
 * 批量处理待执行的队列项（定时任务调用）
 */
exports.processPending = async () => {
  try {
    const pendingItems = await execute(
      `SELECT id FROM blockchain_queue
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC
       LIMIT 10`
    );

    if (pendingItems.length === 0) return;

    logger.info(`开始处理 ${pendingItems.length} 个待执行的区块链队列项`);
    for (const item of pendingItems) {
      await processOne(item.id);
    }
  } catch (err) {
    logger.error('处理区块链队列失败', { error: err.message });
  }
};

/**
 * 清理已完成的队列项（保留最近 7 天）
 */
exports.cleanup = async () => {
  try {
    const result = await execute(
      `DELETE FROM blockchain_queue WHERE status = 'completed' AND completed_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
    );
    if (result.affectedRows > 0) {
      logger.info(`已清理 ${result.affectedRows} 条过期的区块链队列记录`);
    }
  } catch (err) {
    logger.error('清理区块链队列失败', { error: err.message });
  }
};

/**
 * 获取队列状态统计
 */
exports.getStats = async () => {
  const rows = await execute(
    `SELECT status, COUNT(*) as count FROM blockchain_queue GROUP BY status`
  );
  const stats = {};
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  return stats;
};

// 启动定时处理器
let processorTimer = null;
exports.startProcessor = () => {
  if (processorTimer) return;
  processorTimer = setInterval(async () => {
    await exports.processPending();
    await exports.cleanup();
  }, PROCESSOR_INTERVAL_MS);
  processorTimer.unref();
  logger.info('区块链队列处理器已启动', { intervalMs: PROCESSOR_INTERVAL_MS });
};

exports.stopProcessor = () => {
  if (processorTimer) {
    clearInterval(processorTimer);
    processorTimer = null;
  }
};
