const logger = require('../utils/logger');
const transactionDao = require('../dao/transactionDao');

const loginFailures = new Map();
const apiCallCounts = new Map();
const MAX_ENTRIES = 10000;

const detectLoginBruteForce = async (req) => {
  if (req.path !== '/api/v1/auth/login' || req.method !== 'POST') {
    return null;
  }

  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;

  if (loginFailures.size >= MAX_ENTRIES) {
    const oldestKey = loginFailures.keys().next().value;
    if (oldestKey) loginFailures.delete(oldestKey);
  }

  let entry = loginFailures.get(ip);
  if (!entry || now - entry.firstAttemptTime > windowMs) {
    entry = { count: 0, firstAttemptTime: now };
    loginFailures.set(ip, entry);
  }

  entry.count++;

  if (entry.count >= 5) {
    logger.warning('异常行为检测：短时多次登录失败', {
      rule: 'R1_BRUTE_FORCE',
      ip,
      loginAttempts: entry.count,
      windowMinutes: 5,
      correlationInfo: {
        ip,
        attempts: entry.count,
        timestamp: new Date().toISOString()
      }
    });
    return { blocked: true, message: '登录尝试过于频繁，请5分钟后再试' };
  }
  return null;
};

const detectLargeTransaction = async (req) => {
  if (req.path !== '/api/v1/loan/borrow' || req.method !== 'POST') {
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    return;
  }

  try {
    const loans = await transactionDao.findByUserId(userId, { type: 'loan', status: 'completed' });
    
    if (loans.length < 2) {
      return;
    }

    const totalAmount = loans.reduce((sum, loan) => sum + Number(loan.amount || 0), 0);
    const averageAmount = totalAmount / loans.length;
    const currentAmount = Number(req.body?.amount || 0);

    const ratio = currentAmount / averageAmount;
    
    if (ratio > 3) {
      logger.warning('异常行为检测：大额借款异常', {
        rule: 'R2_LARGE_TRANSACTION',
        userId,
        currentAmount,
        historicalAverage: averageAmount.toFixed(2),
        ratio: ratio.toFixed(2),
        correlationInfo: {
          userId,
          currentAmount,
          historicalAverage: averageAmount.toFixed(2),
          ratio: ratio.toFixed(2),
          timestamp: new Date().toISOString()
        }
      });
    }
  } catch (dbError) {
    logger.warning('R2 大额借款检测跳过：数据库查询失败', { 
      error: dbError.message,
      userId,
      correlationInfo: {
        userId,
        error: dbError.message,
        timestamp: new Date().toISOString()
      }
    });
    return;
  }
};

const detectHighFrequency = async (req) => {
  if (!req.path.startsWith('/api/v1/')) {
    return;
  }

  const userId = req.user?.id || req.ip || 'anonymous';
  const now = Date.now();
  const windowMs = 60 * 1000;

  if (apiCallCounts.size >= MAX_ENTRIES) {
    const oldestKey = apiCallCounts.keys().next().value;
    if (oldestKey) apiCallCounts.delete(oldestKey);
  }

  let entry = apiCallCounts.get(userId);
  if (!entry || now - entry.windowStartTime > windowMs) {
    entry = { count: 0, windowStartTime: now };
    apiCallCounts.set(userId, entry);
  }

  entry.count++;

  if (entry.count > 30) {
    logger.warning('异常行为检测：高频操作', {
      rule: 'R3_HIGH_FREQUENCY',
      userId,
      requestCount: entry.count,
      path: req.path,
      method: req.method,
      correlationInfo: {
        userId,
        requestCount: entry.count,
        path: req.path,
        method: req.method,
        timestamp: new Date().toISOString()
      }
    });
  }
};

const detectAbnormalTime = async (req) => {
  if (req.path !== '/api/v1/loan/borrow' || req.method !== 'POST') {
    return;
  }

  const hour = new Date().getHours();
  
  if (hour >= 2 && hour < 5) {
    const userId = req.user?.id;
    const amount = Number(req.body?.amount || 0);
    
    logger.warning('异常行为检测：异常时段借款', {
      rule: 'R4_ABNORMAL_TIME',
      userId,
      hour,
      amount,
      correlationInfo: {
        userId,
        hour,
        amount,
        timestamp: new Date().toISOString()
      }
    });
  }
};

const anomalyDetectionMiddleware = async (req, res, next) => {
  try {
    const r1Result = await detectLoginBruteForce(req);
    if (r1Result?.blocked) {
      return res.status(429).json({ success: false, message: r1Result.message });
    }
  } catch (error) {
    logger.error('异常检测 R1 异常', { error: error.message });
  }

  try {
    await detectLargeTransaction(req);
  } catch (error) {
    logger.error('异常检测 R2 异常', { error: error.message });
  }

  try {
    await detectHighFrequency(req);
  } catch (error) {
    logger.error('异常检测 R3 异常', { error: error.message });
  }

  try {
    await detectAbnormalTime(req);
  } catch (error) {
    logger.error('异常检测 R4 异常', { error: error.message });
  }

  next();
};

setInterval(() => {
  const now = Date.now();

  for (const [ip, data] of loginFailures.entries()) {
    if (now - data.firstAttemptTime > 5 * 60 * 1000) {
      loginFailures.delete(ip);
    }
  }

  for (const [userId, data] of apiCallCounts.entries()) {
    if (now - data.windowStartTime > 60 * 1000) {
      apiCallCounts.delete(userId);
    }
  }

  logger.debug('异常检测数据清理完成', {
    loginFailuresCount: loginFailures.size,
    apiCallCountsCount: apiCallCounts.size
  });
}, 5 * 60 * 1000);

module.exports = { anomalyDetectionMiddleware };