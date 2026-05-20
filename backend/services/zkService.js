const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { generateSM3Hash } = require('../utils/cryptoUtils');
const logger = require('../utils/logger');
const blockchainService = require('./blockchainService');

// 生成零知识证明
exports.generateProof = async (creditScore, threshold, hasNoOverdue) => {
  try {
    // 验证输入参数
    if (creditScore === undefined || creditScore === null || threshold === undefined || threshold === null) {
      throw new Error('缺少必要参数: creditScore 和 threshold');
    }
    if (hasNoOverdue === undefined || hasNoOverdue === null) {
      throw new Error('缺少必要参数: hasNoOverdue');
    }
    
    // 检查必要的文件是否存在
    const wasmPath = path.join(__dirname, '../../circuits/build/credit.wasm');
    const provingKeyPath = path.join(__dirname, '../../circuits/build/credit_final.zkey');
    
    if (!fs.existsSync(wasmPath)) {
      throw new Error('电路文件未找到: credit.wasm');
    }
    
    if (!fs.existsSync(provingKeyPath)) {
      throw new Error('证明密钥文件未找到: credit_final.zkey');
    }
    
    // 使用原始数值作为电路输入
    const circuitCreditScore = Number(creditScore);
    const circuitThreshold = Number(threshold);
    const circuitHasNoOverdue = Number(hasNoOverdue) || 0;

    if (isNaN(circuitCreditScore) || isNaN(circuitThreshold)) {
      throw new Error('creditScore 和 threshold 必须为有效数字');
    }
    if (circuitHasNoOverdue !== 0 && circuitHasNoOverdue !== 1) {
      throw new Error('hasNoOverdue 必须为布尔值');
    }

    logger.info('生成零知识证明', { creditScore: circuitCreditScore, threshold: circuitThreshold, hasNoOverdue: circuitHasNoOverdue });
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { creditScore: circuitCreditScore, threshold: circuitThreshold, hasNoOverdue: circuitHasNoOverdue },
      wasmPath,
      provingKeyPath
    );
    
    const result = { proof, publicSignals };
    
    logger.info('零知识证明生成成功', { publicSignalsLength: publicSignals.length, proofKeys: Object.keys(proof) });
    return result;
  } catch (error) {
    logger.error('生成零知识证明失败:', { error: error.message, stack: error.stack });
    throw error;
  }
};

