const { execute } = require('../config/database');
const poolDao = require('../dao/poolDao');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const initData = async () => {
  try {
    console.log('='.repeat(50));
    console.log('  系统数据初始化开始');
    console.log('='.repeat(50));

    console.log('\n[1/4] 删除所有交易记录...');
    const delTxResult = await execute('DELETE FROM transactions');
    console.log(`  已删除 ${delTxResult.affectedRows} 条交易记录`);

    console.log('\n[2/4] 删除所有信用证明...');
    const delProofResult = await execute('DELETE FROM credit_proofs');
    console.log(`  已删除 ${delProofResult.affectedRows} 条信用证明`);

    console.log('\n[3/4] 保留 system 用户，删除其他所有用户...');
    const delUsersResult = await execute("DELETE FROM users WHERE username != 'system'");
    console.log(`  已删除 ${delUsersResult.affectedRows} 个用户（保留 system 用户）`);

    console.log('\n[4/4] 重置资金池...');
    console.log('  系统资金池 (platform_capital) = 20000');
    console.log('  用户资金池 (user_capital) = 40000');
    console.log('  已借出 (loaned_amount) = 0');

    await poolDao.updatePoolV2({
      platform_capital: 20000,
      user_capital: 40000,
      loaned_amount: 0,
      total_interest_earned: 0
    });

    const remainingUsers = await execute('SELECT id, username, role FROM users');
    console.log(`\n当前剩余用户:`);
    remainingUsers.forEach(u => console.log(`  - ID: ${u.id}, 用户名: ${u.username}, 角色: ${u.role}`));

    const txCount = await execute('SELECT COUNT(*) AS count FROM transactions');
    console.log(`交易记录数: ${txCount[0].count}`);

    const pool = await poolDao.getPool();
    console.log(`\n资金池状态:`);
    console.log(`  总金额 (total_amount): ${pool.total_amount}`);
    console.log(`  可用金额 (available_amount): ${pool.available_amount}`);
    console.log(`  平台资本 (platform_capital): ${pool.platform_capital}`);
    console.log(`  用户资本 (user_capital): ${pool.user_capital}`);
    console.log(`  已借出 (loaned_amount): ${pool.loaned_amount}`);

    console.log('\n' + '='.repeat(50));
    console.log('  系统数据初始化完成');
    console.log('='.repeat(50));

    process.exit(0);
  } catch (error) {
    console.error('\n初始化失败:', error);
    process.exit(1);
  }
};

initData();
