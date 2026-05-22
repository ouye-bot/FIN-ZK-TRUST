const { execute, transaction } = require('../config/database');
const logger = require('../utils/logger');
const transactionDao = require('../dao/transactionDao');

const checkOverdueLoans = async () => {
  const result = { total: 0, marked: 0, errors: 0 };

  try {
    const overdueLoans = await execute(
      `SELECT t.id, t.user_id, t.due_date
       FROM transactions t
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

    // 在单个事务内批量标记逾期，保证原子性
    await transaction(async (connection) => {
      for (const loan of overdueLoans) {
        try {
          const dueDate = new Date(loan.due_date);
          const now = new Date();
          const daysOverdue = Math.floor((now - dueDate) / (24 * 60 * 60 * 1000));

          await connection.execute(
            'UPDATE transactions SET status = ? WHERE id = ?',
            ['overdue', loan.id]
          );

          result.marked++;
          logger.info('借款已标记为逾期', {
            transactionId: loan.id,
            userId: loan.user_id,
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
    });

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

    // amount 字段已加密，无法直接 SUM，使用解密后的 DAO 查询
    const overdueTransactions = await transactionDao.findByStatus('overdue');
    const totalOverdueAmount = overdueTransactions
      .filter(t => t.type === 'loan')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

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

const getOverdueDays = (transaction) => {
  try {
    const dueDate = new Date(transaction.due_date || transaction.dueDate);
    const now = new Date();
    if (dueDate >= now) return 0;
    return Math.max(0, Math.floor((now - dueDate) / (24 * 60 * 60 * 1000)));
  } catch (error) {
    logger.error('计算逾期天数失败', { error: error.message, transactionId: transaction?.id });
    return 0;
  }
};

module.exports = { checkOverdueLoans, getOverdueStats, getOverdueDays };