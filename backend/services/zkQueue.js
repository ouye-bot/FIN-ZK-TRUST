const EventEmitter = require('events');
const crypto = require('crypto');
const snarkjs = require('snarkjs');
const { generateSM3Hash } = require('../utils/cryptoUtils');
const logger = require('../utils/logger');

class ZKQueue extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map(); // taskId -> { status, result, error, createdAt, retryCount }
    this.isProcessing = false;
    this.TTL = 300000; // 300 seconds (5 minutes)
    this.MAX_RETRIES = 2;
    this.maxPendingTasks = 100; // 任务提交限流阈值

    // 初始化事件监听器
    this.on('newTask', this.handleNewTask.bind(this));
    this.on('taskComplete', this.handleTaskComplete.bind(this));

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

  // 添加任务
  addTask(input, wasmPath, zkeyPath) {
    // 检查排队任务数是否已满
    const pendingCount = this.getPendingTaskCount();
    if (pendingCount >= this.maxPendingTasks) {
      logger.warn('ZK task queue is full, rejecting new task', { pendingCount, maxPendingTasks: this.maxPendingTasks });
      throw new Error('ZK task queue is full, max pending tasks: ' + this.maxPendingTasks);
    }

    const taskId = this.generateTaskId();
    const task = {
      status: 'queued',
      result: null,
      error: null,
      createdAt: Date.now(),
      retryCount: 0,
      input,
      wasmPath,
      zkeyPath
    };

    this.tasks.set(taskId, task);
    logger.info('Added new ZK proof task to queue', { taskId, input });

    // 触发新任务事件
    this.emit('newTask');

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

  // 处理新任务
  async handleNewTask() {
    if (this.isProcessing) {
      return; // 已有任务在处理，等待完成
    }

    // 找到最早的 queued 任务
    let oldestTask = null;
    let oldestTaskId = null;

    for (const [taskId, task] of this.tasks.entries()) {
      if (task.status === 'queued') {
        if (!oldestTask || task.createdAt < oldestTask.createdAt) {
          oldestTask = task;
          oldestTaskId = taskId;
        }
      }
    }

    if (oldestTask && oldestTaskId) {
      await this.processTask(oldestTaskId, oldestTask);
    }
  }

  // 处理任务完成
  async handleTaskComplete() {
    // 处理下一个任务
    await this.handleNewTask();
  }

  // 处理任务
  async processTask(taskId, task) {
    this.isProcessing = true;

    try {
      // 更新状态为 processing
      task.status = 'processing';
      this.tasks.set(taskId, task);
      logger.info('Processing ZK proof task', { taskId, retryCount: task.retryCount });

      // 执行 ZKP 证明生成
      const { creditScore, threshold, hasNoOverdue } = task.input;

      const circuitCreditScore = Number(creditScore);
      const circuitThreshold = Number(threshold);
      const circuitHasNoOverdue = hasNoOverdue ? 1 : 0;

      // 使用 snarkjs 生成证明
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        { creditScore: circuitCreditScore, threshold: circuitThreshold, hasNoOverdue: circuitHasNoOverdue },
        task.wasmPath,
        task.zkeyPath
      );

      // 更新状态为 completed
      task.status = 'completed';
      task.result = { proof, publicSignals };
      this.tasks.set(taskId, task);
      logger.info('ZK proof task completed successfully', { taskId, publicSignalsLength: publicSignals.length });

    } catch (error) {
      // 处理重试逻辑
      task.retryCount = (task.retryCount || 0) + 1;
      if (task.retryCount <= this.MAX_RETRIES) {
        // 重置为 queued 状态重新排队
        task.status = 'queued';
        task.error = error.message;
        this.tasks.set(taskId, task);
        logger.warn('ZK proof task failed, will retry', { taskId, error: error.message, retryCount: task.retryCount });
      } else {
        // 超过重试次数，标记为 failed
        task.status = 'failed';
        task.error = error.message;
        this.tasks.set(taskId, task);
        logger.error('ZK proof task failed after max retries', { taskId, error: error.message, stack: error.stack });
      }
    } finally {
      this.isProcessing = false;
      // 触发任务完成事件
      this.emit('taskComplete');
    }
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