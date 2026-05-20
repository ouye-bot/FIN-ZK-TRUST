const { execute } = require('../config/database');
const logger = require('../utils/logger');

class ZKQueue {
  constructor() {
    this.TTL = 300000;
    this.maxPendingTasks = 100;
    this.startCleanupInterval();
  }

  async generateTaskId() {
    const { v4: uuidv4 } = require('uuid');
    try {
      return uuidv4();
    } catch {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
  }

  async addTask(input) {
    const pendingCount = await this.getPendingTaskCount();
    if (pendingCount >= this.maxPendingTasks) {
      logger.warning('ZK task queue is full, rejecting new task', { pendingCount, maxPendingTasks: this.maxPendingTasks });
      throw new Error('ZK task queue is full, max pending tasks: ' + this.maxPendingTasks);
    }

    const taskId = await this.generateTaskId();
    const taskData = JSON.stringify(input);

    await execute(
      'INSERT INTO zk_queue (task_id, task_data, status) VALUES (?, ?, ?)',
      [taskId, taskData, 'pending']
    );

    logger.info('Added new ZK proof task to queue', { taskId, input });
    return taskId;
  }

  async getTaskStatus(taskId) {
    const rows = await execute(
      'SELECT status, result, error, created_at FROM zk_queue WHERE task_id = ?',
      [taskId]
    );

    if (rows.length === 0) return null;

    const task = rows[0];
    const createdAt = new Date(task.created_at).getTime();
    if (Date.now() - createdAt > this.TTL) {
      await execute('DELETE FROM zk_queue WHERE task_id = ?', [taskId]);
      return null;
    }

    return {
      status: task.status,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error
    };
  }

  async updateTaskStatus(taskId, status, result, error) {
    try {
      const resultStr = result ? JSON.stringify(result) : null;
      await execute(
        'UPDATE zk_queue SET status = ?, result = ?, error = ?, retry_count = retry_count + 1 WHERE task_id = ?',
        [status, resultStr, error || null, taskId]
      );
      return true;
    } catch (err) {
      logger.error('更新 ZK 任务状态失败', { taskId, status, error: err.message });
      return false;
    }
  }

  async getTotalTaskCount() {
    const rows = await execute('SELECT COUNT(*) as cnt FROM zk_queue');
    return rows[0]?.cnt || 0;
  }

  async getPendingTaskCount() {
    const rows = await execute("SELECT COUNT(*) as cnt FROM zk_queue WHERE status = 'pending'");
    return rows[0]?.cnt || 0;
  }

  async getQueueLength() {
    return this.getPendingTaskCount();
  }

  startCleanupInterval() {
    const cleanupTimer = setInterval(async () => {
      try {
        const cutoff = new Date(Date.now() - this.TTL).toISOString().slice(0, 19).replace('T', ' ');
        const result = await execute(
          'DELETE FROM zk_queue WHERE created_at < ?',
          [cutoff]
        );

        const stats = await this.getStats();
        if (result.affectedRows > 0 || result.changedRows > 0) {
          logger.info('ZKQueue cleanup done', stats);
        }
      } catch (error) {
        logger.error('ZKQueue cleanup failed', { error: error.message });
      }
    }, 60000);
    cleanupTimer.unref();
  }

  async getStats() {
    try {
      const rows = await execute(
        `SELECT status, COUNT(*) as cnt FROM zk_queue GROUP BY status`
      );
      const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
      for (const row of rows) {
        if (row.status in stats) stats[row.status] = row.cnt;
      }
      return stats;
    } catch (error) {
      logger.error('获取 ZK 队列统计失败', { error: error.message });
      return { pending: 0, processing: 0, completed: 0, failed: 0 };
    }
  }
}

const zkQueueInstance = new ZKQueue();
module.exports = zkQueueInstance;
module.exports.ZKQueue = ZKQueue;