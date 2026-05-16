const crypto = require('crypto');

const PRIME = 2n ** 256n - 189n;

function hexToBigInt(hex) {
  return BigInt('0x' + hex);
}

function bigIntToHex(n) {
  let hex = n.toString(16);
  if (hex.length % 2 !== 0) {
    hex = '0' + hex;
  }
  return hex;
}

function mod(a, p) {
  let res = a % p;
  return res >= 0n ? res : res + p;
}

function modInverse(a, p) {
  let oldR = a % p;
  let r = p;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;

  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }

  return mod(oldS, p);
}

function evaluatePolynomial(coefficients, x) {
  let result = 0n;
  let powerX = 1n;

  for (const coeff of coefficients) {
    result = mod(result + coeff * powerX, PRIME);
    powerX = mod(powerX * x, PRIME);
  }

  return result;
}

function splitSecretToShares(secretHex, totalShares, threshold) {
  const secret = hexToBigInt(secretHex);
  if (secret >= PRIME) {
    throw new Error('密钥太大，必须小于质数模数');
  }

  const coefficients = [secret];
  for (let i = 1; i < threshold; i++) {
    const randBytes = crypto.randomBytes(32);
    let coeff = BigInt('0x' + randBytes.toString('hex'));
    coeff = mod(coeff, PRIME - 1n) + 1n;
    coefficients.push(coeff);
  }

  const shares = [];
  for (let i = 1; i <= totalShares; i++) {
    const y = evaluatePolynomial(coefficients, BigInt(i));
    shares.push({
      x: i,
      y: bigIntToHex(y)
    });
  }

  return shares;
}

function recoverSecretFromShares(shares) {
  if (shares.length < 2) {
    throw new Error('需要至少2个分片来恢复密钥');
  }

  const points = shares.map(s => ({
    x: BigInt(s.x),
    y: hexToBigInt(s.y)
  }));

  let result = 0n;

  for (let i = 0; i < points.length; i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    let numerator = 1n;
    let denominator = 1n;

    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      const xj = points[j].x;
      numerator = mod(numerator * (0n - xj), PRIME);
      denominator = mod(denominator * (xi - xj), PRIME);
    }

    const invDenominator = modInverse(denominator, PRIME);
    const term = mod(mod(yi * numerator, PRIME) * invDenominator, PRIME);
    result = mod(result + term, PRIME);
  }

  return bigIntToHex(result);
}

function main() {
  const args = process.argv.slice(2);

  if (args[0] === 'split') {
    let secret, totalShares, threshold;

    const secretIndex = args.indexOf('--secret');
    if (secretIndex !== -1 && args[secretIndex + 1]) {
      secret = args[secretIndex + 1];
    } else {
      console.error('错误：必须指定 --secret <hex key>');
      process.exit(1);
    }

    const sharesIndex = args.indexOf('--shares');
    if (sharesIndex !== -1 && args[sharesIndex + 1]) {
      totalShares = parseInt(args[sharesIndex + 1]);
    } else {
      totalShares = 5;
    }

    const thresholdIndex = args.indexOf('--threshold');
    if (thresholdIndex !== -1 && args[thresholdIndex + 1]) {
      threshold = parseInt(args[thresholdIndex + 1]);
    } else {
      threshold = 3;
    }

    if (threshold < 2) {
      console.error('错误：阈值至少为2');
      process.exit(1);
    }
    if (totalShares < threshold) {
      console.error('错误：分片数必须大于等于阈值');
      process.exit(1);
    }

    console.log(`=== 生成 ${totalShares} 个分片，阈值为 ${threshold} ===`);
    const shares = splitSecretToShares(secret, totalShares, threshold);
    console.log('\n分片列表：');
    for (const share of shares) {
      console.log(`{ "x": ${share.x}, "y": "${share.y}" }`);
    }
    console.log('\n请安全保存所有分片！');
    console.log(`需要至少 ${threshold} 个分片才能恢复密钥`);

  } else if (args[0] === 'recover') {
    let sharesJSON;

    const sharesIndex = args.indexOf('--shares');
    if (sharesIndex !== -1 && args[sharesIndex + 1]) {
      try {
        sharesJSON = JSON.parse(args[sharesIndex + 1]);
      } catch (e) {
        console.error('错误：无法解析分片 JSON');
        process.exit(1);
      }
    } else {
      console.error('错误：必须指定 --shares <json>');
      process.exit(1);
    }

    if (!Array.isArray(sharesJSON)) {
      console.error('错误：分片必须是数组格式');
      process.exit(1);
    }

    console.log('=== 从分片恢复密钥 ===');
    console.log(`使用 ${sharesJSON.length} 个分片`);

    try {
      const recovered = recoverSecretFromShares(sharesJSON);
      console.log('\n恢复的密钥：');
      console.log(`SM4_MASTER_KEY=${recovered}`);
      console.log('\n建议：恢复后立即执行密钥轮换！');
    } catch (e) {
      console.error('恢复失败:', e.message);
      process.exit(1);
    }

  } else {
    console.log('用法：');
    console.log('  生成分片：node sssRecover.js split --secret <hex-key> --shares <num> --threshold <num>');
    console.log('  恢复密钥：node sssRecover.js recover --shares \'<json-array>\'');
    console.log('\n示例：');
    console.log('  node sssRecover.js split --secret 112233445566778899aabbccddeeff00 --shares 5 --threshold 3');
    console.log('  node sssRecover.js recover --shares \'[{"x":1,"y":"..."},{"x":2,"y":"..."},{"x":3,"y":"..."}\']');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  splitSecretToShares,
  recoverSecretFromShares
};
