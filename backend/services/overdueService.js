const { execute } = require('../config/database');
const logger = require('../utils/logger');

const checkOverdueLoans = async () => {
  const result = { total: 0, marked: 0, errors: 0 };

  try {
    const overdueLoans = await execute(
      `SELECT t.*, u.credit_score
       FROM transactions t
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.type = 'loan'
         AND t.status = 'pending'
         AND t.due_date IS NOT NULL
         AND t.due_date < NOW()
       LIMIT 100`
    );

    result.total = overdueLoans.length;

    if (overdueLoans.length === 0) {
      return result;
    }

    for (const loan of overdueLoans) {
      try {
        const dueDate = new Date(loan.due_date);
        const now = new Date();
        const daysOverdue = Math.floor((now - dueDate) / (24 * 60 * 60 * 1000));

        await execute(
          'UPDATE transactions SET status = ? WHERE id = ?',
          ['overdue', loan.id]
        );

        result.marked++;
        logger.info('借款已标记为逾期', {
          transactionId: loan.id,
          userId: loan.user_id,
          amount: loan.amount,
          dueDate: loan.due_date,
          daysOverdue
        });
      } catch (error) {
        result.errors++;
        logger.error('标记借款逾期失败', {
          transactionId: loan.id,
          error: error.message
        });
      }
    }

    if (overdueLoans.length === 100) {
      logger.info('逾期借款处理达到100条上限，下一轮定时任务将继续处理');
    }

    return result;
  } catch (error) {
    logger.error('查询逾期借款失败', { error: error.message });
    throw error;
  }
};

const getOverdueStats = async () => {
  try {
    const overdueResult = await execute(
      "SELECT COUNT(*) as count FROM transactions WHERE type = 'loan' AND status = 'overdue'"
    );
    const overdueCount = overdueResult[0]?.count || 0;

    const pendingOverdueResult = await execute(
      `SELECT COUNT(*) as count FROM transactions
       WHERE type = 'loan'
         AND status = 'pending'
         AND due_date IS NOT NULL
         AND due_date < NOW()`
    );
    const pendingOverdueCount = pendingOverdueResult[0]?.count || 0;

    const amountResult = await execute(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM transactions
       WHERE type = 'loan' AND status = 'overdue'`
    );
    const totalOverdueAmount = amountResult[0]?.total || 0;

    return {
      overdueCount,
      pendingOverdueCount,
      totalOverdueAmount
    };
  } catch (error) {
    logger.error('获取逾期统计失败', { error: error.message });
    return {
      overdueCount: 0,
      pendingOverdueCount: 0,
      totalOverdueAmount: 0
    };
  }
};

module.exports = { checkOverdueLoans, getOverdueStats };