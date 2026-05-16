const { sm2 } = require('sm-crypto');
const { parentPort, workerData } = require('worker_threads');

// 从主线程接收签名验证任务
const { signatureTasks } = workerData;

// 并行处理所有签名验证任务
const results = signatureTasks.map(task => {
  try {
    const { message, signature, publicKey } = task;
    const result = sm2.doVerifySignature(message, signature, publicKey, { der: false });
    return result;
  } catch (error) {
    console.error('SM2 signature verification failed in worker:', error.message);
    return false;
  }
});

// 将结果发送回主线程
parentPort.postMessage(results);
