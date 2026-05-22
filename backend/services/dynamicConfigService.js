const poolDao = require('../dao/poolDao');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const { execute } = require('../config/database');
const logger = require('../utils/logger');

const DEFAULTS = {
  LOAN_RATE_BY_SCORE: { 300: 13.8, 600: 10.0, 650: 8.0, 700: 6.0, 750: 4.0 },
  LOAN_LIMIT_BY_SCORE: { 600: 1000, 650: 2000, 700: 5000, 750: 10000, 800: 20000, 850: 50000 },
  CHALLENGE_THRESHOLD: { borrow: 5000, redeem: 10000 },
  COOLING_OFF_DAYS: 7,
  COOLING_OFF_RATIO: 0.5,
  PLATFORM_SPREAD: 0.02,
  MIN_INVEST: 100,
  MAX_INVEST: 100000,
  MIN_SCORE: 300,
  MAX_SCORE: 850
};

let poolHealthCache = null;
let poolHealthCacheTime = 0;
const POOL_HEALTH_TTL = 5000;

async function getPoolHealth() {
  const now = Date.now();
  if (poolHealthCache && (now - poolHealthCacheTime) < POOL_HEALTH_TTL) {
    return poolHealthCache;
  }

  try {
    const pool = await poolDao.getPool();
    if (!pool) {
      return { utilizationRate: 0, availableRatio: 1, overdueRate: 0, totalPool: 0 };
    }

    const totalPool = Number(pool.total_amount || 0);
    const available = Number(pool.available_amount || 0);
    const loaned = Number(pool.loaned_amount || 0);

    const utilizationRate = totalPool > 0 ? loaned / totalPool : 0;
    const availableRatio = totalPool > 0 ? available / totalPool : 1;

    let overdueRate = 0;
    try {
      const overdueCountResult = await execute(
        "SELECT COUNT(*) as cnt FROM transactions WHERE type = 'loan' AND status = 'overdue'"
      );
      const totalCountResult = await execute(
        "SELECT COUNT(*) as cnt FROM transactions WHERE type = 'loan' AND (status = 'pending' OR status = 'overdue')"
      );
      const overdueCount = overdueCountResult[0]?.cnt || 0;
      const totalCount = totalCountResult[0]?.cnt || 0;
      overdueRate = totalCount > 0 ? overdueCount / totalCount : 0;
    } catch (e) {
      logger.warning('查询逾期率失败，使用默认值0', { error: e.message });
    }

    const result = {
      utilizationRate: Math.round(utilizationRate * 10000) / 10000,
      availableRatio: Math.round(availableRatio * 10000) / 10000,
      overdueRate: Math.round(overdueRate * 10000) / 10000,
      totalPool,
      available,
      loaned
    };
    poolHealthCache = result;
    poolHealthCacheTime = now;
    return result;
  } catch (error) {
    logger.error('获取池健康度失败，使用默认值', { error: error.message });
    return { utilizationRate: 0, availableRatio: 1, overdueRate: 0, totalPool: 0 };
  }
}

async function getCreditScore(userId) {
  const user = await userDao.findById(userId);
  if (!user) throw new Error('用户不存在');
  return user.credit_score || 600;
}

async function updateCreditScore(userId, delta, reason, transactionId = null) {
  const { transaction } = require('../config/database');

  const newScore = await transaction(async (connection) => {
    // 使用 FOR UPDATE 锁定行，防止并发更新丢失
    const [rows] = await connection.execute(
      'SELECT credit_score FROM users WHERE id = ? FOR UPDATE', [userId]
    );
    if (rows.length === 0) throw new Error('用户不存在');

    // 解密当前信用分
    const creditScoreData = { credit_score: rows[0].credit_score };
    const { decryptFields } = require('../utils/sm4Crypto');
    await decryptFields('users', creditScoreData, userId, connection);
    const currentScore = Number(creditScoreData.credit_score) || 600;

    const computedScore = Math.max(DEFAULTS.MIN_SCORE, Math.min(DEFAULTS.MAX_SCORE, currentScore + delta));

    // 加密并写入新信用分
    const newScoreData = { credit_score: computedScore };
    const { encryptFields } = require('../utils/sm4Crypto');
    await encryptFields('users', newScoreData, userId, connection);
    await connection.execute('UPDATE users SET credit_score = ? WHERE id = ?', [newScoreData.credit_score, userId]);

    return computedScore;
  });

  const creditHistoryDao = require('../dao/creditHistoryDao');
  creditHistoryDao.create({
    user_id: parseInt(userId),
    score: newScore,
    change_amount: delta,
    reason,
    transaction_id: transactionId
  }).catch(err => logger.error('记录信用历史失败', { error: err.message }));

  return newScore;
}

function lookupByScore(score, table) {
  const scores = Object.keys(table).map(Number).sort((a, b) => b - a);
  for (const s of scores) {
    if (score >= s) return table[s];
  }
  return scores.length > 0 ? table[scores[scores.length - 1]] : 0;
}