// 验证零知识证明
exports.verifyProof = async (proof, publicSignals) => {
  // 验证输入参数（不吞掉，直接抛出）
  if (!proof || !publicSignals) {
    throw new Error('缺少必要参数: proof 和 publicSignals');
  }
  try {
    
    // 验证publicSignals格式
    if (!Array.isArray(publicSignals)) {
      throw new Error('publicSignals 必须是数组');
    }
    
    // 验证proof格式
    if (!proof.pi_a || !proof.pi_b || !proof.pi_c) {
      throw new Error('无效的证明格式: 缺少 pi_a, pi_b 或 pi_c');
    }
    
    const verificationKeyPath = path.join(__dirname, '../../circuits/build/verification_key.json');
    
    if (!fs.existsSync(verificationKeyPath)) {
      throw new Error('验证密钥文件未找到: verification_key.json');
    }
    
    // 读取并解析验证密钥文件
    const verificationKey = JSON.parse(fs.readFileSync(verificationKeyPath, 'utf8'));
    
    // 验证验证密钥格式
    if (!verificationKey.vk_alpha_1 || !verificationKey.vk_beta_2 || !verificationKey.vk_gamma_2 || !verificationKey.vk_delta_2 || !verificationKey.IC) {
      throw new Error('无效的验证密钥格式');
    }
    
    logger.info('验证零知识证明', { publicSignalsLength: publicSignals.length, proofKeys: Object.keys(proof), publicSignals: publicSignals, proof: proof });

    // 确保publicSignals是数组且不为空
      if (!Array.isArray(publicSignals) || publicSignals.length === 0) {
        throw new Error('publicSignals 必须是非空数组');
      }
      
      // 确保proof对象结构正确
      if (!proof.pi_a || !Array.isArray(proof.pi_a)) {
        throw new Error('无效的 proof.pi_a 格式');
      }
      if (!proof.pi_b || !Array.isArray(proof.pi_b)) {
        throw new Error('无效的 proof.pi_b 格式');
      }
      if (!proof.pi_c || !Array.isArray(proof.pi_c)) {
        throw new Error('无效的 proof.pi_c 格式');
      }
      
      // 确保verificationKey结构正确
      if (!verificationKey.vk_alpha_1 || !Array.isArray(verificationKey.vk_alpha_1)) {
        throw new Error('无效的 verificationKey.vk_alpha_1 格式');
      }
      if (!verificationKey.vk_beta_2 || !Array.isArray(verificationKey.vk_beta_2)) {
        throw new Error('无效的 verificationKey.vk_beta_2 格式');
      }
      if (!verificationKey.vk_gamma_2 || !Array.isArray(verificationKey.vk_gamma_2)) {
        throw new Error('无效的 verificationKey.vk_gamma_2 格式');
      }
      if (!verificationKey.vk_delta_2 || !Array.isArray(verificationKey.vk_delta_2)) {
        throw new Error('无效的 verificationKey.vk_delta_2 格式');
      }
      if (!verificationKey.IC || !Array.isArray(verificationKey.IC)) {
        throw new Error('无效的 verificationKey.IC 格式');
      }
      
      logger.info('验证密钥结构:', {
        vk_alpha_1_length: verificationKey.vk_alpha_1.length,
        vk_beta_2_length: verificationKey.vk_beta_2.length,
        vk_gamma_2_length: verificationKey.vk_gamma_2.length,
        vk_delta_2_length: verificationKey.vk_delta_2.length,
        IC_length: verificationKey.IC.length
      });
      
      // 检查proof和verificationKey的结构是否匹配snarkjs的要求
      const formattedProof = {
        pi_a: proof.pi_a.slice(0, 2), // snarkjs期望pi_a只有2个元素
        pi_b: proof.pi_b.slice(0, 2).map(pair => pair.slice(0, 2)), // 确保pi_b只有2个元素，每个元素只有2个元素
        pi_c: proof.pi_c.slice(0, 2) // snarkjs期望pi_c只有2个元素
      };
      
      // 确保pi_b只有2个元素
      if (formattedProof.pi_b.length > 2) {
        formattedProof.pi_b = formattedProof.pi_b.slice(0, 2);
      }
      
      // 格式化验证密钥，确保它符合snarkjs的要求
      const formattedVerificationKey = {
        protocol: verificationKey.protocol,
        curve: verificationKey.curve,
        nPublic: verificationKey.nPublic,
        vk_alpha_1: verificationKey.vk_alpha_1.slice(0, 2), // 只取前2个元素
        vk_beta_2: verificationKey.vk_beta_2.slice(0, 2).map(pair => pair.slice(0, 2)), // 只取前2个元素，每个元素只取前2个
        vk_gamma_2: verificationKey.vk_gamma_2.slice(0, 2).map(pair => pair.slice(0, 2)), // 只取前2个元素，每个元素只取前2个
        vk_delta_2: verificationKey.vk_delta_2.slice(0, 2).map(pair => pair.slice(0, 2)), // 只取前2个元素，每个元素只取前2个
        IC: verificationKey.IC.map(item => item.slice(0, 2)) // 每个元素只取前2个
      };
      
      logger.info('格式化验证用的证明:', { formattedProof });
      
      const verificationResult = await snarkjs.groth16.verify(
        formattedVerificationKey,
        publicSignals,
        formattedProof
      );
      
      logger.info('零知识证明验证结果:', { verificationResult });

      // 检查 isValid 输出信号
      // snarkjs 的 publicSignals 顺序：先输出信号，后公共输入
      // publicSignals[0] 是 isValid（输出），publicSignals[1] 是 threshold（公共输入）
      if (verificationResult && publicSignals.length > 0 && publicSignals[0] !== '1') {
        logger.info('ZKP 证明有效但 isValid=0，业务验证不通过', { publicSignals });
        return false;
      }

      // 如果验证成功，异步将结果记录到区块链（不阻塞）
      if (verificationResult) {
        try {
          const proofId = crypto.randomUUID();
          const proofData = { proof, publicSignals };
          const proofHash = generateSM3Hash(JSON.stringify(proofData));

          const userAddress = '0x0000000000000000000000000000000000000000';
          const sm3Hash = proofHash;

          // 先记录 proofResult，再做链上验证和状态更新
          blockchainService.recordZKPResult(proofId, true, proofHash)
            .then(async (recordResult) => {
              if (recordResult.success) {
                logger.info('ZKP验证结果上链存证成功', {
                  proofId,
                  blockchainTxHash: recordResult.blockchainTxHash
                });
              } else if (!recordResult.skipped) {
                logger.warning('ZKP验证结果上链存证失败', {
                  proofId,
                  error: recordResult.error
                });
              }

              // recordProofResult 完成后，执行链上验证
              const verifyResult = await blockchainService.verifyZKPOnChain(proof, publicSignals, userAddress, sm3Hash);
              if (verifyResult.success) {
                logger.info('链上 ZKP 验证完成', { proofId, blockchainTxHash: verifyResult.blockchainTxHash });
                await blockchainService.updateZKPChainStatus(proofId, true);
              } else {
                logger.warning('链上 ZKP 验证失败', { proofId, error: verifyResult.error });
                await blockchainService.updateZKPChainStatus(proofId, false);
              }
            })
            .catch(err => {
              logger.error('ZKP 上链流程异常', { error: err.message });
            });
        } catch (zkError) {
          logger.error('处理ZKP上链存证失败', {
            error: zkError.message
          });
        }
      }
      
      return verificationResult;
    } catch (snarkError) {
      logger.error('SnarkJS验证错误:', { error: snarkError.message, stack: snarkError.stack });
      throw snarkError;
    }
};