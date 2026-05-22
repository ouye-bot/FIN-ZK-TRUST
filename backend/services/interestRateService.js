const { execute } = require('../config/database');
const logger = require('../utils/logger');
const dynamicConfig = require('./dynamicConfigService');
const transactionDao = require('../dao/transactionDao');

const DEFAULT_LENDING_RATE = 0.06;
const MIN_LENDING_RATE = 0.02;
const MAX_LENDING_RATE = 0.15;

let lendingRateCache = null;
let lendingRateCacheTime = 0;
const LENDING_RATE_TTL = 60000;

async function getCurrentLendingRate() {
  try {
    if (lendingRateCache !== null && Date.now() - lendingRateCacheTime < LENDING_RATE_TTL) {
      logger.debug('使用缓存的出资利率', { rate: lendingRateCache });
      return lendingRateCache;
    }

    const allLoans = await transactionDao.findByType('loan');
    const loans = allLoans.filter(t => t.status === 'completed');

    if (!loans || loans.length === 0) {
      logger.info('无历史借款记录，使用默认出资利率', { rate: DEFAULT_LENDING_RATE });
      lendingRateCache = DEFAULT_LENDING_RATE;
      lendingRateCacheTime = Date.now();
      return lendingRateCache;
    }

    let totalWeightedRate = 0;
    let totalPrincipal = 0;

    for (const loan of loans) {
      const principal = Number(loan.amount);
      const interest = Number(loan.interest);
      if (principal <= 0) continue;

      const createdAt = new Date(loan.created_at);
      const updatedAt = new Date(loan.updated_at);
      const actualDays = Math.max(1, Math.ceil((updatedAt - createdAt) / (24 * 60 * 60 * 1000)));
      const annualRate = (interest / principal) / actualDays * 365;

      totalWeightedRate += annualRate * principal;
      totalPrincipal += principal;
    }

    if (totalPrincipal <= 0) {
      lendingRateCache = DEFAULT_LENDING_RATE;
      lendingRateCacheTime = Date.now();
      return lendingRateCache;
    }

    const weightedAverage = totalWeightedRate / totalPrincipal;
    const platformSpread = await dynamicConfig.getPlatformSpread();
    const lendingRate = Math.min(MAX_LENDING_RATE, Math.max(MIN_LENDING_RATE, weightedAverage - platformSpread));

    logger.info('出资利率计算完成', {
      weightedAverage: (weightedAverage * 100).toFixed(2) + '%',
      lendingRate: (lendingRate * 100).toFixed(2) + '%',
      platformSpread,
      totalPrincipal,
      loanCount: loans.length
    });

    lendingRateCache = lendingRate;
    lendingRateCacheTime = Date.now();
    return lendingRate;
  } catch (error) {
    logger.error('计算出资利率失败，使用默认利率', { error: error.message });
    return DEFAULT_LENDING_RATE;
  }
}

module.exports = { getCurrentLendingRate };