async function getLoanRate(creditScore) {
  try {
    const baseRate = lookupByScore(creditScore, DEFAULTS.LOAN_RATE_BY_SCORE);
    const health = await getPoolHealth();

    const poolMultiplier = 1 + (1 - health.availableRatio) * 0.5;
    const finalRate = Math.min(baseRate * poolMultiplier, baseRate * 2.0);

    logger.info('动态借款利率计算', {
      creditScore,
      baseRate,
      availableRatio: health.availableRatio,
      poolMultiplier: poolMultiplier.toFixed(3),
      finalRate: finalRate.toFixed(2)
    });

    return finalRate;
  } catch (error) {
    logger.error('动态借款利率计算失败，使用静态值', { error: error.message });
    return lookupByScore(creditScore, DEFAULTS.LOAN_RATE_BY_SCORE);
  }
}

async function getLoanLimit(creditScore, userRisk) {
  try {
    const baseLimit = lookupByScore(creditScore, DEFAULTS.LOAN_LIMIT_BY_SCORE);

    let riskMultiplier;
    if (userRisk >= 80) riskMultiplier = 1.2;
    else if (userRisk >= 60) riskMultiplier = 1.0;
    else if (userRisk >= 40) riskMultiplier = 0.7;
    else riskMultiplier = 0.5;

    if (creditScore >= 700) {
      return Math.floor(baseLimit * riskMultiplier);
    }

    const health = await getPoolHealth();
    let poolMultiplier;
    if (health.availableRatio >= 0.6) poolMultiplier = 1.0;
    else if (health.availableRatio >= 0.4) poolMultiplier = 0.8;
    else poolMultiplier = 0.5;

    return Math.floor(baseLimit * riskMultiplier * poolMultiplier);
  } catch (error) {
    logger.error('动态借款限额计算失败，使用静态值', { error: error.message });
    return lookupByScore(creditScore, DEFAULTS.LOAN_LIMIT_BY_SCORE);
  }
}

function getChallengeThreshold(operationType, userRisk) {
  try {
    const baseThreshold = DEFAULTS.CHALLENGE_THRESHOLD[operationType] || 5000;

    let riskMultiplier;
    if (userRisk >= 80) riskMultiplier = 1.5;
    else if (userRisk >= 60) riskMultiplier = 1.0;
    else if (userRisk >= 40) riskMultiplier = 0.7;
    else riskMultiplier = 0.5;

    return Math.max(Math.floor(baseThreshold * riskMultiplier), 2000);
  } catch (error) {
    logger.error('动态挑战阈值计算失败，使用静态值', { error: error.message });
    return DEFAULTS.CHALLENGE_THRESHOLD[operationType] || 5000;
  }
}

function getCoolingOff(userRisk) {
  try {
    let days, ratio;
    if (userRisk >= 60) {
      days = 7;
      ratio = 0.5;
    } else if (userRisk >= 40) {
      days = 14;
      ratio = 0.3;
    } else {
      days = 21;
      ratio = 0.2;
    }
    return { days, ratio };
  } catch (error) {
    logger.error('动态冷静期计算失败，使用静态值', { error: error.message });
    return { days: DEFAULTS.COOLING_OFF_DAYS, ratio: DEFAULTS.COOLING_OFF_RATIO };
  }
}

async function getPlatformSpread() {
  try {
    const health = await getPoolHealth();

    let utilizationBonus = 0;
    if (health.utilizationRate > 0.8) utilizationBonus = 0.01;
    else if (health.utilizationRate > 0.6) utilizationBonus = 0.005;

    let overdueBonus = 0;
    if (health.overdueRate > 0.1) overdueBonus = 0.01;
    else if (health.overdueRate > 0.05) overdueBonus = 0.005;

    const spread = Math.min(DEFAULTS.PLATFORM_SPREAD + utilizationBonus + overdueBonus, 0.08);

    logger.info('动态平台利差计算', {
      utilizationRate: health.utilizationRate,
      overdueRate: health.overdueRate,
      utilizationBonus,
      overdueBonus,
      spread
    });

    return spread;
  } catch (error) {
    logger.error('动态平台利差计算失败，使用静态值', { error: error.message });
    return DEFAULTS.PLATFORM_SPREAD;
  }
}

async function getInvestLimit() {
  try {
    const health = await getPoolHealth();

    let maxInvest;
    if (health.availableRatio >= 0.6) maxInvest = 100000;
    else if (health.availableRatio >= 0.4) maxInvest = 50000;
    else maxInvest = 20000;

    return { minInvest: DEFAULTS.MIN_INVEST, maxInvest };
  } catch (error) {
    logger.error('动态出资限额计算失败，使用静态值', { error: error.message });
    return { minInvest: DEFAULTS.MIN_INVEST, maxInvest: DEFAULTS.MAX_INVEST };
  }
}

function getOverduePenaltyRate(overdueDays) {
  if (overdueDays <= 0) return 1.0;
  if (overdueDays <= 7) return 1.5;
  if (overdueDays <= 15) return 2.0;
  if (overdueDays <= 30) return 2.5;
  return 3.0;
}

module.exports = {
  getPoolHealth,
  getCreditScore,
  updateCreditScore,
  getLoanRate,
  getLoanLimit,
  getChallengeThreshold,
  getCoolingOff,
  getPlatformSpread,
  getInvestLimit,
  getOverduePenaltyRate,
  DEFAULTS,
  lookupByScore
};