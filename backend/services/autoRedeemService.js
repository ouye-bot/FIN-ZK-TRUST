const { execute, transaction } = require('../config/database');
const logger = require('../utils/logger');
const poolDao = require('../dao/poolDao');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const { getCurrentLendingRate } = require('./interestRateService');

const autoRedeemMaturedInvestments = async () => {
  let total = 0;
  let redeemed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    const results = await execute(
      `SELECT * FROM transactions
       WHERE type = 'invest'
         AND status = 'active'
         AND due_date IS NOT NULL
         AND due_date <= NOW()
       ORDER BY due_date ASC
       LIMIT 100`,
    );

    total = results.length;
    logger.info('查询到期出资金', { count: total });

    for (const record of results) {
      try {
        const userId = record.user_id;
        const investmentId = record.id;

        const user = await userDao.findById(userId);
        if (!user) {
          errors++;
          logger.error('自动赎回失败：用户不存在', { investmentId, userId });
          continue;
        }

        const principal = Number(record.amount || 0);
        const investDays = Math.max(1, Math.ceil((new Date() - new Date(record.created_at)) / (24 * 60 * 60 * 1000)));
        const annualRate = await getCurrentLendingRate();
        const dailyRate = annualRate / 365;
        const dynamicInterest = Math.round(principal * dailyRate * investDays * 100) / 100;
        const totalRedeemAmount = Math.round((principal + dynamicInterest) * 100) / 100;

        const result = await transaction(async (connection) => {
          const [poolResults] = await connection.execute(
            'SELECT * FROM fund_pool WHERE id = 1 FOR UPDATE',
          );
          if (poolResults.length === 0) {
            return { success: false, reason: '资金池不存在' };
          }

          const pool = poolResults[0];
          const poolAvailable = Number(pool.available_amount || 0);

          if (poolAvailable < totalRedeemAmount) {
            return {
              success: false,
              reason: '资金池余额不足',
              required: totalRedeemAmount,
              available: poolAvailable,
            };
          }

          await connection.execute(
            'UPDATE fund_pool SET total_amount = ?, available_amount = ? WHERE id = 1',
            [Number(pool.total_amount) - totalRedeemAmount, poolAvailable - totalRedeemAmount],
          );

          await connection.execute('UPDATE users SET balance = balance + ? WHERE id = ?', [
            totalRedeemAmount,
            userId,
          ]);

          await connection.execute(
            'UPDATE transactions SET status = ?, interest = ?, total_amount = ? WHERE id = ?',
            ['completed', dynamicInterest, totalRedeemAmount, investmentId],
          );

          return { success: true };
        });

        if (result.success) {
          redeemed++;
          logger.info('自动赎回成功', {
            investmentId,
            userId,
            principal,
            dynamicInterest,
            totalRedeemAmount,
            correlationInfo: {
              investmentId,
              userId,
              action: 'auto_redeem',
              principal,
              interest: expectedInterest,
              totalAmount: totalRedeemAmount,
              timestamp: new Date().toISOString(),
            },
          });
        } else {
          skipped++;
          if (result.reason === '资金池余额不足') {
            logger.error('自动赎回跳过：资金池余额严重不足', {
              investmentId,
              userId,
              totalRedeemAmount: result.required,
              poolAvailable: result.available,
              shortage: result.required - result.available,
              correlationInfo: {
                investmentId,
                userId,
                action: 'auto_redeem_skipped_insufficient_funds',
                required: result.required,
                available: result.available,
                shortage: result.required - result.available,
                timestamp: new Date().toISOString(),
              },
            });
          } else {
            logger.warning('自动赎回跳过', {
              investmentId,
              userId,
              reason: result.reason,
              correlationInfo: {
                investmentId,
                userId,
                action: 'auto_redeem_skipped',
                reason: result.reason,
                timestamp: new Date().toISOString(),
              },
            });
          }
        }
      } catch (error) {
        errors++;
        logger.error('自动赎回失败', {
          investmentId: record.id,
          userId: record.user_id,
          error: error.message,
        });
      }
    }
  } catch (error) {
    errors++;
    logger.error('查询到期出资金失败', { error: error.message });
  }

  return { total, redeemed, skipped, errors };
};

module.exports = { autoRedeemMaturedInvestments };