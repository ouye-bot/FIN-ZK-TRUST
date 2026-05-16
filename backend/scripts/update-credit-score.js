const { execute } = require('../config/database');
const { encrypt, decrypt } = require('../utils/sm4Crypto');

async function updateCreditScore() {
  try {
    const username = 'cai';

    const users = await execute('SELECT id, username, credit_score FROM users WHERE username = ?', [username]);

    if (users.length === 0) {
      console.log('用户不存在:', username);
      return;
    }

    const user = users[0];
    console.log('当前用户信息:', {
      id: user.id,
      username: user.username,
      credit_score_encrypted: user.credit_score
    });

    const newCreditScore = 850;
    const encryptedScore = encrypt(String(newCreditScore));

    console.log('新信用分数加密后:', encryptedScore);

    await execute('UPDATE users SET credit_score = ? WHERE id = ?', [encryptedScore, user.id]);

    console.log('信用分数更新成功!');

    const updated = await execute('SELECT id, username, credit_score FROM users WHERE id = ?', [user.id]);
    console.log('更新后用户信息:', updated[0]);

  } catch (error) {
    console.error('更新信用分数失败:', error.message);
  } finally {
    process.exit(0);
  }
}

updateCreditScore();