const { execute } = require('../config/database');
const logger = require('../utils/logger');

const DEFAULT_LENDING_RATE = 0.06;
const PLATFORM_SPREAD = 0.02;
const MIN_LENDING_RATE = 0.02;

async function getCurrentLendingRate() {
  try {
    const loans = await execute(
      `SELECT t.amount, t.interest, t.created_at, t.updated_at
       FROM transactions t
       WHERE t.type = 'loan' AND t.status = 'completed'`
    );

    if (!loans || loans.length === 0) {
      logger.info('无历史借款记录，使用默认出资利率', { rate: DEFAULT_LENDING_RATE });
      return DEFAULT_LENDING_RATE;
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

    if (totalPrincipal <= 0) return DEFAULT_LENDING_RATE;

    const weightedAverage = totalWeightedRate / totalPrincipal;
    const lendingRate = Math.max(MIN_LENDING_RATE, weightedAverage - PLATFORM_SPREAD);

    logger.info('出资利率计算完成', {
      weightedAverage: (weightedAverage * 100).toFixed(2) + '%',
      lendingRate: (lendingRate * 100).toFixed(2) + '%',
      totalPrincipal,
      loanCount: loans.length
    });

    return lendingRate;
  } catch (error) {
    logger.error('计算出资利率失败，使用默认利率', { error: error.message });
    return DEFAULT_LENDING_RATE;
  }
}

module.exports = { getCurrentLendingRate };