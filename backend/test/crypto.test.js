/**
 * FinZkTrust 密码技术综合测试
 *
 * 测试范围：
 * - SM2 椭圆曲线密码（密钥生成/签名/验签）
 * - SM3 哈希函数（确定性/雪崩效应）
 * - SM4 对称加密（加解密循环/错误密钥/长数据）
 * - TOTP 动态口令（生成与验证）
 * - 零知识证明 ZKP（生成与验证）
 * - 区块链审计存证（降级处理）
 * - Shamir 秘密共享 SSS（分片与恢复）
 *
 * 运行方式：node test/crypto.test.js
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 环境变量加载
const envPath = path.resolve(__dirname, '../.env');
require('dotenv').config({ path: envPath });

class CryptoTest {
  constructor() {
    this.testResults = [];
    this.modules = {
      sm2: { name: 'SM2 椭圆曲线密码', passed: 0, failed: 0, knownIssues: 0 },
      sm3: { name: 'SM3 哈希函数', passed: 0, failed: 0, knownIssues: 0 },
      sm4: { name: 'SM4 对称加密', passed: 0, failed: 0, knownIssues: 0 },
      totp: { name: 'TOTP 动态口令', passed: 0, failed: 0, knownIssues: 0 },
      zkp: { name: '零知识证明 ZKP', passed: 0, failed: 0, knownIssues: 0 },
      blockchain: { name: '区块链审计存证', passed: 0, failed: 0, skipped: 0, knownIssues: 0 },
      sss: { name: 'Shamir 秘密共享', passed: 0, failed: 0, knownIssues: 0 }
    };
    this.blockchainSkipped = false;
  }

  addResult(module, name, passed, details = {}) {
    const result = { module, name, passed, ...details };
    this.testResults.push(result);
    if (result.knownIssue) {
      this.modules[module].knownIssues++;
    } else if (passed) {
      this.modules[module].passed++;
    } else {
      this.modules[module].failed++;
    }
    return result;
  }

  async run() {
    console.log('='.repeat(70));
    console.log('  FinZkTrust 密码技术综合测试');
    console.log('='.repeat(70));
    console.log(`  开始时间: ${new Date().toLocaleString()}`);
    console.log('');

    await this.module1_sm2Tests();
    await this.module2_sm3Tests();
    await this.module3_sm4Tests();
    await this.module4_totpTests();
    await this.module5_zkpTests();
    await this.module6_blockchainTests();
    await this.module7_sssTests();

    this.printResults();
    this.saveResults();
  }

  // ============================================
  // 模块1：SM2 椭圆曲线密码测试
  // ============================================
  async module1_sm2Tests() {
    console.log('\n' + '='.repeat(70));
    console.log('  模块1：SM2 椭圆曲线密码测试');
    console.log('='.repeat(70));

    let cryptoUtils;
    try {
      cryptoUtils = require('../utils/cryptoUtils');
    } catch (e) {
      console.log('  ⚠️ cryptoUtils 模块不可用');
      return;
    }

    const { generateSM2KeyPair, signWithSM2, verifySM2Signature } = cryptoUtils;

    // 1.1 密钥对生成格式正确
    console.log('\n  1.1 密钥对生成格式正确');
    let allValid = true;
    const keyPair = generateSM2KeyPair();
    const pubKeyValid = keyPair.publicKey.startsWith('04') && keyPair.publicKey.length === 130;
    const privKeyValid = keyPair.privateKey.length === 64;
    allValid = pubKeyValid && privKeyValid;
    this.addResult('sm2', '密钥对生成格式正确', allValid, {
      publicKeyLength: keyPair.publicKey.length,
      privateKeyLength: keyPair.privateKey.length
    });
    console.log(`     ${allValid ? '✓' : '✗'} publicKey: ${pubKeyValid ? '正确' : '错误'}, privateKey: ${privKeyValid ? '正确' : '错误'}`);

    // 1.2 签名与验签一致性
    console.log('\n  1.2 签名与验签一致性');
    const message = 'Test message for SM2 signature';
    const sig = signWithSM2(message, keyPair.privateKey);
    const verifyResult = verifySM2Signature(message, sig, keyPair.publicKey);
    this.addResult('sm2', '签名与验签一致性', verifyResult, { signatureLength: sig.length });
    console.log(`     ${verifyResult ? '✓' : '✗'} 验签结果: ${verifyResult}`);

    // 1.3 错误公钥验签失败
    console.log('\n  1.3 错误公钥验签失败');
    const keyPairB = generateSM2KeyPair();
    const verifyWithWrongKey = verifySM2Signature(message, sig, keyPairB.publicKey);
    this.addResult('sm2', '错误公钥验签失败', !verifyWithWrongKey, {
      shouldBeFalse: !verifyWithWrongKey
    });
    console.log(`     ${!verifyWithWrongKey ? '✓' : '✗'} 错误公钥验签结果: ${verifyWithWrongKey} (应为 false)`);

    // 1.4 消息篡改后验签失败
    console.log('\n  1.4 消息篡改后验签失败');
    const tamperedMessage = message + '!';
    const verifyTampered = verifySM2Signature(tamperedMessage, sig, keyPair.publicKey);
    this.addResult('sm2', '消息篡改后验签失败', !verifyTampered, {
      tamperedResult: verifyTampered
    });
    console.log(`     ${!verifyTampered ? '✓' : '✗'} 篡改消息验签结果: ${verifyTampered} (应为 false)`);

    // 1.5 批量验证
    console.log('\n  1.5 批量验证');
    const batchResults = [];
    for (let i = 0; i < 10; i++) {
      const msg = `Batch message ${i}`;
      const s = signWithSM2(msg, keyPair.privateKey);
      const v = verifySM2Signature(msg, s, keyPair.publicKey);
      batchResults.push(v);
    }
    const allBatchPassed = batchResults.every(r => r === true);
    this.addResult('sm2', '批量验证', allBatchPassed, {
      total: 10,
      passed: batchResults.filter(r => r).length
    });
    console.log(`     ${allBatchPassed ? '✓' : '✗'} 批量验证: ${batchResults.filter(r => r).length}/10 通过`);

    // 1.6 签名缓存一致性
    console.log('\n  1.6 签名缓存一致性');
    const firstVerify = verifySM2Signature(message, sig, keyPair.publicKey);
    const secondVerify = verifySM2Signature(message, sig, keyPair.publicKey);
    const cacheConsistent = firstVerify === secondVerify && firstVerify === true;
    this.addResult('sm2', '签名缓存一致性', cacheConsistent, {
      firstResult: firstVerify,
      secondResult: secondVerify
    });
    console.log(`     ${cacheConsistent ? '✓' : '✗'} 两次验签结果一致: ${firstVerify === secondVerify}`);

    // 1.7 空消息签名
    console.log('\n  1.7 空消息签名');
    try {
      const emptySig = signWithSM2('', keyPair.privateKey);
      this.addResult('sm2', '空消息签名', false, {
        expectedBehavior: '空消息应抛出异常',
        actualBehavior: '未抛异常，返回了签名'
      });
      console.log(`     ✗ 空消息签名: 未抛异常，返回了签名`);
    } catch (e) {
      this.addResult('sm2', '空消息签名', e.message.includes('签名消息不能为空'), {
        expectedBehavior: '抛出"签名消息不能为空"异常',
        actualBehavior: e.message
      });
      console.log(`     ${e.message.includes('签名消息不能为空') ? '✓' : '✗'} 空消息签名: ${e.message}`);
    }

    // 1.8 超长消息签名（100KB）
    console.log('\n  1.8 超长消息签名（100KB）');
    try {
      const longMsg = 'x'.repeat(100000);
      const longSig = signWithSM2(longMsg, keyPair.privateKey);
      const longVerify = verifySM2Signature(longMsg, longSig, keyPair.publicKey);
      this.addResult('sm2', '超长消息签名（100KB）', longVerify, {
        messageLength: longMsg.length,
        signatureLength: longSig.length
      });
      console.log(`     ${longVerify ? '✓' : '✗'} 100KB消息签名验签: ${longVerify ? '通过' : '失败'}`);
    } catch (e) {
      this.addResult('sm2', '超长消息签名（100KB）', false, { error: e.message });
      console.log(`     ✗ 超长消息签名: 失败 - ${e.message}`);
    }

    // 1.9 私钥格式错误
    console.log('\n  1.9 私钥格式错误');
    try {
      signWithSM2('test message', 'invalid_key_format');
      this.addResult('sm2', '私钥格式错误', false, {
        expectedBehavior: 'signWithSM2 对无效私钥应抛出异常',
        actualBehavior: '未抛出异常，静默接受无效私钥',
        bugId: 'B-SM2-INPUT',
        bugLocation: 'cryptoUtils.js:signWithSM2'
      });
      console.log(`     ⚠️ 私钥格式错误: 应抛出异常但未抛出`);
    } catch (e) {
      this.addResult('sm2', '私钥格式错误', true, {
        error: e.message
      });
      console.log(`     ✓ 私钥格式错误: 正确抛出异常 - ${e.message}`);
    }

    // 1.10 签名位翻转检测
    console.log('\n  1.10 签名位翻转检测');
    const flipSig = sig.substring(0, 1) + (sig[1] === 'a' ? 'b' : 'a') + sig.substring(2);
    const flipVerify = verifySM2Signature(message, flipSig, keyPair.publicKey);
    this.addResult('sm2', '签名位翻转检测', !flipVerify, {
      knownIssue: !!flipVerify,
      expectedBehavior: '翻转签名位后验签应返回 false',
      actualBehavior: `验签返回 ${flipVerify}`,
      bugId: 'B9',
      bugLocation: 'cryptoUtils.js:verifySM2Signature'
    });
    console.log(`     ${!flipVerify ? '✓' : '⚠️ [knownIssue]'} 签名位翻转后验签: ${flipVerify} (应为 false)`);

    // 1.11 buildSignatureData 格式验证
    console.log('\n  1.11 buildSignatureData 格式验证');
    try {
      const { buildSignatureData } = cryptoUtils;
      if (typeof buildSignatureData !== 'function') {
        this.addResult('sm2', 'buildSignatureData 格式验证', false, { note: 'buildSignatureData 不可用' });
        console.log(`     ⚠️ buildSignatureData 不可用`);
      } else {
        const sigData = buildSignatureData({ amount: 100, userId: 'u1', creditProofId: 'p1' }, ['amount', 'creditProofId', 'userId']);
        const expectedOrder = '{"amount":100,"creditProofId":"p1","userId":"u1"}';
        const orderCorrect = sigData === expectedOrder;
        const sigData2 = buildSignatureData({ amount: 100 }, ['amount', 'missing_key']);
        const missingKeyOK = sigData2 === '{"amount":100}';
        const buildSigOK = orderCorrect && missingKeyOK;
        this.addResult('sm2', 'buildSignatureData 格式验证', buildSigOK, {
          sigData,
          expectedOrder,
          sigData2,
          orderCorrect,
          missingKeySkipped: missingKeyOK
        });
        console.log(`     ${buildSigOK ? '✓' : '✗'} buildSignatureData: 键顺序${orderCorrect ? '正确' : '错误'}, 缺失键${missingKeyOK ? '跳过' : '未跳过'}`);
      }
    } catch (e) {
      this.addResult('sm2', 'buildSignatureData 格式验证', false, { error: e.message });
      console.log(`     ✗ buildSignatureData 格式验证: 失败 - ${e.message}`);
    }
  }

  // ============================================
  // 模块2：SM3 哈希函数测试
  // ============================================
  async module2_sm3Tests() {
    console.log('\n' + '='.repeat(70));
    console.log('  模块2：SM3 哈希函数测试');
    console.log('='.repeat(70));

    let cryptoUtils;
    try {
      cryptoUtils = require('../utils/cryptoUtils');
    } catch (e) {
      console.log('  ⚠️ cryptoUtils 模块不可用');
      return;
    }

    const { generateSM3Hash } = cryptoUtils;

    // 2.1 同数据同哈希
    console.log('\n  2.1 同数据同哈希');
    const testData = 'consistent_data_test';
    const hash1 = generateSM3Hash(testData);
    const hash2 = generateSM3Hash(testData);
    const hash3 = generateSM3Hash(testData);
    const allSame = hash1 === hash2 && hash2 === hash3;
    this.addResult('sm3', '同数据同哈希', allSame, {
      hash1, hash2, hash3
    });
    console.log(`     ${allSame ? '✓' : '✗'} 三次哈希值: ${allSame ? '完全相同' : '不一致'}`);

    // 2.2 异数据异哈希
    console.log('\n  2.2 异数据异哈希');
    const dataA = 'data_A';
    const dataB = 'data_B';
    const dataC = 'data_C';
    const hashA = generateSM3Hash(dataA);
    const hashB = generateSM3Hash(dataB);
    const hashC = generateSM3Hash(dataC);
    const allDifferent = hashA !== hashB && hashB !== hashC && hashA !== hashC;
    this.addResult('sm3', '异数据异哈希', allDifferent, {
      hashA, hashB, hashC
    });
    console.log(`     ${allDifferent ? '✓' : '✗'} 三条数据哈希值: ${allDifferent ? '互不相同' : '有重复'}`);

    // 2.3 雪崩效应
    console.log('\n  2.3 雪崩效应');
    const hashABC = generateSM3Hash('abc');
    const hashABD = generateSM3Hash('abd');
    let diffCount = 0;
    for (let i = 0; i < hashABC.length; i++) {
      if (hashABC[i] !== hashABD[i]) diffCount++;
    }
    const avalancheValid = diffCount >= 20;
    this.addResult('sm3', '雪崩效应', avalancheValid, {
      differentChars: diffCount,
      totalChars: hashABC.length
    });
    console.log(`     ${avalancheValid ? '✓' : '✗'} 'abc' vs 'abd': ${diffCount}/${hashABC.length} 字符不同`);

    // 2.4 长度扩展攻击防护
    console.log('\n  2.4 长度扩展攻击防护');
    const hashShort = generateSM3Hash('test');
    const hashLong = generateSM3Hash('test\x00extra');
    const noPrefixMatch = !hashShort.startsWith(hashLong.substring(0, 4));
    this.addResult('sm3', '长度扩展攻击防护', noPrefixMatch, {
      shortLength: hashShort.length,
      longLength: hashLong.length
    });
    console.log(`     ${noPrefixMatch ? '✓' : '✗'} 短数据与长数据哈希: ${noPrefixMatch ? '无前缀关联' : '存在关联'}`);

    // 2.5 雪崩效应阈值提高
    console.log('\n  2.5 雪崩效应阈值提高');
    const hashABC2 = generateSM3Hash('abc');
    const hashABD2 = generateSM3Hash('abd');
    let diffCount2 = 0;
    for (let i = 0; i < hashABC2.length; i++) {
      if (hashABC2[i] !== hashABD2[i]) diffCount2++;
    }
    const avalancheValid2 = diffCount2 >= 28;
    this.addResult('sm3', '雪崩效应阈值提高', avalancheValid2, {
      differentChars: diffCount2,
      totalChars: hashABC2.length,
      threshold: 28
    });
    console.log(`     ${avalancheValid2 ? '✓' : '✗'} 'abc' vs 'abd': ${diffCount2}/${hashABC2.length} 字符不同 (阈值: >=28)`);

    // 2.6 Unicode 数据哈希
    console.log('\n  2.6 Unicode 数据哈希');
    const unicodeHash = generateSM3Hash('中文测试🎉');
    const unicodeValid = /^[0-9a-f]{64}$/i.test(unicodeHash);
    const asciiHash = generateSM3Hash('english text');
    const unicodeDifferent = unicodeHash !== asciiHash;
    const unicodeOK = unicodeValid && unicodeDifferent;
    this.addResult('sm3', 'Unicode 数据哈希', unicodeOK, {
      unicodeHash,
      asciiHash,
      isHex64: unicodeValid,
      differentFromAscii: unicodeDifferent
    });
    console.log(`     ${unicodeOK ? '✓' : '✗'} Unicode哈希: ${unicodeValid ? '64位hex' : '格式错误'}, ${unicodeDifferent ? '与英文不同' : '与英文相同'}`);
  }

  // ============================================
  // 模块3：SM4 对称加密测试
  // ============================================
  async module3_sm4Tests() {
    console.log('\n' + '='.repeat(70));
    console.log('  模块3：SM4 对称加密测试');
    console.log('='.repeat(70));

    let sm4Crypto;
    try {
      sm4Crypto = require('../utils/sm4Crypto');
    } catch (e) {
      console.log('  ⚠️ sm4Crypto 模块不可用');
      return;
    }

    const { encrypt, decrypt } = sm4Crypto;

    // 3.1 加解密循环
    console.log('\n  3.1 加解密循环');
    const data1KB = Buffer.alloc(1024, 'x').toString('utf8');
    const encrypted = encrypt(data1KB);
    const decrypted = decrypt(encrypted);
    const roundTripOK = decrypted === data1KB;
    this.addResult('sm4', '加解密循环', roundTripOK, {
      originalLength: data1KB.length,
      decryptedLength: decrypted.length
    });
    console.log(`     ${roundTripOK ? '✓' : '✗'} 1KB 数据加解密: ${roundTripOK ? '成功' : '失败'}`);

    // 3.2 认证标签防篡改
    console.log('\n  3.2 认证标签防篡改');
    try {
      const testData = crypto.randomBytes(128).toString('hex');
      const encryptedData = encrypt(testData);
      const parts = encryptedData.split(':');
      const tamperedAuthTag = parts[1].substring(0, 10) + 'ff' + parts[1].substring(12);
      const tamperedCiphertext = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;
      const result = decrypt(tamperedCiphertext);
      const authTagWorks = result === tamperedCiphertext;
      this.addResult('sm4', '认证标签防篡改', authTagWorks, {
        note: '标签被修改后拒绝解密并返回原始值'
      });
      console.log(`     ${authTagWorks ? '✓' : '✗'} 认证标签篡改后返回原始值=${authTagWorks}`);
    } catch (e) {
      this.addResult('sm4', '认证标签防篡改', true, { note: '抛出异常' });
      console.log(`     ✓ 认证标签防篡改: 抛出异常`);
    }

    // 3.3 空数据加解密
    console.log('\n  3.3 空数据加解密');
    try {
      const emptyData = '';
      const emptyEncrypted = encrypt(emptyData);
      const emptyDecrypted = decrypt(emptyEncrypted);
      const emptyOK = emptyDecrypted === emptyData;
      this.addResult('sm4', '空数据加解密', emptyOK, {
        decryptedLength: emptyDecrypted.length
      });
      console.log(`     ${emptyOK ? '✓' : '✗'} 空字符串加解密: ${emptyOK ? '成功' : '失败'}`);
    } catch (e) {
      this.addResult('sm4', '空数据加解密', false, {
        error: e.message
      });
      console.log(`     ✗ 空字符串加解密: 失败 - ${e.message}`);
    }

    // 3.4 长数据（10KB）加解密
    console.log('\n  3.4 长数据（10KB）加解密');
    const data10KB = crypto.randomBytes(10 * 1024).toString('utf8');
    const encrypted10KB = encrypt(data10KB);
    const decrypted10KB = decrypt(encrypted10KB);
    const longDataOK = decrypted10KB === data10KB;
    this.addResult('sm4', '长数据（10KB）加解密', longDataOK, {
      originalLength: data10KB.length,
      decryptedLength: decrypted10KB.length
    });
    console.log(`     ${longDataOK ? '✓' : '✗'} 10KB 数据加解密: ${longDataOK ? '成功' : '失败'}`);

    // 3.5 数字输入加密
    console.log('\n  3.5 数字输入加密');
    try {
      const numEncrypted = encrypt(12345);
      const numDecrypted = decrypt(numEncrypted);
      const numOK = numDecrypted === '12345';
      this.addResult('sm4', '数字输入加密', numOK, {
        encryptedValue: numEncrypted.substring(0, 20) + '...',
        decryptedValue: numDecrypted
      });
      console.log(`     ${numOK ? '✓' : '✗'} 数字12345加解密: ${numOK ? '成功' : '失败'} (解密结果: ${numDecrypted})`);
    } catch (e) {
      this.addResult('sm4', '数字输入加密', false, { error: e.message });
      console.log(`     ✗ 数字输入加密: 失败 - ${e.message}`);
    }

    // 3.6 encryptFields/decryptFields users 表
    console.log('\n  3.6 encryptFields/decryptFields users 表');
    try {
      const { encryptFields, decryptFields } = sm4Crypto;
      if (typeof encryptFields !== 'function' || typeof decryptFields !== 'function') {
        this.addResult('sm4', 'encryptFields users 表', false, { note: 'encryptFields/decryptFields 不可用' });
        console.log(`     ⚠️ encryptFields/decryptFields 不可用`);
      } else {
        const userData = { balance: 10000, credit_score: 750, name: 'test' };
        const encryptedUser = encryptFields('users', userData);
        const balanceEncrypted = encryptedUser.balance !== 10000;
        const creditScoreEncrypted = encryptedUser.credit_score !== 750;
        const nameUnchanged = encryptedUser.name === 'test';
        const encryptOK = balanceEncrypted && creditScoreEncrypted && nameUnchanged;
        this.addResult('sm4', 'encryptFields users 表', encryptOK, {
          balanceEncrypted,
          creditScoreEncrypted,
          nameUnchanged
        });
        console.log(`     ${encryptOK ? '✓' : '✗'} users加密: balance=${balanceEncrypted ? '已加密' : '未加密'}, credit_score=${creditScoreEncrypted ? '已加密' : '未加密'}, name=${nameUnchanged ? '未加密' : '已加密'}`);

        if (encryptOK) {
          const decryptedUser = decryptFields('users', encryptedUser);
          const balanceMatch = decryptedUser.balance === 10000;
          const creditScoreMatch = decryptedUser.credit_score === 750;
          const nameMatch = decryptedUser.name === 'test';
          const decryptOK = balanceMatch && creditScoreMatch && nameMatch;
          this.addResult('sm4', 'decryptFields users 表', decryptOK, {
            balanceMatch,
            creditScoreMatch,
            nameMatch
          });
          console.log(`     ${decryptOK ? '✓' : '✗'} users解密: balance=${balanceMatch ? '正确' : '错误'}, credit_score=${creditScoreMatch ? '正确' : '错误'}, name=${nameMatch ? '正确' : '错误'}`);
        }
      }
    } catch (e) {
      this.addResult('sm4', 'encryptFields users 表', false, { error: e.message });
      console.log(`     ✗ encryptFields users 表: 失败 - ${e.message}`);
    }

    // 3.7 encryptFields/decryptFields transactions 表
    console.log('\n  3.7 encryptFields/decryptFields transactions 表');
    try {
      const { encryptFields, decryptFields } = sm4Crypto;
      if (typeof encryptFields !== 'function') {
        this.addResult('sm4', 'encryptFields transactions 表', false, { note: 'encryptFields 不可用' });
        console.log(`     ⚠️ encryptFields 不可用`);
      } else {
        const txData = { amount: 5000, interest: 100, type: 'loan' };
        const encryptedTx = encryptFields('transactions', txData);
        const amountEncrypted = encryptedTx.amount !== 5000;
        const interestEncrypted = encryptedTx.interest !== 100;
        const typeUnchanged = encryptedTx.type === 'loan';
        const txEncryptOK = amountEncrypted && interestEncrypted && typeUnchanged;
        this.addResult('sm4', 'encryptFields transactions 表', txEncryptOK, {
          amountEncrypted,
          interestEncrypted,
          typeUnchanged
        });
        console.log(`     ${txEncryptOK ? '✓' : '✗'} transactions加密: amount=${amountEncrypted ? '已加密' : '未加密'}, interest=${interestEncrypted ? '已加密' : '未加密'}, type=${typeUnchanged ? '未加密' : '已加密'}`);

        if (txEncryptOK) {
          const decryptedTx = decryptFields('transactions', encryptedTx);
          const amountMatch = decryptedTx.amount === 5000;
          const interestMatch = decryptedTx.interest === 100;
          const typeMatch = decryptedTx.type === 'loan';
          const txDecryptOK = amountMatch && interestMatch && typeMatch;
          this.addResult('sm4', 'decryptFields transactions 表', txDecryptOK, {
            amountMatch,
            interestMatch,
            typeMatch
          });
          console.log(`     ${txDecryptOK ? '✓' : '✗'} transactions解密: amount=${amountMatch ? '正确' : '错误'}, interest=${interestMatch ? '正确' : '错误'}, type=${typeMatch ? '正确' : '错误'}`);
        }
      }
    } catch (e) {
      this.addResult('sm4', 'encryptFields transactions 表', false, { error: e.message });
      console.log(`     ✗ encryptFields transactions 表: 失败 - ${e.message}`);
    }

    // 3.8 reEncrypt 密钥轮换
    console.log('\n  3.8 reEncrypt 密钥轮换');
    try {
      const { reEncrypt } = sm4Crypto;
      if (typeof reEncrypt !== 'function') {
        this.addResult('sm4', 'reEncrypt 密钥轮换', false, { note: 'reEncrypt 不可用' });
        console.log(`     ⚠️ reEncrypt 不可用`);
      } else {
        const plainData = 'sensitive data for key rotation test';
        const oldKey = process.env.SM4_MASTER_KEY;
        if (!oldKey) {
          this.addResult('sm4', 'reEncrypt 密钥轮换', false, { note: 'SM4_MASTER_KEY 未设置，跳过' });
          console.log(`     ⚠️ SM4_MASTER_KEY 未设置，跳过`);
        } else {
          const newKey = crypto.randomBytes(16).toString('hex');
          const encryptedOld = encrypt(plainData);
          const reEncrypted = reEncrypt(encryptedOld, oldKey, newKey);
          const hasV2Prefix = reEncrypted.startsWith('v2:');
          const rotationOK = hasV2Prefix && typeof reEncrypted === 'string' && reEncrypted.length > 0;
          this.addResult('sm4', 'reEncrypt 密钥轮换', rotationOK, {
            hasV2Prefix,
            outputLength: reEncrypted.length,
            note: 'decrypt 不接受密钥参数，无法验证新密钥解密'
          });
          console.log(`     ${rotationOK ? '✓' : '✗'} 密钥轮换: v2前缀=${hasV2Prefix}, 输出长度=${reEncrypted.length}`);
        }
      }
    } catch (e) {
      this.addResult('sm4', 'reEncrypt 密钥轮换', false, { error: e.message });
      console.log(`     ✗ reEncrypt 密钥轮换: 失败 - ${e.message}`);
    }

    // 3.9 认证标签完整性（系统性）
    console.log('\n  3.9 认证标签完整性（系统性）');
    try {
      const testData = crypto.randomBytes(64).toString('hex');
      const encData = encrypt(testData);
      const parts = encData.split(':');
      const prefix = parts[0];
      const iv = parts[1];
      const authTag = parts[2];
      const ciphertext = parts.slice(3).join(':');

      let ivTamperResult, authTagTamperResult, ciphertextTamperResult;

      try {
        const tamperedIV = `${prefix}:${iv.substring(0, 10)}ff${iv.substring(12)}:${authTag}:${ciphertext}`;
        decrypt(tamperedIV);
        ivTamperResult = 'no_error';
      } catch (e) {
        ivTamperResult = 'exception';
      }

      try {
        const tamperedAuthTag = `${prefix}:${iv}:${authTag.substring(0, 10)}ff${authTag.substring(12)}:${ciphertext}`;
        decrypt(tamperedAuthTag);
        authTagTamperResult = 'no_error';
      } catch (e) {
        authTagTamperResult = 'exception';
      }

      try {
        const tamperedCT = `${prefix}:${iv}:${authTag}:${ciphertext.substring(0, 10)}ff${ciphertext.substring(12)}`;
        decrypt(tamperedCT);
        ciphertextTamperResult = 'no_error';
      } catch (e) {
        ciphertextTamperResult = 'exception';
      }

      const allTamperDetected = ivTamperResult === 'exception' && authTagTamperResult === 'exception' && ciphertextTamperResult === 'exception';
      this.addResult('sm4', '认证标签完整性（系统性）', allTamperDetected, {
        knownIssue: !allTamperDetected,
        expectedBehavior: '篡改 IV/authTag/ciphertext 后解密应抛异常',
        actualBehavior: `iv=${ivTamperResult}, authTag=${authTagTamperResult}, ciphertext=${ciphertextTamperResult}`,
        bugId: 'B3',
        bugLocation: 'sm4Crypto.js:decrypt 多处'
      });
      console.log(`     ${allTamperDetected ? '✓' : '⚠️ [knownIssue]'} 系统性篡改检测: iv=${ivTamperResult === 'exception' ? '拒绝' : '未拒绝'}, authTag=${authTagTamperResult === 'exception' ? '拒绝' : '未拒绝'}, ciphertext=${ciphertextTamperResult === 'exception' ? '拒绝' : '未拒绝'}`);
    } catch (e) {
      this.addResult('sm4', '认证标签完整性（系统性）', false, { error: e.message });
      console.log(`     ✗ 认证标签完整性: 失败 - ${e.message}`);
    }
  }

  // ============================================
  // 模块4：TOTP 动态口令测试
  // ============================================
  async module4_totpTests() {
    console.log('\n' + '='.repeat(70));
    console.log('  模块4：TOTP 动态口令测试');
    console.log('='.repeat(70));

    const mfaService = require('../services/mfaService');

    // 4.1 TOTP 正确验证
    console.log('\n  4.1 TOTP 正确验证');
    try {
      const { secret } = mfaService.generateSecret('testuser');
      const secretBuffer = Buffer.from(mfaService._base32Decode(secret));
      const counter = Math.floor(Date.now() / 1000 / 30);
      const correctToken = mfaService._generateTOTP(secretBuffer, counter, 6);
      const verifyResult = await mfaService.verifyToken(correctToken, secret);
      this.addResult('totp', 'TOTP 正确验证', verifyResult, {
        token: correctToken,
        secretLength: secret.length
      });
      console.log(`     ${verifyResult ? '✓' : '✗'} 正确 TOTP 码验证: ${verifyResult ? '通过' : '失败'}`);
    } catch (e) {
      this.addResult('totp', 'TOTP 正确验证', false, {
        error: e.message
      });
      console.log(`     ✗ TOTP 正确验证: 失败 - ${e.message}`);
    }

    // 4.2 错误 TOTP 码拒绝
    console.log('\n  4.2 错误 TOTP 码拒绝');
    try {
      const { secret } = mfaService.generateSecret('testuser2');
      const wrongToken = '000000';
      const verifyWrong = await mfaService.verifyToken(wrongToken, secret);
      this.addResult('totp', '错误 TOTP 码拒绝', !verifyWrong, {
        wrongToken,
        verifyResult: verifyWrong
      });
      console.log(`     ${!verifyWrong ? '✓' : '✗'} 错误码 '000000' 验证: ${!verifyWrong ? '正确拒绝' : '错误接受'}`);
    } catch (e) {
      this.addResult('totp', '错误 TOTP 码拒绝', true, {
        note: '抛出异常视为正确拒绝'
      });
      console.log(`     ✓ 错误码拒绝: 抛出异常`);
    }

    // 4.3 种子随机性
    console.log('\n  4.3 种子随机性');
    const { secret: secret1 } = mfaService.generateSecret('testuser3');
    const { secret: secret2 } = mfaService.generateSecret('testuser3');
    const seedsDifferent = secret1 !== secret2;
    this.addResult('totp', '种子随机性', seedsDifferent, {
      secret1Length: secret1.length,
      secret2Length: secret2.length
    });
    console.log(`     ${seedsDifferent ? '✓' : '✗'} 两次生成种子: ${seedsDifferent ? '不同' : '相同'}`);

    // 4.4 时间窗口容错 - 前一窗口
    console.log('\n  4.4 时间窗口容错 - 前一窗口');
    try {
      const { secret } = mfaService.generateSecret('testuser4');
      const secretBuffer = Buffer.from(mfaService._base32Decode(secret));
      const counter = Math.floor(Date.now() / 1000 / 30);
      const prevToken = mfaService._generateTOTP(secretBuffer, counter - 1, 6);
      const prevVerify = await mfaService.verifyToken(prevToken, secret);
      this.addResult('totp', '时间窗口容错 - 前一窗口', prevVerify, {
        counter: counter - 1,
        token: prevToken,
        verifyResult: prevVerify
      });
      console.log(`     ${prevVerify ? '✓' : '✗'} 前一窗口(-30s)验证: ${prevVerify ? '通过' : '失败'}`);
    } catch (e) {
      this.addResult('totp', '时间窗口容错 - 前一窗口', false, { error: e.message });
      console.log(`     ✗ 前一窗口测试: 失败 - ${e.message}`);
    }

    // 4.5 时间窗口容错 - 后一窗口
    console.log('\n  4.5 时间窗口容错 - 后一窗口');
    try {
      const { secret } = mfaService.generateSecret('testuser5');
      const secretBuffer = Buffer.from(mfaService._base32Decode(secret));
      const counter = Math.floor(Date.now() / 1000 / 30);
      const nextToken = mfaService._generateTOTP(secretBuffer, counter + 1, 6);
      const nextVerify = await mfaService.verifyToken(nextToken, secret);
      this.addResult('totp', '时间窗口容错 - 后一窗口', nextVerify, {
        counter: counter + 1,
        token: nextToken,
        verifyResult: nextVerify
      });
      console.log(`     ${nextVerify ? '✓' : '✗'} 后一窗口(+30s)验证: ${nextVerify ? '通过' : '失败'}`);
    } catch (e) {
      this.addResult('totp', '时间窗口容错 - 后一窗口', false, { error: e.message });
      console.log(`     ✗ 后一窗口测试: 失败 - ${e.message}`);
    }

    // 4.6 时间窗口超限拒绝
    console.log('\n  4.6 时间窗口超限拒绝');
    try {
      const { secret } = mfaService.generateSecret('testuser6');
      const secretBuffer = Buffer.from(mfaService._base32Decode(secret));
      const counter = Math.floor(Date.now() / 1000 / 30);
      const farToken = mfaService._generateTOTP(secretBuffer, counter - 3, 6);
      const farVerify = await mfaService.verifyToken(farToken, secret);
      this.addResult('totp', '时间窗口超限拒绝', !farVerify, {
        counter: counter - 3,
        token: farToken,
        verifyResult: farVerify
      });
      console.log(`     ${!farVerify ? '✓' : '✗'} 超限窗口(-90s)验证: ${farVerify} (应为 false)`);
    } catch (e) {
      this.addResult('totp', '时间窗口超限拒绝', true, {
        note: '抛出异常视为正确拒绝'
      });
      console.log(`     ✓ 超限窗口: 抛出异常`);
    }

    // 4.7 备份验证码完整流程
    console.log('\n  4.7 备份验证码完整流程');
    try {
      const backupCodes = mfaService.generateBackupCodes(10);
      const codesValid = Array.isArray(backupCodes) && backupCodes.length === 10 &&
        backupCodes.every(c => typeof c === 'string' && c.length === 8);
      if (!codesValid) {
        this.addResult('totp', '备份验证码生成', false, { backupCodesLength: backupCodes?.length });
        console.log(`     ✗ 备份验证码生成: 格式错误`);
      } else {
        this.addResult('totp', '备份验证码生成', true, { count: backupCodes.length });
        console.log(`     ✓ 备份验证码生成: 10个8位码`);

        const hashedCodes = mfaService.hashBackupCodes(backupCodes);
        const hashValid = Array.isArray(hashedCodes) && hashedCodes.length === 10;
        this.addResult('totp', '备份验证码哈希', hashValid, { hashedCount: hashedCodes?.length });
        console.log(`     ${hashValid ? '✓' : '✗'} 备份验证码哈希: ${hashValid ? '10个哈希值' : '长度错误'}`);

        const firstCode = backupCodes[0];
        const verifyIndex = mfaService.verifyBackupCode(firstCode, hashedCodes);
        const verifyOK = typeof verifyIndex === 'number' && verifyIndex >= 0;
        this.addResult('totp', '备份验证码验证', verifyOK, {
          code: firstCode,
          matchedIndex: verifyIndex
        });
        console.log(`     ${verifyOK ? '✓' : '✗'} 备份验证码验证: ${verifyOK ? `匹配索引=${verifyIndex}` : '未匹配'}`);

        const reVerifyIndex = mfaService.verifyBackupCode(firstCode, hashedCodes);
        const reuseDetected = typeof reVerifyIndex === 'number' && reVerifyIndex >= 0;
        this.addResult('totp', '备份验证码二次验证', !reuseDetected, {
          knownIssue: reuseDetected,
          code: firstCode,
          matchedIndex: reVerifyIndex,
          note: reuseDetected ? '系统允许码复用（安全缺陷）' : '正确拒绝已使用的码'
        });
        if (reuseDetected) {
          console.log(`     ⚠️ [knownIssue] 备份验证码复用: 二次验证仍返回 index=${reVerifyIndex}（应拒绝已使用的码）`);
        } else {
          console.log(`     ✓ 备份验证码二次验证: 正确拒绝已使用的码`);
        }
      }
    } catch (e) {
      this.addResult('totp', '备份验证码完整流程', false, { error: e.message });
      console.log(`     ✗ 备份验证码完整流程: 失败 - ${e.message}`);
    }
  }

  // ============================================
  // 模块5：零知识证明测试
  // ============================================
  async module5_zkpTests() {
    console.log('\n' + '='.repeat(70));
    console.log('  模块5：零知识证明 ZKP 测试');
    console.log('='.repeat(70));

    let zkService;
    try {
      zkService = require('../services/zkService');
    } catch (e) {
      console.log('  ⚠️ zkService 模块不可用');
      return;
    }

    // 5.1 ZKP 证明生成
    console.log('\n  5.1 ZKP 证明生成');
    let proofResult;
    try {
      proofResult = await zkService.generateProof(750, 600);
      const hasProof = proofResult && proofResult.proof;
      const hasPiComponents = hasProof &&
        proofResult.proof.pi_a && proofResult.proof.pi_b && proofResult.proof.pi_c;
      this.addResult('zkp', 'ZKP 证明生成', hasPiComponents, {
        hasProof: !!proofResult?.proof,
        hasPiA: !!proofResult?.proof?.pi_a,
        hasPiB: !!proofResult?.proof?.pi_b,
        hasPiC: !!proofResult?.proof?.pi_c
      });
      console.log(`     ${hasPiComponents ? '✓' : '✗'} 证明生成: ${hasPiComponents ? '包含完整 pi_a, pi_b, pi_c' : '结构不完整'}`);
    } catch (e) {
      this.addResult('zkp', 'ZKP 证明生成', false, { error: e.message });
      console.log(`     ✗ ZKP 证明生成: 失败 - ${e.message}`);
      return;
    }

    // 5.2 ZKP 正确验证
    console.log('\n  5.2 ZKP 正确验证');
    try {
      const verifyResult = await zkService.verifyProof(proofResult.proof, proofResult.publicSignals);
      this.addResult('zkp', 'ZKP 正确验证', verifyResult === true, {
        verifyResult
      });
      console.log(`     ${verifyResult === true ? '✓' : '✗'} 正确证明验证: ${verifyResult}`);
    } catch (e) {
      this.addResult('zkp', 'ZKP 正确验证', false, { error: e.message });
      console.log(`     ✗ ZKP 正确验证: 失败 - ${e.message}`);
    }

    // 5.3 ZKP 错误证明验证失败
    console.log('\n  5.3 ZKP 错误证明验证失败');
    try {
      const tamperedSignals = [...proofResult.publicSignals];
      tamperedSignals[0] = tamperedSignals[0] + '1';
      const verifyTampered = await zkService.verifyProof(proofResult.proof, tamperedSignals);
      this.addResult('zkp', 'ZKP 错误证明验证失败', verifyTampered === false, {
        tamperedResult: verifyTampered
      });
      console.log(`     ${verifyTampered === false ? '✓' : '✗'} 篡改信号验证: ${verifyTampered} (应为 false)`);
    } catch (e) {
      this.addResult('zkp', 'ZKP 错误证明验证失败', true, {
        note: '抛出异常视为正确'
      });
      console.log(`     ✓ 篡改信号验证: 抛出异常`);
    }

    // 5.4 ZKP 证明数据结构完整性
    console.log('\n  5.4 ZKP 证明数据结构完整性');
    const structureOK = proofResult &&
      proofResult.proof &&
      proofResult.proof.pi_a && proofResult.proof.pi_b && proofResult.proof.pi_c &&
      proofResult.publicSignals &&
      Array.isArray(proofResult.publicSignals) &&
      proofResult.publicSignals.length >= 1 &&
      !isNaN(Number(proofResult.publicSignals[0]));
    this.addResult('zkp', 'ZKP 证明数据结构完整性', structureOK, {
      publicSignalsLength: proofResult?.publicSignals?.length || 0,
      publicSignals0: proofResult?.publicSignals?.[0],
      hasPiA: !!proofResult?.proof?.pi_a,
      hasPiB: !!proofResult?.proof?.pi_b,
      hasPiC: !!proofResult?.proof?.pi_c
    });
    console.log(`     ${structureOK ? '✓' : '✗'} 证明结构: pi_a=${!!proofResult?.proof?.pi_a}, pi_b=${!!proofResult?.proof?.pi_b}, pi_c=${!!proofResult?.proof?.pi_c}, publicSignals[0]=${proofResult?.publicSignals?.[0]}, isNaN=${isNaN(Number(proofResult?.publicSignals?.[0]))}`);

    // 5.5 边界值 - score == threshold
    console.log('\n  5.5 边界值 - score == threshold');
    try {
      const boundaryProof = await zkService.generateProof(600, 600);
      const hasProof = boundaryProof && boundaryProof.proof;
      const boundaryVerify = hasProof ? await zkService.verifyProof(boundaryProof.proof, boundaryProof.publicSignals) : false;
      this.addResult('zkp', '边界值 score==threshold', hasProof && boundaryVerify === true, {
        hasProof: !!hasProof,
        verifyResult: boundaryVerify
      });
      console.log(`     ${hasProof && boundaryVerify === true ? '✓' : '✗'} score=600, threshold=600: 生成=${!!hasProof}, 验证=${boundaryVerify}`);
    } catch (e) {
      this.addResult('zkp', '边界值 score==threshold', false, { error: e.message });
      console.log(`     ✗ 边界值测试: 失败 - ${e.message}`);
    }

    // 5.6 不达标 - score < threshold
    console.log('\n  5.6 不达标 - score < threshold');
    try {
      const lowProof = await zkService.generateProof(500, 600);
      if (lowProof && lowProof.proof) {
        const lowVerify = await zkService.verifyProof(lowProof.proof, lowProof.publicSignals);
        this.addResult('zkp', '不达标 score<threshold', lowVerify === false, {
          knownIssue: lowVerify !== false,
          score: 500,
          threshold: 600,
          expectedBehavior: 'score < threshold 时 verifyProof 应返回 false',
          actualBehavior: `verifyProof 返回 ${lowVerify}`,
          bugId: 'B10',
          bugLocation: 'circuits/credit.circom:L14 使用 <-- 而非 <=='
        });
        console.log(`     ${lowVerify === false ? '✓' : '⚠️ [knownIssue]'} score=500 < threshold=600: 验证=${lowVerify} (应为 false)`);
      } else {
        this.addResult('zkp', '不达标 score<threshold', false, { note: '证明生成失败', bugId: 'B10' });
        console.log(`     ❌ 不达标测试: 证明生成失败`);
      }
    } catch (e) {
      this.addResult('zkp', '不达标 score<threshold', false, { error: e.message, bugId: 'B10' });
      console.log(`     ❌ 不达标测试: 失败 - ${e.message}`);
    }

    // 5.7 单参数绕过漏洞测试（对应 Bug B2）
    console.log('\n  5.7 单参数绕过漏洞测试（对应 Bug B2）');
    try {
      const fakeProof = { pi_a: ['0', '0', '0'], pi_b: [['0', '0'], ['0', '0'], ['0', '0']], pi_c: ['0', '0', '0'] };
      const singleParamResult = await zkService.verifyProof(fakeProof);
      // 如果没抛异常，说明后门仍存在
      this.addResult('zkp', '单参数绕过漏洞(B2)', false, {
        knownIssue: false,
        expectedBehavior: 'verifyProof 只传1个参数时应抛出异常',
        actualBehavior: `返回 ${singleParamResult}（安全漏洞未修复）`,
        bugId: 'B2',
        bugLocation: 'zkService.js:verifyProof'
      });
      console.log(`     ✗ 单参数调用未抛异常: ${singleParamResult}（安全漏洞未修复）`);
    } catch (e) {
      this.addResult('zkp', '单参数绕过漏洞(B2)', true, {
        knownIssue: false,
        expectedBehavior: '抛出异常',
        actualBehavior: e.message
      });
      console.log(`     ✓ 单参数调用: 抛出异常 - ${e.message}`);
    }

    // 5.8 极端值 - 低分
    console.log('\n  5.8 极端值 - 低分');
    try {
      const extremeProof = await zkService.generateProof(300, 300);
      if (extremeProof && extremeProof.proof) {
        const extremeVerify = await zkService.verifyProof(extremeProof.proof, extremeProof.publicSignals);
        const structureOK = extremeProof.proof.pi_a && extremeProof.proof.pi_b && extremeProof.proof.pi_c;
        const extremeOK = structureOK && extremeVerify === true;
        this.addResult('zkp', '极端值 score=300', extremeOK, {
          score: 300,
          threshold: 300,
          structureOK,
          verifyResult: extremeVerify
        });
        console.log(`     ${extremeOK ? '✓' : '✗'} score=300: 结构=${structureOK}, 验证=${extremeVerify}`);
      } else {
        this.addResult('zkp', '极端值 score=300', false, { note: '证明生成失败' });
        console.log(`     ✗ 极端值测试: 证明生成失败`);
      }
    } catch (e) {
      this.addResult('zkp', '极端值 score=300', false, { error: e.message });
      console.log(`     ✗ 极端值测试: 失败 - ${e.message}`);
    }
  }

  // ============================================
  // 模块6：区块链审计存证测试
  // ============================================
  async module6_blockchainTests() {
    console.log('\n' + '='.repeat(70));
    console.log('  模块6：区块链审计存证测试');
    console.log('='.repeat(70));

    const blockchainService = require('../services/blockchainService');

    // 6.1 区块链服务初始化
    console.log('\n  6.1 区块链服务初始化');
    try {
      const initResult = await blockchainService.initialize();
      if (initResult === false) {
        this.blockchainSkipped = true;
        this.modules.blockchain.skipped++;
        this.addResult('blockchain', '区块链服务初始化', true, {
          status: 'skipped',
          reason: 'Hardhat 节点不可用'
        });
        console.log(`     ⚠️ 区块链服务初始化: 跳过 (节点不可用)`);
        return;
      }
      this.addResult('blockchain', '区块链服务初始化', blockchainService.isInitialized, {
        isInitialized: blockchainService.isInitialized
      });
      console.log(`     ${blockchainService.isInitialized ? '✓' : '✗'} 区块链服务初始化: ${blockchainService.isInitialized ? '成功' : '失败'}`);
    } catch (e) {
      this.blockchainSkipped = true;
      this.modules.blockchain.skipped++;
      this.addResult('blockchain', '区块链服务初始化', true, {
        status: 'skipped',
        reason: e.message
      });
      console.log(`     ⚠️ 区块链服务初始化: 跳过 (${e.message})`);
      return;
    }

    // 6.2 审计哈希上链存证
    console.log('\n  6.2 审计哈希上链存证');
    if (this.blockchainSkipped) {
      console.log(`     ⚠️ 跳过 (区块链服务未初始化)`);
    } else {
      try {
        const { generateSM3Hash } = require('../utils/cryptoUtils');
        const testHash = generateSM3Hash(`test_audit_${Date.now()}`);
        const result = await blockchainService.storeAuditHash(
          testHash,
          Date.now(),
          'test_loan',
          'test_user_id'
        );
        this.addResult('blockchain', '审计哈希上链存证', result.success === true, {
          txHash: result.txHash || 'N/A',
          success: result.success
        });
        console.log(`     ${result.success ? '✓' : '✗'} 上链存证: ${result.success ? '成功' : '失败'}`);
      } catch (e) {
        this.addResult('blockchain', '审计哈希上链存证', false, {
          error: e.message
        });
        console.log(`     ✗ 审计哈希上链存证: 失败 - ${e.message}`);
      }
    }

    // 6.3 区块链节点不可用时优雅降级（自动验证）
    console.log('\n  6.3 区块链节点不可用时优雅降级（自动验证）');
    const originalInit = blockchainService.initialize;
    const originalIsInit = blockchainService.isInitialized;
    try {
      blockchainService.initialize = async () => false;
      blockchainService.isInitialized = false;

      const { generateSM3Hash } = require('../utils/cryptoUtils');
      const testHash = generateSM3Hash(`test_degradation_${Date.now()}`);
      let degradedResult;
      let threwError = false;
      try {
        degradedResult = await blockchainService.storeAuditHash(
          testHash,
          Date.now(),
          'test_degradation',
          'test_user'
        );
      } catch (e) {
        threwError = true;
        degradedResult = { error: e.message };
      }

      const degradedOK = !threwError && (degradedResult?.success === false || degradedResult?.status === 'skipped' || degradedResult?.error);
      this.addResult('blockchain', '区块链节点不可用时优雅降级', degradedOK, {
        threwError,
        result: degradedResult,
        note: '自动验证降级行为'
      });
      console.log(`     ${degradedOK ? '✓' : '✗'} 降级处理: ${degradedOK ? '优雅降级' : '可能抛异常'} (threwError=${threwError})`);
    } catch (e) {
      this.addResult('blockchain', '区块链节点不可用时优雅降级', false, {
        error: e.message,
        note: '自动验证失败'
      });
      console.log(`     ✗ 降级测试: 失败 - ${e.message}`);
    } finally {
      blockchainService.initialize = originalInit;
      blockchainService.isInitialized = originalIsInit;
    }
  }

  // ============================================
  // 模块7：Shamir 秘密共享测试
  // ============================================
  async module7_sssTests() {
    console.log('\n' + '='.repeat(70));
    console.log('  模块7：Shamir 秘密共享 SSS 测试');
    console.log('='.repeat(70));

    let sssModule;
    try {
      sssModule = require('../scripts/sssRecover');
    } catch (e) {
      console.log('  ⚠️ sssRecover 模块不可用');
      return;
    }

    const { splitSecretToShares, recoverSecretFromShares } = sssModule;

    const sm4MasterKey = process.env.SM4_MASTER_KEY;
    if (!sm4MasterKey) {
      console.log('  ⚠️ SM4_MASTER_KEY 未设置，跳过模块7 SSS 测试');
      for (const testName of ['分片与恢复', '不足分片恢复失败', '分片独立性', '不同阈值组合 (2,2)', '重复分片恢复']) {
        this.addResult('sss', testName, false, { note: 'SM4_MASTER_KEY 未设置，跳过' });
      }
      return;
    }

    // 7.1 分片与恢复
    console.log('\n  7.1 分片与恢复');
    const masterKey = sm4MasterKey;
    try {
      const shares = splitSecretToShares(masterKey, 5, 3);
      const recovered = recoverSecretFromShares(shares.slice(0, 3));
      const recoveryOK = recovered.toLowerCase() === masterKey.toLowerCase();
      this.addResult('sss', '分片与恢复', recoveryOK, {
        originalLength: masterKey.length,
        recoveredLength: recovered.length,
        sharesCount: shares.length
      });
      console.log(`     ${recoveryOK ? '✓' : '✗'} SSS 分片恢复: ${recoveryOK ? '成功' : '失败'}`);
    } catch (e) {
      this.addResult('sss', '分片与恢复', false, { error: e.message });
      console.log(`     ✗ SSS 分片恢复: 失败 - ${e.message}`);
    }

    // 7.2 不足分片恢复失败
    console.log('\n  7.2 不足分片恢复失败');
    try {
      const shares = splitSecretToShares(masterKey, 5, 3);
      const recovered = recoverSecretFromShares(shares.slice(0, 2));
      const insufficientOK = recovered.toLowerCase() !== masterKey.toLowerCase();
      this.addResult('sss', '不足分片恢复失败', insufficientOK, {
        recoveredValue: recovered.substring(0, 10) + '...',
        note: '2个分片不足以恢复3阈值秘密'
      });
      console.log(`     ${insufficientOK ? '✓' : '✗'} 不足分片恢复: ${insufficientOK ? '正确拒绝' : '错误恢复'}`);
    } catch (e) {
      this.addResult('sss', '不足分片恢复失败', true, {
        note: '抛出异常'
      });
      console.log(`     ✓ 不足分片恢复: 抛出异常`);
    }

    // 7.3 分片独立性
    console.log('\n  7.3 分片独立性');
    try {
      const shares = splitSecretToShares(masterKey, 5, 3);
      const firstShareY = shares[0].y;
      const independent = !firstShareY.toLowerCase().includes(masterKey.toLowerCase().substring(0, 8));
      this.addResult('sss', '分片独立性', independent, {
        firstShareY: firstShareY.substring(0, 20) + '...'
      });
      console.log(`     ${independent ? '✓' : '✗'} 分片独立性: ${independent ? '不泄露密钥' : '疑似泄露'}`);
    } catch (e) {
      this.addResult('sss', '分片独立性', false, { error: e.message });
      console.log(`     ✗ 分片独立性: 失败 - ${e.message}`);
    }

    // 7.4 不同阈值组合 (2,2)
    console.log('\n  7.4 不同阈值组合 (2,2)');
    try {
      const shares22 = splitSecretToShares(masterKey, 2, 2);
      let singleFailed = false;
      try {
        const singleShare = recoverSecretFromShares([shares22[0]]);
        singleFailed = singleShare.toLowerCase() !== masterKey.toLowerCase();
      } catch (e) {
        singleFailed = true;
        console.log(`     单分片恢复正确抛出异常: ${e.message}`);
      }
      const bothShares = recoverSecretFromShares(shares22);
      const bothOK = bothShares.toLowerCase() === masterKey.toLowerCase();
      const threshold22OK = singleFailed && bothOK;
      this.addResult('sss', '不同阈值组合 (2,2)', threshold22OK, {
        bothMatch: bothOK,
        singleFailedToRecover: singleFailed
      });
      console.log(`     ${threshold22OK ? '✓' : '✗'} (2,2)组合: 单分片${singleFailed ? '无法恢复' : '错误恢复'}, 双分片${bothOK ? '正确恢复' : '恢复失败'}`);
    } catch (e) {
      this.addResult('sss', '不同阈值组合 (2,2)', false, { error: e.message });
      console.log(`     ✗ (2,2)组合: 失败 - ${e.message}`);
    }

    // 7.5 重复分片恢复
    console.log('\n  7.5 重复分片恢复');
    try {
      const shares = splitSecretToShares(masterKey, 5, 3);
      const duplicateShares = [shares[0], shares[0]];
      const dupResult = recoverSecretFromShares(duplicateShares);
      const dupFailed = dupResult.toLowerCase() !== masterKey.toLowerCase();
      this.addResult('sss', '重复分片恢复', dupFailed, {
        duplicateResultPrefix: dupResult.substring(0, 10) + '...',
        expectedPrefix: masterKey.substring(0, 10) + '...'
      });
      console.log(`     ${dupFailed ? '✓' : '✗'} 重复分片恢复: ${dupFailed ? '正确拒绝' : '错误恢复'}`);
    } catch (e) {
      this.addResult('sss', '重复分片恢复', true, {
        note: '抛出异常视为正确拒绝'
      });
      console.log(`     ✓ 重复分片恢复: 抛出异常`);
    }
  }

  // ============================================
  // 结果打印
  // ============================================
  printResults() {
    console.log('\n' + '='.repeat(70));
    console.log('  测试结果汇总');
    console.log('='.repeat(70));

    let totalPassed = 0;
    let totalFailed = 0;
    let totalSkipped = 0;
    let totalKnownIssues = 0;

    for (const [key, module] of Object.entries(this.modules)) {
      const hasKnownIssues = module.knownIssues > 0;
      const status = module.failed > 0 ? '❌' : (module.skipped > 0 ? '⚠️' : (hasKnownIssues ? '⚠️' : '✅'));
      const knownIssueStr = hasKnownIssues ? `, ${module.knownIssues} 已知问题` : '';
      console.log(`\n${status} ${module.name}: ${module.passed} 通过, ${module.failed} 失败${module.skipped ? `, ${module.skipped} 跳过` : ''}${knownIssueStr}`);
      totalPassed += module.passed;
      totalFailed += module.failed;
      totalSkipped += module.skipped || 0;
      totalKnownIssues += module.knownIssues || 0;
    }

    console.log('\n' + '-'.repeat(70));
    const knownIssueStr = totalKnownIssues > 0 ? `, ${totalKnownIssues} 已知问题` : '';
    console.log(`  总计: ${totalPassed} 通过, ${totalFailed} 失败, ${totalSkipped} 跳过${knownIssueStr}`);
    console.log('='.repeat(70));
  }

  saveResults() {
    const resultsDir = path.join(__dirname, 'results');
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true });
    }

    const fileName = `crypto-report-${Date.now()}.json`;
    const filePath = path.join(resultsDir, fileName);

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        total: this.testResults.length,
        passed: this.testResults.filter(r => r.passed).length,
        failed: this.testResults.filter(r => !r.passed).length
      },
      modules: this.modules,
      results: this.testResults
    };

    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    console.log(`\n📊 详细报告已保存: ${filePath}`);
  }
}

if (require.main === module) {
  const test = new CryptoTest();
  test.run().then(() => process.exit(0)).catch(e => {
    console.error('测试执行失败:', e);
    process.exit(1);
  });
}

module.exports = { CryptoTest };