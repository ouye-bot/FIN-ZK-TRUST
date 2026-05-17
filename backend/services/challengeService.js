const crypto = require('crypto');
const { verifySM2Signature } = require('../utils/cryptoUtils');

const challengeStore = new Map();

const CHALLENGE_EXPIRY_MS = 5 * 60 * 1000;
const MAX_CHALLENGES = 1000;

const generateChallenge = (userId, operationType) => {
  if (challengeStore.size >= MAX_CHALLENGES) {
    const oldest = challengeStore.entries().next().value;
    if (oldest) {
      challengeStore.delete(oldest[0]);
    }
  }

  const challengeId = crypto.randomUUID();
  const challengeCode = crypto.randomBytes(32).toString('hex');

  challengeStore.set(challengeId, {
    challengeCode,
    userId,
    operationType,
    createdAt: Date.now(),
    used: false
  });

  return { challengeId, challengeCode };
};

const verifyChallenge = (challengeId, signature, publicKey) => {
  const challenge = challengeStore.get(challengeId);

  if (!challenge) {
    return { success: false, error: '挑战码不存在' };
  }

  const now = Date.now();
  if (now - challenge.createdAt > CHALLENGE_EXPIRY_MS) {
    challengeStore.delete(challengeId);
    return { success: false, error: '挑战码已过期' };
  }

  if (challenge.used) {
    return { success: false, error: '挑战码已使用' };
  }

  const isValid = verifySM2Signature(challenge.challengeCode, signature, publicKey);

  if (!isValid) {
    return { success: false, error: '签名验证失败' };
  }

  challenge.used = true;

  return { success: true, userId: challenge.userId, operationType: challenge.operationType };
};

const challengeCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, data] of challengeStore.entries()) {
    if (now - data.createdAt > CHALLENGE_EXPIRY_MS) {
      challengeStore.delete(id);
    }
  }
}, CHALLENGE_EXPIRY_MS);
challengeCleanupInterval.unref();

module.exports = {
  generateChallenge,
  verifyChallenge
};