import { post, get } from './apiUtils';

/**
 * 生成零知识证明
 * @param {number} creditScore - 信用分
 * @param {number} threshold - 阈值
 * @param {number} userId - 用户ID（用于查询逾期状态）
 * @returns {Promise<Object>} - 包含证明和公开信号的对象
 */
export const generateProof = async (creditScore, threshold, userId) => {
  // Step 1: 提交证明生成任务
  const submitRes = await post('/api/v1/zk/generate-proof', { creditScore, threshold, userId });
  const submitData = await submitRes.json();
  if (!submitData.success) throw new Error(submitData.message || '提交证明生成任务失败');
  
  const taskId = submitData.taskId;
  
  // Step 2: 轮询任务状态，直到完成
  const maxAttempts = 30;   // 最多轮询30次
  const interval = 200;     // 每次间隔200ms
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, interval));
    
    const taskRes = await get(`/api/v1/zk/task/${taskId}`);
    const taskData = await taskRes.json();
    
    if (taskData.status === 'completed') {
      return taskData.result; // { proof, publicSignals }
    } else if (taskData.status === 'failed') {
      throw new Error(taskData.error || '零知识证明生成失败');
    }
    // 其他状态（queued / processing）继续轮询
  }
  
  throw new Error('零知识证明生成超时，请重试');
};