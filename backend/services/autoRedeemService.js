const { execute, transaction } = require('../config/database');
const logger = require('../utils/logger');
const poolDao = require('../dao/poolDao');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const { getCurrentLendingRate } = require('./interestRateService');
const { encryptFields, decryptFields } = require('../utils/sm4Crypto');

const autoRedeemMaturedInvestments = async () => {
  let total = 0;
  let redeemed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    // 使用 transactionDao 获取已解密的投资记录
    const allInvests = await transactionDao.findByType('invest');
    const maturedInvests = allInvests
      .filter(inv => inv.status === 'active' && inv.due_date && new Date(inv.due_date) <= new Date())
      .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
      .slice(0, 100);

    total = maturedInvests.length;
    logger.info('查询到期出资金', { count: total });

    for (const inv of maturedInvests) {
      try {
        const userId = inv.user_id;
        const investmentId = inv.id;

        const user = await userDao.findById(userId);
        if (!user) {
          errors++;
          logger.error('自动赎回失败：用户不存在', { investmentId, userId });
          continue;
        }

        const principal = Number(inv.amount || 0);
        const investDays = Math.max(1, Math.ceil((new Date() - new Date(inv.created_at)) / (24 * 60 * 60 * 1000)));
        const annualRate = await getCurrentLendingRate();
        const dailyRate = annualRate / 365;
        const dynamicInterest = Math.round(principal * dailyRate * investDays * 100) / 100;
        const totalRedeemAmount = Math.round((principal + dynamicInterest) * 100) / 100;

        const result = await transaction(async (connection) => {
          // 事务内再次检查投资状态，防止并发重复处理
          const [invCheck] = await connection.execute(
            'SELECT status FROM transactions WHERE id = ? FOR UPDATE', [investmentId]
          );
          if (invCheck.length === 0 || invCheck[0].status !== 'active') {
            return { success: false, reason: '投资已处理或不存在' };
          }

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

          // 更新资金池 — 本金从 user_capital 扣减，利息从 user_interest_earned 扣减
          const currentUserInterest = Number(pool.user_interest_earned || 0);
          const actualInterest = Math.min(dynamicInterest, currentUserInterest);
          const newUC = Number(pool.user_capital || 0) - principal;
          const newPC = Number(pool.platform_capital || 0);
          const newLA = Number(pool.loaned_amount || 0);
          const newTotal = newPC + newUC;
          const newAvail = newTotal - newLA;
          const newUserInterest = currentUserInterest - actualInterest;

          await connection.execute(
            `UPDATE fund_pool SET platform_capital=?, user_capital=?, loaned_amount=?,
             total_amount=?, available_amount=?, reserved_amount=?,
             user_interest_earned=? WHERE id=1`,
            [newPC, newUC, newLA, newTotal, newAvail, newLA, newUserInterest],
          );

          // 使用加密方式更新用户余额（本金 + 实际可付利息）
          const [userRows] = await connection.execute(
            'SELECT balance FROM users WHERE id = ? FOR UPDATE', [userId]
          );
          const balanceRow = { balance: userRows[0].balance };
          await decryptFields('users', balanceRow, userId, connection);
          const currentBalance = Number(balanceRow.balance) || 0;
          const payoutAmount = principal + actualInterest;
          const newBalance = currentBalance + payoutAmount;
          const balanceData = { balance: newBalance };
          await encryptFields('users', balanceData, userId, connection);
          await connection.execute('UPDATE users SET balance = ? WHERE id = ?', [balanceData.balance, userId]);

          // 使用 transactionDao 更新投资记录（加密写入）
          await transactionDao.update(investmentId, {
            status: 'completed',
            interest: actualInterest,
            total_amount: principal + actualInterest
          }, connection);

          return { success: true };
        });

        if (result.success) {
          redeemed++;
          logger.info('自动赎回成功', {
            investmentId,
            userId,
            principal,
            actualInterest,
            dynamicInterest,
            payoutAmount: principal + actualInterest,
          });
        } else {
          skipped++;
          logger.warning('自动赎回跳过', {
            investmentId,
            userId,
            reason: result.reason,
          });
        }
      } catch (error) {
        errors++;
        logger.error('自动赎回失败', {
          investmentId: inv.id,
          userId: inv.user_id,
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