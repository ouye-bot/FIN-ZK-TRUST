const snarkjs = require('snarkjs');
const path = require('path');

/**
 * 验证零知识证明
 * @param {Object} proof - 证明
 * @param {Array} publicSignals - 公开信号
 * @returns {Promise<boolean>} - 验证结果
 */
exports.verifyProof = async (proof, publicSignals) => {
  try {
    const fs = require('fs');
    const verificationKeyPath = path.join(__dirname, '../../circuits/build/verification_key.json');
    
    // 读取并解析验证密钥文件
    const verificationKey = JSON.parse(fs.readFileSync(verificationKeyPath, 'utf8'));
    
    // 验证proof和publicSignals格式
    if (!proof || !publicSignals || !Array.isArray(publicSignals)) {
      console.error('Invalid proof or publicSignals format');
      return false;
    }
    
    const verificationResult = await snarkjs.groth16.verify(
      verificationKey,
      publicSignals,
      proof
    );
    return verificationResult;
  } catch (error) {
    console.error('Error verifying proof:', error);
    return false;
  }
};

/**
 * 生成零知识证明
 * @param {number} creditScore - 信用分
 * @param {number} threshold - 阈值
 * @returns {Promise<Object>} - 包含证明和公开信号的对象
 */
exports.generateProof = async (creditScore, threshold) => {
  try {
    const wasmPath = path.join(__dirname, '../../circuits/build/credit.wasm');
    const provingKeyPath = path.join(__dirname, '../../circuits/build/credit_final.zkey');
    
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { creditScore, threshold },
      wasmPath,
      provingKeyPath
    );
    
    return { proof, publicSignals };
  } catch (error) {
    console.error('Error generating proof:', error);
    throw error;
  }
};
