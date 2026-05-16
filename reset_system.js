const { readJsonFile, writeJsonFile } = require('./backend/utils/fileUtils');
const poolService = require('./backend/services/poolService');

async function resetSystem() {
  console.log('开始重置系统...');
  
  try {
    // 1. 初始化资金池为10000
    console.log('1. 初始化资金池...');
    const poolInitialized = await poolService.initializePool();
    if (poolInitialized) {
      console.log('✓ 资金池初始化成功');
    } else {
      console.log('✗ 资金池初始化失败');
    }
    
    // 2. 删除指定用户
    console.log('\n2. 删除指定用户...');
    const users = await readJsonFile('users.json');
    if (users) {
      const usersToDelete = ['ouye', 'cyb', 'hanghang'];
      const filteredUsers = users.filter(user => !usersToDelete.includes(user.username));
      
      await writeJsonFile('users.json', filteredUsers);
      console.log(`✓ 删除了 ${users.length - filteredUsers.length} 个用户`);
      console.log(`剩余用户数: ${filteredUsers.length}`);
    } else {
      console.log('✗ 读取用户数据失败');
    }
    
    // 3. 检查结果
    console.log('\n3. 检查系统状态...');
    const poolInfo = await poolService.getPoolInfo();
    console.log(`资金池状态: ${poolInfo.totalBalance} 元`);
    
    const updatedUsers = await readJsonFile('users.json');
    console.log(`用户数量: ${updatedUsers.length}`);
    
    console.log('\n系统重置完成！');
  } catch (error) {
    console.error('系统重置失败:', error);
  }
}

resetSystem();