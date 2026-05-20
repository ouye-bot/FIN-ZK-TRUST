# 全面智能风控+系统健壮性升级 — 设计文档

> **致执行者（AI/开发者）**：
>
> 本文档是完整的实施指南。请严格遵循以下原则红线和执行规范。
>
> ## 原则红线
>
> 1. **会计恒等式不可违反**：`total_amount = platform_capital + user_capital`、`available_amount = total_amount - loaned_amount`。任何涉及资金池的操作完成后，三式必须同时成立。
> 2. **SM4加密字段不可遗漏**：数据库中 `balance`、`amount`、`interest`、`total_amount`、`paid_amount` 字段均使用SM4加密存储。读取时必须 `decryptFields`，写入时必须 `encryptFields` 或 `encrypt`。
> 3. **原子事务不可拆分**：涉及多表更新的操作（如还款=扣余额+更新池+更新贷款记录）必须在同一个数据库事务内完成，使用 `SELECT ... FOR UPDATE` 行锁防竞态。
> 4. **SM2签名验证不可跳过**：所有资金操作（借款、还款、投资、赎回）必须验证用户SM2签名。
> 5. **数据隔离不可忽视**：`parseInt(userId) !== req.user.id` 时必须返回403。
> 6. **向后兼容**：新增的动态参数必须有合理的默认值，当计算失败时回退到当前硬编码值，确保系统不会因新代码bug而完全不可用。
> 7. **不引入新依赖**：所有改动基于现有 `package.json` 中已有的依赖。
>
> ## 执行规范
>
> - 每个阶段完成后，必须能独立启动后端服务（`node app.js`）不报错
> - 修改现有函数时，先读取完整函数，理解上下文后再改
> - 新建文件后，在对应的路由或服务中正确 `require` 引用
> - 前端改动需在浏览器中实际测试（启动 `npm start`），确认页面渲染正常
> - 任何 `console.log` 调试语句在提交前删除，使用 `logger` 替代
> - 代码风格与现有代码保持一致（无分号、2空格缩进、中文注释）

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────┐
│                dynamicConfigService.js (新建)             │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ 池健康度快照  │  │ 信用分单一源  │  │ 动态参数计算    │  │
│  │ getPoolHealth │  │ getCreditScore│  │ getLoanRate    │  │
│  │              │  │ updateCredit  │  │ getLoanLimit   │  │
│  │              │  │              │  │ getChallenge   │  │
│  │              │  │              │  │ getCoolOff     │  │
│  │              │  │              │  │ getSpread      │  │
│  │              │  │              │  │ getInvestLimit │  │
│  │              │  │              │  │ getPenaltyRate │  │
│  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
└─────────┼────────────────┼──────────────────┼────────────┘
          │                │                  │
    ┌─────┴────┐    ┌──────┴──────┐    ┌─────┴──────┐
    │poolService│    │  loan.js    │    │invest.js   │
    │overdueSvc │    │  redeem.js  │    │interestRate│
    └──────────┘    └─────────────┘    └────────────┘
```

---

## 二、阶段1：基础设施

### 2.1 新建 `backend/services/dynamicConfigService.js`

这是核心文件，所有动态参数从这里获取。

```javascript
const poolDao = require('../dao/poolDao');
const userDao = require('../dao/userDao');
const transactionDao = require('../dao/transactionDao');
const { execute } = require('../config/database');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════
// 默认值（计算失败时回退）
// ═══════════════════════════════════════════
const DEFAULTS = {
  LOAN_RATE_BY_SCORE: { 300: 13.8, 600: 10.0, 650: 8.0, 700: 6.0, 750: 4.0 },
  LOAN_LIMIT_BY_SCORE: { 600: 1000, 650: 2000, 700: 5000, 750: 10000, 800: 20000, 850: 50000 },
  CHALLENGE_THRESHOLD: { borrow: 5000, redeem: 10000 },
  COOLING_OFF_DAYS: 7,
  COOLING_OFF_RATIO: 0.5,
  PLATFORM_SPREAD: 0.02,
  MIN_INVEST: 100,
  MAX_INVEST: 100000,
  MIN_SCORE: 300,
  MAX_SCORE: 850
};

// ═══════════════════════════════════════════
// 池健康度快照
// ═══════════════════════════════════════════
async function getPoolHealth() {
  try {
    const pool = await poolDao.getPool();
    if (!pool) {
      return { utilizationRate: 0, availableRatio: 1, overdueRate: 0, totalPool: 0 };
    }

    const totalPool = Number(pool.total_amount || 0);
    const available = Number(pool.available_amount || 0);
    const loaned = Number(pool.loaned_amount || 0);

    const utilizationRate = totalPool > 0 ? loaned / totalPool : 0;
    const availableRatio = totalPool > 0 ? available / totalPool : 1;

    // 逾期率：查询逾期贷款数量（用COUNT避免解密所有记录的性能开销）
    let overdueRate = 0;
    try {
      // 注意：amount 字段是SM4加密的，无法直接 SUM
      // 使用 COUNT 估算：逾期笔数占比作为逾期率的近似值
      const overdueCountResult = await execute(
        "SELECT COUNT(*) as cnt FROM transactions WHERE type = 'loan' AND status = 'overdue'"
      );
      const totalCountResult = await execute(
        "SELECT COUNT(*) as cnt FROM transactions WHERE type = 'loan' AND (status = 'pending' OR status = 'overdue')"
      );
      const overdueCount = overdueCountResult[0]?.cnt || 0;
      const totalCount = totalCountResult[0]?.cnt || 0;
      overdueRate = totalCount > 0 ? overdueCount / totalCount : 0;
    } catch (e) {
      logger.warning('查询逾期率失败，使用默认值0', { error: e.message });
    }

    return {
      utilizationRate: Math.round(utilizationRate * 10000) / 10000,
      availableRatio: Math.round(availableRatio * 10000) / 10000,
      overdueRate: Math.round(overdueRate * 10000) / 10000,
      totalPool,
      available,
      loaned
    };
  } catch (error) {
    logger.error('获取池健康度失败，使用默认值', { error: error.message });
    return { utilizationRate: 0, availableRatio: 1, overdueRate: 0, totalPool: 0 };
  }
}

