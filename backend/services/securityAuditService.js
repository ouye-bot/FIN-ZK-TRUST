const { execute } = require('../config/database');
const logger = require('../utils/logger');
const userDao = require('../dao/userDao');

const freezeOverdueAccounts = async () => {
  let scanned = 0;
  let frozen = 0;
  let errors = 0;

  try {
    const results = await execute(
      'SELECT DISTINCT user_id FROM transactions WHERE type = ? AND status = ? AND due_date < DATE_SUB(NOW(), INTERVAL 90 DAY)',
      ['loan', 'overdue']
    );

    scanned = results.length;

    for (const row of results) {
      const userId = row.user_id;

      try {
        const user = await userDao.findById(userId);
        if (!user) continue;

        if (user.role === 'frozen') {
          logger.info('账户已冻结，跳过', { userId });
          continue;
        }

        await userDao.update(userId, { role: 'frozen' });
        frozen++;
        
        logger.info('账户已冻结', { 
          userId, 
          reason: '逾期超过90天',
          correlationInfo: { userId, action: 'freeze', reason: 'overdue_90_days' }
        });
      } catch (error) {
        errors++;
        logger.error('冻结账户失败', { userId, error: error.message });
      }
    }
  } catch (error) {
    errors++;
    logger.error('冻结逾期账户查询失败', { error: error.message });
  }

  return { scanned, frozen, errors };
};

const markDormantAccounts = async () => {
  let scanned = 0;
  let marked = 0;
  let errors = 0;

  try {
    const results = await execute(
      `SELECT u.id FROM users u 
       WHERE u.role = 'user' 
       AND NOT EXISTS (
         SELECT 1 FROM transactions t 
         WHERE t.user_id = u.id 
         AND t.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
       )`
    );

    scanned = results.length;

    for (const row of results) {
      const userId = row.id;

      try {
        await userDao.update(userId, { role: 'user_dormant' });
        marked++;
        
        logger.info('账户已标记为休眠', { 
          userId, 
          reason: '连续30天无操作',
          correlationInfo: { userId, action: 'mark_dormant', reason: '30_days_inactive' }
        });
      } catch (error) {
        errors++;
        logger.error('标记休眠账户失败', { userId, error: error.message });
      }
    }
  } catch (error) {
    errors++;
    logger.error('标记休眠账户查询失败', { error: error.message });
  }

  return { scanned, marked, errors };
};

const generateSecurityReport = async () => {
  try {
    const [frozenResult] = await execute(
      'SELECT COUNT(*) as count FROM users WHERE role = ?',
      ['frozen']
    );
    
    const [dormantResult] = await execute(
      'SELECT COUNT(*) as count FROM users WHERE role LIKE ?',
      ['%_dormant']
    );
    
    // amount 已加密，先获取条数，再通过 DAO 解密计算总额
    const [overdueCountResult] = await execute(
      'SELECT COUNT(*) as count FROM transactions WHERE type = ? AND status = ?',
      ['loan', 'overdue']
    );
    const overdueCount = overdueCountResult[0]?.count || 0;

    // audit_logs 表不存在，使用 credit_history 作为高风险用户判断依据
    const [highRiskResult] = await execute(
      `SELECT COUNT(DISTINCT user_id) as count
       FROM credit_history
       WHERE change_amount < 0
         AND created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY user_id
       HAVING COUNT(*) >= 3`
    );

    return {
      frozenAccounts: frozenResult[0]?.count || 0,
      dormantAccounts: dormantResult[0]?.count || 0,
      overdueLoans: overdueCount,
      totalOverdueAmount: 0, // amount 已加密，无法直接 SUM
      highRiskUsers: highRiskResult.length || 0,
      reportGeneratedAt: new Date().toISOString()
    };
  } catch (error) {
    logger.error('生成安全报告失败', { error: error.message });
    return {
      frozenAccounts: 0,
      dormantAccounts: 0,
      overdueLoans: 0,
      totalOverdueAmount: 0,
      highRiskUsers: 0,
      reportGeneratedAt: new Date().toISOString(),
      error: error.message
    };
  }
};

module.exports = {
  freezeOverdueAccounts,
  markDormantAccounts,
  generateSecurityReport
};