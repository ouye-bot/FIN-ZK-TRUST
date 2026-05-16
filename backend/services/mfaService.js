const otplib = require('otplib');
const { sm4 } = require('sm-crypto');
const { generateSM3Hash } = require('../utils/cryptoUtils');
const logger = require('../utils/logger');
const crypto = require('crypto');

class MfaService {
  generateSecret(username) {
    // 生成 20 字节随机密钥，编码为 Base32
    const randomBytes = crypto.randomBytes(20);
    const secret = this._base32Encode(randomBytes);
    const otpauthUrl = `otpauth://totp/FinZkTrust:${encodeURIComponent(username)}?secret=${secret}&issuer=FinZkTrust`;
    return { secret, otpauthUrl };
  }

  // 编码 Buffer 为 Base32 字符串（RFC 4648）
  _base32Encode(buffer) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    let bits = 0;
    let value = 0;

    for (let i = 0; i < buffer.length; i++) {
      value = (value << 8) | buffer[i];
      bits += 8;

      while (bits >= 5) {
        bits -= 5;
        result += alphabet[(value >> bits) & 0x1f];
      }
    }

    if (bits > 0) {
      value <<= (5 - bits);
      result += alphabet[value & 0x1f];
    }

    return result;
  }

  async verifyToken(token, secret) {
    try {
      // TOTP 参数
      const period = 30;       // 30秒一个窗口
      const digits = 6;        // 6位验证码

      // 当前 Unix 时间（秒）
      const now = Math.floor(Date.now() / 1000);
      
      // 将 Base32 种子解码为 Buffer
      const secretBuffer = Buffer.from(this._base32Decode(secret));

      // 检查当前窗口及前后各一个窗口
      for (let window = -1; window <= 1; window++) {
        const counter = Math.floor(now / period) + window;
        const otp = this._generateTOTP(secretBuffer, counter, digits);
        if (otp === token) {
          return true;
        }
      }
      return false;
    } catch (error) {
      logger.error('TOTP verification error:', { message: error.message, stack: error.stack });
      return false;
    }
  }

  // 解码 Base32 字符串（RFC 4648）
  _base32Decode(base32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = base32.replace(/[^A-Z2-7]/g, '').toUpperCase();
    let bits = 0;
    let value = 0;
    const result = [];
    for (let i = 0; i < cleaned.length; i++) {
      const index = alphabet.indexOf(cleaned.charAt(i));
      if (index === -1) throw new Error('Invalid Base32 character');
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        result.push((value >> bits) & 0xff);
      }
    }
    return result;
  }

  // 根据 counter 生成指定位数的 TOTP
  _generateTOTP(secretBuffer, counter, digits) {
    // 将 counter 转为 8 字节大端 Buffer
    const counterBuf = Buffer.alloc(8);
    counterBuf.writeBigUInt64BE(BigInt(counter));

    // HMAC-SHA1
    const hmac = crypto.createHmac('sha1', secretBuffer);
    hmac.update(counterBuf);
    const hmacResult = hmac.digest();

    // 动态截取（Dynamic Truncation）
    const offset = hmacResult[hmacResult.length - 1] & 0x0f;
    const binary = 
      ((hmacResult[offset] & 0x7f) << 24) | 
      ((hmacResult[offset + 1] & 0xff) << 16) | 
      ((hmacResult[offset + 2] & 0xff) << 8) | 
      (hmacResult[offset + 3] & 0xff);

    const otp = binary % (10 ** digits);
    return otp.toString().padStart(digits, '0');
  }

  generateBackupCodes(count = 10) {
    const codes = [];
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < count; i++) {
      let code = '';
      for (let j = 0; j < 8; j++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      codes.push(code);
    }
    return codes;
  }

  getSm4Key() {
    const key = process.env.SM4_MASTER_KEY;
    if (!key) {
      logger.warning('SM4_MASTER_KEY not set, using default test key');
      return '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d';
    }
    return key;
  }

  encryptSecret(secret) {
    const key = this.getSm4Key();
    const ivHex = Array.from(Buffer.from(crypto.randomBytes(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    const plaintextHex = Buffer.from(secret, 'utf8').toString('hex');
    const encrypted = sm4.encrypt(plaintextHex, key, { iv: ivHex, mode: 'cbc' });
    return `${ivHex}:${encrypted}`;
  }

  decryptSecret(encryptedSecret) {
    try {
      // 新格式：iv:ciphertext
      const parts = encryptedSecret.split(':');
      if (parts.length === 2) {
        const key = this.getSm4Key();
        const ivHex = parts[0];
        const ciphertextHex = parts[1];
        const decrypted = sm4.decrypt(ciphertextHex, key, { iv: ivHex, mode: 'cbc' });
        return Buffer.from(decrypted, 'hex').toString('utf8');
      }
      
      // 旧格式：直接存储的密文，不加密或用旧方案
      logger.warning('MFA secret in old format, returning as-is', { format: 'old' });
      return encryptedSecret;
    } catch (error) {
      logger.error('MFA secret decryption failed', { error: error.message });
      // 兼容处理：如果解密失败，尝试原样返回
      return encryptedSecret;
    }
  }

  hashBackupCodes(codes) {
    return codes.map(code => generateSM3Hash(code));
  }

  verifyBackupCode(code, hashedCodes) {
    if (!hashedCodes || !Array.isArray(hashedCodes)) {
      return -1;
    }
    const codeHash = generateSM3Hash(code);
    const index = hashedCodes.findIndex(h => h === codeHash);
    return index;
  }
}

module.exports = new MfaService();