// ═══════════════════════════════════════════
// 信用分单一数据源
// ═══════════════════════════════════════════
async function getCreditScore(userId) {
  const user = await userDao.findById(userId);
  if (!user) throw new Error('用户不存在');
  return user.credit_score || 600;
}

async function updateCreditScore(userId, delta, reason, transactionId = null) {
  const user = await userDao.findById(userId);
  if (!user) throw new Error('用户不存在');

  const currentScore = user.credit_score || 600;
  const newScore = Math.max(DEFAULTS.MIN_SCORE, Math.min(DEFAULTS.MAX_SCORE, currentScore + delta));

  await userDao.updateCreditScore(userId, newScore);

  // 记录信用历史
  const creditHistoryDao = require('../dao/creditHistoryDao');
  creditHistoryDao.create({
    user_id: parseInt(userId),
    score: newScore,
    change_amount: delta,
    reason,
    transaction_id: transactionId
  }).catch(err => logger.error('记录信用历史失败', { error: err.message }));

  return newScore;
}

// ═══════════════════════════════════════════
// 辅助：从阶梯表中查值
// ═══════════════════════════════════════════
function lookupByScore(score, table) {
  const scores = Object.keys(table).map(Number).sort((a, b) => b - a);
  for (const s of scores) {
    if (score >= s) return table[s];
  }
  return scores.length > 0 ? table[scores[scores.length - 1]] : 0;
}

// ═══════════════════════════════════════════
// 2.2 动态借款利率
// ═══════════════════════════════════════════
async function getLoanRate(creditScore) {
  try {
    const baseRate = lookupByScore(creditScore, DEFAULTS.LOAN_RATE_BY_SCORE);
    const health = await getPoolHealth();

    // poolMultiplier: 可用率越低，系数越大
    const poolMultiplier = 1 + (1 - health.availableRatio) * 0.5;
    // 上限封顶 ×2.0
    const finalRate = Math.min(baseRate * poolMultiplier, baseRate * 2.0);

    logger.info('动态借款利率计算', {
      creditScore,
      baseRate,
      availableRatio: health.availableRatio,
      poolMultiplier: poolMultiplier.toFixed(3),
      finalRate: finalRate.toFixed(2)
    });

    return finalRate;
  } catch (error) {
    logger.error('动态借款利率计算失败，使用静态值', { error: error.message });
    return lookupByScore(creditScore, DEFAULTS.LOAN_RATE_BY_SCORE);
  }
}

// ═══════════════════════════════════════════
// 2.3 动态借款限额
// ═══════════════════════════════════════════
async function getLoanLimit(creditScore, userRisk) {
  try {
    const baseLimit = lookupByScore(creditScore, DEFAULTS.LOAN_LIMIT_BY_SCORE);

    // riskMultiplier
    let riskMultiplier;
    if (userRisk >= 80) riskMultiplier = 1.2;
    else if (userRisk >= 60) riskMultiplier = 1.0;
    else if (userRisk >= 40) riskMultiplier = 0.7;
    else riskMultiplier = 0.5;

    // 信用分 ≥ 700 的优质用户不受池健康度影响
    if (creditScore >= 700) {
      return Math.floor(baseLimit * riskMultiplier);
    }

    const health = await getPoolHealth();
    let poolMultiplier;
    if (health.availableRatio >= 0.6) poolMultiplier = 1.0;
    else if (health.availableRatio >= 0.4) poolMultiplier = 0.8;
    else poolMultiplier = 0.5;

    return Math.floor(baseLimit * riskMultiplier * poolMultiplier);
  } catch (error) {
    logger.error('动态借款限额计算失败，使用静态值', { error: error.message });
    return lookupByScore(creditScore, DEFAULTS.LOAN_LIMIT_BY_SCORE);
  }
}

// ═══════════════════════════════════════════
// 2.4 动态大额挑战阈值
// ═══════════════════════════════════════════
function getChallengeThreshold(operationType, userRisk) {
  try {
    const baseThreshold = DEFAULTS.CHALLENGE_THRESHOLD[operationType] || 5000;

    let riskMultiplier;
    if (userRisk >= 80) riskMultiplier = 1.5;
    else if (userRisk >= 60) riskMultiplier = 1.0;
    else if (userRisk >= 40) riskMultiplier = 0.7;
    else riskMultiplier = 0.5;

    // 绝对下限 2000
    return Math.max(Math.floor(baseThreshold * riskMultiplier), 2000);
  } catch (error) {
    logger.error('动态挑战阈值计算失败，使用静态值', { error: error.message });
    return DEFAULTS.CHALLENGE_THRESHOLD[operationType] || 5000;
  }
}

