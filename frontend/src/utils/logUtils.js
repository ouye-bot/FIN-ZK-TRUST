// 密码操作日志工具
import { post } from './apiUtils';

/**
 * 同步日志到后端持久化存储（SM3 哈希链）
 */
export const syncLogToBackend = async (logData) => {
  try {
    await post('/api/v1/crypto-log', {
      userId: logData.userId,
      operationType: logData.operationType,
      description: logData.description,
      data: {
        status: logData.status,
        detail: logData.detail,
        correlationInfo: logData.correlationInfo
      }
    }, true);
  } catch (err) {
    // 不阻塞前端 UI，静默失败
    console.warn('Failed to sync crypto log to backend:', err.message);
  }
};

/**
 * 添加密码操作日志
 * @param {string} operationType - 操作类型（如"SM2签名"、"SM3哈希"）
 * @param {string} description - 操作描述
 * @param {string} status - 操作状态（如"发起"、"成功"、"失败"）
 * @param {string} detail - 操作详细信息
 * @param {object} correlationInfo - 关联信息
 * @param {object} user - 用户信息
 * @param {function} setCryptoLogs - 日志状态更新函数
 */
export const addCryptoLog = (operationType, description, status, detail = '', correlationInfo = null, user, setCryptoLogs) => {
  if (!setCryptoLogs) return;

  const now = new Date();
  const formattedTime = now.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  // 生成唯一ID
  const logId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

  const log = {
    id: logId,
    userId: user?.id || user?.username || 'anonymous',
    operationType,
    description,
    status,
    detail,
    timestamp: formattedTime,
    fullTimestamp: now.toISOString(),
    correlationInfo
  };

  // 保持最多显示50条日志
  setCryptoLogs(prevLogs => {
    const newLogs = [...prevLogs, log];
    if (newLogs.length > 50) {
      return newLogs.slice(-50);
    }
    return newLogs;
  });

  // 同步到后端持久化
  syncLogToBackend(log);
};

/**
 * 清理密码操作日志
 * @param {function} setCryptoLogs - 日志状态更新函数
 */
export const clearCryptoLogs = (setCryptoLogs) => {
  if (setCryptoLogs) {
    setCryptoLogs([]);
  }
};

/**
 * 导出密码操作日志
 * @param {array} logs - 日志数组
 */
export const exportCryptoLogs = (logs) => {
  const csvContent = [
    ['时间', '操作类型', '描述', '状态', '详细信息'],
    ...logs.map(log => [
      log.fullTimestamp,
      log.operationType,
      log.description,
      log.status,
      log.detail
    ])
  ].map(row => row.join(',')).join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `crypto-logs-${Date.now()}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};