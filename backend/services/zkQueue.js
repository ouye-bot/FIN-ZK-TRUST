const crypto = require('crypto');
const logger = require('../utils/logger');

class ZKQueue {
  constructor() {
    this.tasks = new Map(); // taskId -> { status, result, error, createdAt }
    this.TTL = 300000; // 300 seconds (5 minutes)
    this.maxPendingTasks = 100;

    // 启动定时清理任务
    this.startCleanupInterval();
  }

  // 生成任务ID
  generateTaskId() {
    if (crypto.randomUUID) {
      return crypto.randomUUID();
    } else {
      // 手动生成 UUID v4 以兼容低版本 Node.js
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }
  }

  // 添加任务（仅记录状态，实际生成由 subprocess pool 负责）
  addTask(input) {
    const pendingCount = this.getPendingTaskCount();
    if (pendingCount >= this.maxPendingTasks) {
      logger.warning('ZK task queue is full, rejecting new task', { pendingCount, maxPendingTasks: this.maxPendingTasks });
      throw new Error('ZK task queue is full, max pending tasks: ' + this.maxPendingTasks);
    }

    const taskId = this.generateTaskId();
    const task = {
      status: 'queued',
      result: null,
      error: null,
      createdAt: Date.now()
    };

    this.tasks.set(taskId, task);
    logger.info('Added new ZK proof task to queue', { taskId, input });

    return taskId;
  }

  // 获取任务状态
  getTaskStatus(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return null;
    }

    // 检查是否过期
    if (Date.now() - task.createdAt > this.TTL) {
      this.tasks.delete(taskId);
      return null;
    }

    return {
      status: task.status,
      result: task.result,
      error: task.error
    };
  }

  // 更新任务状态（供外部调用）
  updateTaskStatus(taskId, status, result, error) {
    const task = this.tasks.get(taskId);
    if (!task) {
      return false;
    }
    task.status = status;
    task.result = result;
    task.error = error;
    this.tasks.set(taskId, task);
    return true;
  }

  // 获取所有任务总数
  getTotalTaskCount() {
    return this.tasks.size;
  }

  // 获取排队任务数（只统计 status === 'queued'）
  getPendingTaskCount() {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'queued') {
        count++;
      }
    }
    return count;
  }

  // 获取队列长度（向后兼容别名）
  getQueueLength() {
    return this.getPendingTaskCount();
  }

  // 启动定时清理
  startCleanupInterval() {
    const cleanupTimer = setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;

      for (const [taskId, task] of this.tasks.entries()) {
        if (now - task.createdAt > this.TTL) {
          this.tasks.delete(taskId);
          cleanedCount++;
        }
      }

      // 统计各状态的任务数
      let statusCount = { total: this.tasks.size, queued: 0, processing: 0, completed: 0, failed: 0 };
      for (const task of this.tasks.values()) {
        if (task.status === 'queued') statusCount.queued++;
        else if (task.status === 'processing') statusCount.processing++;
        else if (task.status === 'completed') statusCount.completed++;
        else if (task.status === 'failed') statusCount.failed++;
      }

      if (cleanedCount > 0) {
        logger.info('ZKQueue cleanup done', statusCount);
      }
    }, 60000); // 每 60 秒清理一次
    cleanupTimer.unref();
  }

  getStats() {
    let stats = { queued: 0, processing: 0, completed: 0, failed: 0 };
    for (const task of this.tasks.values()) {
      if (task.status === 'queued') stats.queued++;
      else if (task.status === 'processing') stats.processing++;
      else if (task.status === 'completed') stats.completed++;
      else if (task.status === 'failed') stats.failed++;
    }
    return stats;
  }
}

// 导出单例
const zkQueueInstance = new ZKQueue();
module.exports = zkQueueInstance;
module.exports.ZKQueue = ZKQueue;