// ═══════════════════════════════════════════
// 2.5 动态冷静期
// ═══════════════════════════════════════════
function getCoolingOff(userRisk) {
  try {
    let days, ratio;
    if (userRisk >= 60) {
      days = 7;
      ratio = 0.5;
    } else if (userRisk >= 40) {
      days = 14;
      ratio = 0.3;
    } else {
      days = 21;
      ratio = 0.2;
    }
    return { days, ratio };
  } catch (error) {
    logger.error('动态冷静期计算失败，使用静态值', { error: error.message });
    return { days: DEFAULTS.COOLING_OFF_DAYS, ratio: DEFAULTS.COOLING_OFF_RATIO };
  }
}

// ═══════════════════════════════════════════
// 2.6 动态平台利差
// ═══════════════════════════════════════════
async function getPlatformSpread() {
  try {
    const health = await getPoolHealth();

    let utilizationBonus = 0;
    if (health.utilizationRate > 0.8) utilizationBonus = 0.01;
    else if (health.utilizationRate > 0.6) utilizationBonus = 0.005;

    let overdueBonus = 0;
    if (health.overdueRate > 0.1) overdueBonus = 0.01;
    else if (health.overdueRate > 0.05) overdueBonus = 0.005;

    const spread = Math.min(DEFAULTS.PLATFORM_SPREAD + utilizationBonus + overdueBonus, 0.08);

    logger.info('动态平台利差计算', {
      utilizationRate: health.utilizationRate,
      overdueRate: health.overdueRate,
      utilizationBonus,
      overdueBonus,
      spread
    });

    return spread;
  } catch (error) {
    logger.error('动态平台利差计算失败，使用静态值', { error: error.message });
    return DEFAULTS.PLATFORM_SPREAD;
  }
}

// ═══════════════════════════════════════════
// 2.7 动态出资限额
// ═══════════════════════════════════════════
async function getInvestLimit() {
  try {
    const health = await getPoolHealth();

    let maxInvest;
    if (health.availableRatio >= 0.6) maxInvest = 100000;
    else if (health.availableRatio >= 0.4) maxInvest = 50000;
    else maxInvest = 20000;

    return { minInvest: DEFAULTS.MIN_INVEST, maxInvest };
  } catch (error) {
    logger.error('动态出资限额计算失败，使用静态值', { error: error.message });
    return { minInvest: DEFAULTS.MIN_INVEST, maxInvest: DEFAULTS.MAX_INVEST };
  }
}

// ═══════════════════════════════════════════
// 2.8 逾期罚息分级
// ═══════════════════════════════════════════
function getOverduePenaltyRate(overdueDays) {
  if (overdueDays <= 0) return 1.0; // 未逾期
  if (overdueDays <= 7) return 1.5;
  if (overdueDays <= 15) return 2.0;
  if (overdueDays <= 30) return 2.5;
  return 3.0;
}

// ═══════════════════════════════════════════
// 导出
// ═══════════════════════════════════════════
module.exports = {
  getPoolHealth,
  getCreditScore,
  updateCreditScore,
  getLoanRate,
  getLoanLimit,
  getChallengeThreshold,
  getCoolingOff,
  getPlatformSpread,
  getInvestLimit,
  getOverduePenaltyRate,
  DEFAULTS,
  lookupByScore
};
```

### 2.2 新增 `zk_queue` 表

在 `backend/scripts/create-tables.js` 的 `console.log('所有表创建完成');` 之前插入：

```javascript
// 创建zk_queue表（ZKP任务持久化队列）
await execute(`
  CREATE TABLE IF NOT EXISTS zk_queue (
    id INT PRIMARY KEY AUTO_INCREMENT,
    task_id VARCHAR(64) UNIQUE NOT NULL COMMENT '任务UUID',
    task_data TEXT NOT NULL COMMENT '任务参数 JSON',
    status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT '状态: pending/processing/completed/failed',
    result TEXT DEFAULT NULL COMMENT '结果 JSON',
    error TEXT DEFAULT NULL COMMENT '错误信息',
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_task_id (task_id),
    INDEX idx_created_at (created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);
console.log('zk_queue表创建成功');
```

### 2.3 信用分单一数据源

**问题根源**：`backend/routes/credit.js` 的 `GET /score/:userId`（第377-447行）做了以下操作：
1. 读取 `user.credit_score`（已包含增量更新的结果）
2. 遍历所有交易，对每笔 `completed` 贷款再 +10
3. 用这个错误的累加值更新数据库

这导致信用分被重复计算。

**修复方案**：

修改 `backend/routes/credit.js` 的 `GET /score/:userId` 路由（第377-447行），替换为：

```javascript
router.get('/score/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    logger.info('获取用户信用评分', { userId });

    const user = await userDao.findById(parseInt(userId));
    if (!user) {
      return res.json({ success: false, message: '用户不存在' });
    }

    // 直接读取数据库中的信用分（增量更新的正确结果）
    const creditScore = user.credit_score || 600;

    // 从信用历史表获取变化记录（只读，不重新计算）
    const records = await creditHistoryDao.findByUserId(parseInt(userId));
    const history = records.map(r => ({
      timestamp: r.created_at,
      type: r.reason,
      description: r.reason,
      scoreChange: r.change_amount
    }));

    logger.info('获取用户信用评分成功', { userId, creditScore });

    res.json({
      success: true,
      data: {
        userId: user.id,
        username: user.username,
        creditScore,
        history
      }
    });
  } catch (error) {
    logger.error('获取用户信用评分失败', { error: error.message, userId: req.params.userId });
    res.status(500).json({
      success: false,
      message: '获取用户信用评分失败',
      error: error.message
    });
  }
});
```

同时删除 `credit.js` 中不再需要的导入：
- 删除 `const transactionDao = require('../dao/transactionDao');`（如果该文件中其他地方未使用）

---

## 三、阶段2：后端业务模块接入

### 3.1 修改 `backend/routes/loan.js`

#### 3.1.1 替换静态借款利率计算

当前代码（第93-98行）：
```javascript
const calculateInterest = (principal, days, creditScore, isOverdue = false) => {
  const annualRate = getInterestRate(creditScore) / 100;
  const dailyRate = annualRate / 365;
  const rate = isOverdue ? dailyRate * 2 : dailyRate;
  return Math.round(principal * rate * days * 100) / 100;
};
```

替换为：
```javascript
const calculateInterest = async (principal, days, creditScore, isOverdue = false, overdueDays = 0) => {
  // 动态利率：基础利率 × 池健康度系数
  const baseAnnualRate = getInterestRate(creditScore) / 100;
  const dailyRate = baseAnnualRate / 365;

  let rate;
  if (isOverdue && overdueDays > 0) {
    // 分级罚息：根据逾期天数确定倍数
    const penaltyMultiplier = dynamicConfig.getOverduePenaltyRate(overdueDays);
    rate = dailyRate * penaltyMultiplier;
  } else if (isOverdue) {
    // 兼容：未传 overdueDays 时使用 ×1.5
    rate = dailyRate * 1.5;
  } else {
    rate = dailyRate;
  }

  return Math.round(principal * rate * days * 100) / 100;
};
```

在文件顶部新增导入：
```javascript
const dynamicConfig = require('../services/dynamicConfigService');
```

#### 3.1.2 替换静态大额挑战阈值

当前代码（第101行）：
```javascript
const LARGE_LOAN_THRESHOLD = 5000;
```

在借款路由中（第185行附近），将：
```javascript
if (parseInt(amount) >= LARGE_LOAN_THRESHOLD) {
```

改为：
```javascript
// 动态挑战阈值（需要获取用户风险等级）
const { assessLoanRisk } = require('../services/riskService');
const userRiskForThreshold = await assessLoanRisk(userId, parseInt(amount), term, creditProof).catch(() => ({ riskScore: 60 }));
const dynamicThreshold = dynamicConfig.getChallengeThreshold('borrow', userRiskForThreshold.riskScore || 60);

if (parseInt(amount) >= dynamicThreshold) {
```

注意：`assessLoanRisk` 在后面还会被正式调用一次，这里只用于获取阈值判断。如果不想重复调用，可以将风控评估提前到挑战阈值判断之前，把结果存起来复用。

#### 3.1.3 替换静态借款限额和冷静期

当前代码（第215-245行）中的 `getLoanLimit` 和冷静期逻辑。

将：
```javascript
const loanLimit = getLoanLimit(proofData.creditScore);
```

改为：
```javascript
// 动态借款限额
const userRiskForLimit = await assessLoanRisk(userId, parseInt(amount), term, creditProof).catch(() => ({ riskScore: 60 }));
const loanLimit = await dynamicConfig.getLoanLimit(proofData.creditScore, userRiskForLimit.riskScore || 60);
```

将冷静期逻辑（第224-244行）中的：
```javascript
if (daysSinceRegister < CREDIT_RULES.COOLING_OFF_DAYS) {
  const coolingOffTotalLimit = Math.floor(loanLimit * CREDIT_RULES.COOLING_OFF_LOAN_RATIO);
```

改为：
```javascript
const coolingOff = dynamicConfig.getCoolingOff(userRiskForLimit.riskScore || 60);
if (daysSinceRegister < coolingOff.days) {
  const coolingOffTotalLimit = Math.floor(loanLimit * coolingOff.ratio);
```

#### 3.1.4 还款时使用分级罚息

当前代码（第466-467行）：
```javascript
if (daysLate > 0) {
  finalInterest = agreedInterest + calculateInterest(principal, daysLate, creditScore, true);
```

改为：
```javascript
if (daysLate > 0) {
  finalInterest = agreedInterest + await calculateInterest(principal, daysLate, creditScore, true, daysLate);
```

注意：`calculateInterest` 变成 async 函数后，所有调用处都需要 `await`。

#### 3.1.5 使用统一信用分更新

当前代码（第592-607行）：
```javascript
const newScore = Math.max(
  CREDIT_RULES.MIN_SCORE,
  Math.min(CREDIT_RULES.MAX_SCORE, user.credit_score + scoreChange)
);
const updatedUser = await userDao.updateCreditScore(userId, newScore);
// ...
creditHistoryDao.create({
  user_id: parseInt(userId),
  score: newScore,
  change_amount: scoreChange,
  reason,
  transaction_id: transactionId
}).catch(err => logger.error('记录信用历史失败', { error: err.message }));
```

改为：
```javascript
const newScore = await dynamicConfig.updateCreditScore(userId, scoreChange, reason, transactionId);
const updatedUser = await userDao.findById(userId);
```

### 3.2 修改 `backend/routes/invest.js`

#### 3.2.1 动态出资限额

当前代码在 `poolService.invest()` 内部检查限额（最低100、最高10万）。

在 `invest.js` 的路由中（约第148行余额检查之后），新增：
```javascript
// 动态出资限额检查
const dynamicConfig = require('../services/dynamicConfigService');
const investLimit = await dynamicConfig.getInvestLimit();
if (parseInt(amount) < investLimit.minInvest) {
  return res.status(400).json({ success: false, message: `出资金额不能低于 ¥${investLimit.minInvest}` });
}
if (parseInt(amount) > investLimit.maxInvest) {
  return res.status(400).json({ success: false, message: `出资金额不能超过 ¥${investLimit.maxInvest}（当前池可用率限制）` });
}
```

同时需要修改 `backend/services/poolService.js` 的 `invest()` 函数，将硬编码限额改为参数传入或从 dynamicConfig 获取。最简方案：在 `poolService.invest()` 中也引入 dynamicConfig：

```javascript
// poolService.js 的 invest 函数中，替换硬编码限额
const dynamicConfig = require('./dynamicConfigService');
const investLimit = await dynamicConfig.getInvestLimit();
if (amount < investLimit.minInvest) throw new Error(`出资金额不能低于 ¥${investLimit.minInvest}`);
if (amount > investLimit.maxInvest) throw new Error(`出资金额不能超过 ¥${investLimit.maxInvest}`);
```

#### 3.2.2 使用统一信用分更新

当前代码（第200-224行）：
```javascript
const newScore = Math.max(
  CREDIT_RULES.MIN_SCORE,
  Math.min(CREDIT_RULES.MAX_SCORE, (currentUser.credit_score || 600) + CREDIT_RULES.SCORE_CHANGES.INVEST_REWARD)
);
await userDao.updateCreditScore(userId, newScore);
// ...
creditHistoryDao.create({
  user_id: parseInt(userId),
  score: newScore,
  change_amount: CREDIT_RULES.SCORE_CHANGES.INVEST_REWARD,
  reason: '出资奖励',
  transaction_id: newTransaction ? newTransaction.id : null
}).catch(err => logger.error('记录出资信用历史失败', { error: err.message }));
```

改为：
```javascript
const dynamicConfig = require('../services/dynamicConfigService');
await dynamicConfig.updateCreditScore(userId, CREDIT_RULES.SCORE_CHANGES.INVEST_REWARD, '出资奖励', newTransaction ? newTransaction.id : null);
```

### 3.3 修改 `backend/routes/redeem.js`

#### 3.3.1 动态赎回挑战阈值

当前代码（第85行）：
```javascript
if (parseInt(amount) >= LARGE_REDEEM_THRESHOLD) {
```

改为：
```javascript
const dynamicConfig = require('../services/dynamicConfigService');
const riskService = require('../services/riskService');
const userRiskForRedeem = await riskService.assessUserRisk(userId).catch(() => ({ riskScore: 60 }));
const dynamicRedeemThreshold = dynamicConfig.getChallengeThreshold('redeem', userRiskForRedeem.riskScore || 60);

if (parseInt(amount) >= dynamicRedeemThreshold) {
```

### 3.4 修改 `backend/services/interestRateService.js`

当前代码（第5行）：
```javascript
const PLATFORM_SPREAD = 0.02;
```

替换为动态利差：

```javascript
const dynamicConfig = require('./dynamicConfigService');

async function getCurrentLendingRate() {
  try {
    // ... 现有的加权平均利率计算逻辑保持不变 ...

    // 替换固定利差为动态利差
    const platformSpread = await dynamicConfig.getPlatformSpread();
    const lendingRate = Math.min(MAX_LENDING_RATE, Math.max(MIN_LENDING_RATE, weightedAverage - platformSpread));

    // ... 日志和返回 ...
  }
}
```

注意：`PLATFORM_SPREAD` 常量保留作为 fallback，但实际使用 `dynamicConfig.getPlatformSpread()`。

### 3.5 修改 `backend/services/overdueService.js`

当前代码中没有罚息计算逻辑（它只负责标记逾期状态）。罚息计算在 `loan.js` 的 `calculateInterest` 中。

但需要在 `overdueService.js` 中新增一个辅助函数，供查询逾期天数用：

```javascript
// 获取指定贷款的逾期天数
function getOverdueDays(dueDate) {
  if (!dueDate) return 0;
  const now = new Date();
  const due = new Date(dueDate);
  return Math.max(0, Math.floor((now - due) / (24 * 60 * 60 * 1000)));
}

module.exports = { checkOverdueLoans, getOverdueStats, getOverdueDays };
```

---

## 四、阶段3：健壮性改造

### 4.1 ZKP队列持久化

改造 `backend/services/zkQueue.js`，将内存 Map 改为数据库持久化，同时保留内存缓存加速读取。

```javascript
const crypto = require('crypto');
const { execute } = require('../config/database');
const logger = require('../utils/logger');

class ZKQueue {
  constructor() {
    this.cache = new Map(); // 内存缓存：taskId -> { status, result, error, createdAt }
    this.TTL = 300000; // 5分钟
    this.maxPendingTasks = 100;
    this.startCleanupInterval();
  }

  generateTaskId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  async addTask(input) {
    // 检查队列上限
    const rows = await execute(
      "SELECT COUNT(*) as cnt FROM zk_queue WHERE status = 'pending'"
    );
    if (rows[0].cnt >= this.maxPendingTasks) {
      throw new Error('ZK task queue is full, max pending tasks: ' + this.maxPendingTasks);
    }

    const taskId = this.generateTaskId();
    await execute(
      "INSERT INTO zk_queue (task_id, task_data, status) VALUES (?, ?, 'pending')",
      [taskId, JSON.stringify(input)]
    );

    // 写入缓存
    this.cache.set(taskId, { status: 'pending', result: null, error: null, createdAt: Date.now() });
    logger.info('ZK task added to queue (DB)', { taskId });

    return taskId;
  }

  async getTaskStatus(taskId) {
    // 先查缓存
    const cached = this.cache.get(taskId);
    if (cached && Date.now() - cached.createdAt < this.TTL) {
      return { status: cached.status, result: cached.result, error: cached.error };
    }

    // 查数据库
    const rows = await execute(
      "SELECT status, result, error, created_at FROM zk_queue WHERE task_id = ?",
      [taskId]
    );
    if (rows.length === 0) return null;

    const task = rows[0];
    const createdAt = new Date(task.created_at).getTime();
    if (Date.now() - createdAt > this.TTL) {
      // 过期，删除
      await execute("DELETE FROM zk_queue WHERE task_id = ?", [taskId]);
      this.cache.delete(taskId);
      return null;
    }

    // 更新缓存
    const taskData = {
      status: task.status,
      result: task.result ? JSON.parse(task.result) : null,
      error: task.error,
      createdAt
    };
    this.cache.set(taskId, taskData);

    return { status: taskData.status, result: taskData.result, error: taskData.error };
  }

  async updateTaskStatus(taskId, status, result, error) {
    const resultJson = result ? JSON.stringify(result) : null;
    await execute(
      "UPDATE zk_queue SET status = ?, result = ?, error = ? WHERE task_id = ?",
      [status, resultJson, error || null, taskId]
    );

    // 更新缓存
    const cached = this.cache.get(taskId);
    if (cached) {
      cached.status = status;
      cached.result = result;
      cached.error = error;
    }

    return true;
  }

  async getPendingTaskCount() {
    const rows = await execute(
      "SELECT COUNT(*) as cnt FROM zk_queue WHERE status = 'pending'"
    );
    return rows[0].cnt;
  }

  getQueueLength() {
    return this.getPendingTaskCount();
  }

  async getStats() {
    const rows = await execute(
      "SELECT status, COUNT(*) as cnt FROM zk_queue GROUP BY status"
    );
    const stats = { queued: 0, processing: 0, completed: 0, failed: 0 };
    for (const row of rows) {
      if (row.status === 'pending') stats.queued = row.cnt;
      else if (row.status === 'processing') stats.processing = row.cnt;
      else if (row.status === 'completed') stats.completed = row.cnt;
      else if (row.status === 'failed') stats.failed = row.cnt;
    }
    return stats;
  }

  startCleanupInterval() {
    const cleanupTimer = setInterval(async () => {
      try {
        const cutoff = new Date(Date.now() - this.TTL).toISOString().slice(0, 19).replace('T', ' ');
        const result = await execute(
          "DELETE FROM zk_queue WHERE created_at < ? AND (status = 'completed' OR status = 'failed')",
          [cutoff]
        );
        if (result.affectedRows > 0) {
          logger.info('ZKQueue DB cleanup done', { deleted: result.affectedRows });
        }

        // 清理内存缓存
        const now = Date.now();
        for (const [taskId, task] of this.cache.entries()) {
          if (now - task.createdAt > this.TTL) {
            this.cache.delete(taskId);
          }
        }
      } catch (err) {
        logger.error('ZKQueue cleanup failed', { error: err.message });
      }
    }, 60000);
    cleanupTimer.unref();
  }
}

const zkQueueInstance = new ZKQueue();
module.exports = zkQueueInstance;
module.exports.ZKQueue = ZKQueue;
```

### 4.2 删除 `backend/routes/zk.js` 中的遗留接口

删除以下三个路由（它们缺少风控、签名验证、资金池事务，与 `loan.js` 功能重复且不安全）：

1. `router.post('/lend', ...)` — 约第132-176行
2. `router.post('/repay', ...)` — 约第178-233行
3. `router.post('/collect-loan', ...)` — 约第235-274行
4. `router.get('/all-loans', ...)` — 约第276-300行（如果前端未使用）
5. `router.get('/all-lends', ...)` — 约第302行之后（如果前端未使用）

删除后，`zk.js` 只保留：
- `POST /generate-proof` — ZKP证明生成
- `GET /task/:taskId` — 任务状态查询
- `GET /system-balance` — 系统余额查询
- `POST /verify-proof` — 证明验证

同时删除文件中不再需要的导入（如 `userDao`、`transactionDao`、`execute` 等，如果仅被遗留接口使用）。

---

## 五、阶段4：前端适配

### 5.1 修改 `frontend/src/pages/LoanPage.js`

借款页面需要从后端获取动态参数并展示：

1. **动态利率展示**：在借款表单旁显示当前用户的动态借款利率（可通过新增后端接口 `GET /loan/rate/:userId` 返回，或复用现有接口在借款响应中返回）
2. **动态限额展示**：显示当前可借额度（已有此功能，确保数据来源是动态计算后的值）
3. **冷静期提示**：如果用户处于冷静期，显示动态天数和限制比例

建议新增后端接口 `GET /loan/config/:userId` 返回：
```json
{
  "success": true,
  "data": {
    "loanRate": 6.5,
    "loanLimit": 5000,
    "remainingLimit": 3000,
    "coolingOff": { "active": true, "days": 7, "remainingDays": 3, "ratio": 0.5 },
    "challengeThreshold": 5000
  }
}
```

在 `backend/routes/loan.js` 中新增此接口：
```javascript
router.get('/config/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ success: false, message: '无权查看' });
    }

    const dynamicConfig = require('../services/dynamicConfigService');
    const user = await userDao.findById(parseInt(userId));
    if (!user) return res.status(404).json({ success: false, message: '用户不存在' });

    const creditScore = user.credit_score || 600;
    const riskService = require('../services/riskService');
    const riskResult = await riskService.assessUserRisk(parseInt(userId)).catch(() => ({ riskScore: 60 }));
    const userRisk = riskResult.riskScore || 60;

    const loanRate = await dynamicConfig.getLoanRate(creditScore);
    const loanLimit = await dynamicConfig.getLoanLimit(creditScore, userRisk);
    const challengeThreshold = dynamicConfig.getChallengeThreshold('borrow', userRisk);

    // 计算已借金额和冷静期
    const activeLoans = await transactionDao.findByUserId(parseInt(userId), { type: 'loan', status: 'pending' });
    const totalActiveLoanAmount = activeLoans.reduce((sum, loan) => sum + loan.amount, 0);
    const remainingLimit = Math.max(0, loanLimit - totalActiveLoanAmount);

    const coolingOff = dynamicConfig.getCoolingOff(userRisk);
    const daysSinceRegister = user.created_at
      ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / (24 * 60 * 60 * 1000))
      : 999;
    const isCoolingOff = daysSinceRegister < coolingOff.days;

    res.json({
      success: true,
      data: {
        loanRate: Math.round(loanRate * 100) / 100,
        loanLimit,
        remainingLimit,
        totalActiveLoanAmount,
        coolingOff: {
          active: isCoolingOff,
          days: coolingOff.days,
          remainingDays: isCoolingOff ? coolingOff.days - daysSinceRegister : 0,
          ratio: coolingOff.ratio
        },
        challengeThreshold
      }
    });
  } catch (error) {
    logger.error('获取借款配置失败', { error: error.message });
    res.status(500).json({ success: false, message: '获取借款配置失败' });
  }
});
```

### 5.2 修改 `frontend/src/pages/InvestPage.js`

在出资表单旁显示动态出资限额（最低/最高），数据来源可新增后端接口或复用池信息接口。

建议在 `backend/routes/invest.js` 中新增：
```javascript
router.get('/config', async (req, res) => {
  try {
    const dynamicConfig = require('../services/dynamicConfigService');
    const investLimit = await dynamicConfig.getInvestLimit();
    const lendingRate = await require('../services/interestRateService').getCurrentLendingRate();

    res.json({
      success: true,
      data: {
        minInvest: investLimit.minInvest,
        maxInvest: investLimit.maxInvest,
        currentLendingRate: Math.round(lendingRate * 10000) / 100 // 百分比，两位小数
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '获取投资配置失败' });
  }
});
```

### 5.3 修改 `frontend/src/pages/FundPoolPage.js`

在资金池总览中新增显示：
- 当前平台利差
- 当前逾期率
- 动态借款利率范围

数据来源：复用 `GET /pool` 接口，在后端响应中新增这些字段。

在 `backend/routes/pool.js` 的 `GET /` 路由中新增：
```javascript
const dynamicConfig = require('../services/dynamicConfigService');
const health = await dynamicConfig.getPoolHealth();
const platformSpread = await dynamicConfig.getPlatformSpread();

// 在 responseData 中新增：
responseData.health = {
  utilizationRate: Math.round(health.utilizationRate * 10000) / 100,
  availableRatio: Math.round(health.availableRatio * 10000) / 100,
  overdueRate: Math.round(health.overdueRate * 10000) / 100,
  platformSpread: Math.round(platformSpread * 10000) / 100
};
```

---

## 六、测试策略

### 6.1 后端接口测试

每个阶段完成后，用以下命令验证：

```bash
# 启动后端
cd backend && node app.js

# 测试借款配置接口
curl -H "Authorization: Bearer <token>" http://localhost:3003/api/v1/loan/config/1

# 测试投资配置接口
curl -H "Authorization: Bearer <token>" http://localhost:3003/api/v1/invest/config

# 测试资金池接口（新增健康指标）
curl http://localhost:3003/api/v1/pool

# 测试信用分接口（不再全量重算）
curl -H "Authorization: Bearer <token>" http://localhost:3003/api/v1/credit/score/1

# 测试ZKP任务持久化
curl -X POST -H "Content-Type: application/json" -H "Authorization: Bearer <token>" \
  -d '{"creditScore":750,"threshold":700,"userId":1}' \
  http://localhost:3003/api/v1/zk/generate-proof
```

### 6.2 前端验证

启动前端后，在浏览器中验证：
1. 借款页面：利率、限额、冷静期提示是否显示动态值
2. 投资页面：出资限额是否根据池健康度变化
3. 资金池页面：新增的健康指标是否正确显示
4. 赎回页面：流动性策略信息是否正常（已修复的"加载中"问题）

### 6.3 数据库验证

```sql
-- 验证 zk_queue 表存在
SHOW TABLES LIKE 'zk_queue';

-- 验证信用分一致性
SELECT id, username, credit_score FROM users WHERE id = 1;

-- 验证信用历史记录完整
SELECT * FROM credit_history WHERE user_id = 1 ORDER BY created_at DESC LIMIT 10;
```

---

## 七、注意事项与常见陷阱

### 7.1 async/await 传播

`calculateInterest` 从同步改为异步后，所有调用它的地方都必须 `await`。检查：
- `loan.js` 中的 `calculateInterest` 调用（约4处）
- 确保外层函数也是 `async`

### 7.2 `assessLoanRisk` 重复调用与函数名确认

`loan.js` 中 `assessLoanRisk` 会被调用两次（一次用于挑战阈值，一次用于风控评估）。优化方案：将其提前到一次调用，结果存变量复用。

注意：`riskService.js` 导出的是 `assessLoanRisk(userId, amount, term, creditProof)`，返回 `{ success, riskScore, riskLevel, ... }`。在 `redeem.js` 中获取用户风险等级时，可以简化为只查信用分：
```javascript
// redeem.js 中简化方案：直接用信用分估算风险
const user = await userDao.findById(userId);
const creditScore = user.credit_score || 600;
const userRisk = creditScore >= 750 ? 80 : creditScore >= 700 ? 70 : creditScore >= 650 ? 60 : creditScore >= 600 ? 50 : 40;
const dynamicRedeemThreshold = dynamicConfig.getChallengeThreshold('redeem', userRisk);
```
避免在赎回流程中引入复杂的风控评估调用。

### 7.3 错误处理与降级

`dynamicConfigService` 中每个函数都有 try/catch 和默认值降级。但调用方仍需处理异常情况：
```javascript
const rate = await dynamicConfig.getLoanRate(creditScore).catch(() => getInterestRate(creditScore));
```

### 7.4 `poolService.invest()` 内部限额

`poolService.invest()` 函数内部有硬编码的限额检查（最低100、最高10万）和信用分检查（低于600不允许出资）。修改时需确保与 `dynamicConfig.getInvestLimit()` 的返回值一致，避免前后端限额不匹配。

具体操作：在 `poolService.js` 的 `invest()` 函数中，找到硬编码的限额和信用分检查，替换为：
```javascript
const dynamicConfig = require('./dynamicConfigService');
const investLimit = await dynamicConfig.getInvestLimit();
if (amount < investLimit.minInvest) throw new Error(`出资金额不能低于 ¥${investLimit.minInvest}`);
if (amount > investLimit.maxInvest) throw new Error(`出资金额不能超过 ¥${investLimit.maxInvest}`);
```
信用分检查保留原有逻辑（`credit_score < 600` 不允许出资），这个不改为动态。

### 7.5 `credit.js` 导出的 `CREDIT_RULES` 和 `getInterestRate`

`loan.js` 和 `invest.js` 都从 `credit.js` 导入 `CREDIT_RULES` 和 `getInterestRate`。这些静态值保留作为 fallback，动态配置优先。不要删除 `credit.js` 中的这些导出。

### 7.6 ZKP队列改造的接口兼容性

`zkQueue.js` 的 `addTask` 和 `getTaskStatus` 从同步改为异步。所有调用方（`zk.js` route、`zkService.js`）都必须 `await`。检查所有 `zkQueue.addTask(...)` 和 `zkQueue.getTaskStatus(...)` 调用。

### 7.7 前端 API 路径

新增的后端接口需要确保前端 `apiUtils.js` 的 `get` 函数能正确调用（已有 Authorization header 自动注入，GET 请求不触发防重放签名）。

### 7.8 删除遗留接口前确认前端无调用

在删除 `zk.js` 中的 `/lend`、`/repay`、`/collect-loan` 之前，搜索前端代码确认没有调用：
```bash
grep -r "zk/lend\|zk/repay\|zk/collect-loan" frontend/src/
```

---

## 八、文件改动清单

| # | 文件 | 操作 | 阶段 |
|---|------|------|------|
| 1 | `backend/services/dynamicConfigService.js` | 新建 | 1 |
| 2 | `backend/scripts/create-tables.js` | 新增 zk_queue 表 | 1 |
| 3 | `backend/routes/credit.js` | 修复 /score 接口 | 1 |
| 4 | `backend/routes/loan.js` | 接入动态参数 + 新增 /config 接口 | 2 |
| 5 | `backend/routes/invest.js` | 动态出资限额 + 新增 /config 接口 | 2 |
| 6 | `backend/routes/redeem.js` | 动态挑战阈值 | 2 |
| 7 | `backend/services/interestRateService.js` | 动态利差 | 2 |
| 8 | `backend/services/poolService.js` | 动态出资限额 | 2 |
| 9 | `backend/services/overdueService.js` | 新增 getOverdueDays 辅助函数 | 2 |
| 10 | `backend/routes/pool.js` | 新增健康指标字段 | 2 |
| 11 | `backend/services/zkQueue.js` | 持久化改造 | 3 |
| 12 | `backend/routes/zk.js` | 删除遗留接口 | 3 |
| 13 | `frontend/src/pages/LoanPage.js` | 动态展示 | 4 |
| 14 | `frontend/src/pages/InvestPage.js` | 动态展示 | 4 |
| 15 | `frontend/src/pages/FundPoolPage.js` | 健康指标 | 4 |
