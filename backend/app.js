require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const { ethers } = require('ethers');
const path = require('path');
const rateLimit = require('express-rate-limit');

// 数据库配置
const { execute } = require('./config/database');

// 路由
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const loanRoutes = require('./routes/loan');
const investRoutes = require('./routes/invest');
const redeemRoutes = require('./routes/redeem');
const poolRoutes = require('./routes/pool');
const creditRoutes = require('./routes/credit');
const zkRoutes = require('./routes/zk');
const riskRoutes = require('./routes/risk');
const cryptoLogRoutes = require('./routes/cryptoLog');
const auditRoutes = require('./routes/audit');
const mfaRoutes = require('./routes/mfa');
const healthRoutes = require('./routes/health');
const blockchainRoutes = require('./routes/blockchain');

// 中间件
const sm2SignatureMiddleware = require('./middleware/sm2SignatureMiddleware');
const { setupSecurityChain, addToBlacklist } = require('./middleware/securityChain');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const { checkOverdueLoans, getOverdueStats } = require('./services/overdueService');
const { freezeOverdueAccounts, markDormantAccounts, generateSecurityReport } = require('./services/securityAuditService');
const { autoRedeemMaturedInvestments } = require('./services/autoRedeemService');

// 工具
const logger = require('./utils/logger');
const { initializeSystem } = require('./utils/initializeSystem');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3003; // 明确使用3003端口

// 密钥校验
const { validateKeys } = require('./utils/keyManager');
try {
  validateKeys();
  logger.info('密钥校验通过');
} catch (error) {
  logger.error('密钥校验失败，应用拒绝启动', { error: error.message });
  process.exit(1);
}

// 安全响应头
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'wasm-unsafe-eval'"],
      workerSrc: ["'self'", "blob:"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
    reportOnly: false,
    reportUri: '/api/v1/health/csp-report'
  },
  crossOriginEmbedderPolicy: false,
}));

// 配置
app.use(cors({
  origin: function(origin, callback) {
    // 允许本地开发环境的任意端口（支持 http 和 https，localhost 和 127.0.0.1）
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-sm2-signature', 'x-user-id', 'x-request-nonce', 'x-request-timestamp']
}));

// 定义限流器
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 分钟窗口
  max: 5,                    // 每个 IP 最多 5 次
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: '登录请求过于频繁，请 1 分钟后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const zkLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 分钟窗口
  max: 10,                   // 每个用户每分钟最多 10 次
  keyGenerator: (req) => {
    return req.user?.id || 'anonymous';
  },
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: '证明生成请求过于频繁，请 1 分钟后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,      // 1 分钟窗口
  max: 200,                  // 每个 IP 每分钟最多 200 次
  skip: (req) => {
    // 仅在非生产环境，对 perfuser 或测试标记请求豁免限流
    if (process.env.NODE_ENV === 'production') return false;
    return req.user?.username === 'perfuser' || req.headers['x-test-mode'] === 'benchmark';
  },
  message: {
    success: false,
    code: 'RATE_LIMITED',
    message: '请求过于频繁，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(bodyParser.json());

// API 速率限制（登录接口，按 IP）
app.use('/api/v1/auth/login', loginLimiter);

// Swagger API 文档
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

// 为 /api-docs 路径设置独立的宽松 CSP，避免 Swagger UI 白屏
app.use('/api-docs', (req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;"
  );
  next();
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// favicon 不需要认证
app.get('/favicon.ico', (req, res) => res.status(204).end());

// 统一安全过滤器链
setupSecurityChain(app);

// API 速率限制（通用接口，按 IP）—— 必须在 JWT 中间件之后，才能使用 req.user
app.use('/api/v1', generalLimiter);

// API 速率限制（ZKP 生成，按用户 ID，需在 JWT 解析之后）
app.use('/api/v1/zk/generate-proof', zkLimiter);

// 初始化系统
initializeSystem().then(() => {
  logger.info('系统初始化完成');
}).catch(err => {
  logger.error('系统初始化失败', { error: err.message });
});

// 路由
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/loan', loanRoutes);
app.use('/api/v1/invest', investRoutes);
app.use('/api/v1/investments', investRoutes); // 兼容前端的投资列表路由
app.use('/api/v1/redeem', redeemRoutes);
app.use('/api/v1/pool', poolRoutes);
app.use('/api/v1/credit', creditRoutes);
app.use('/api/v1/zk', zkRoutes);
app.use('/api/v1/risk', riskRoutes);
app.use('/api/v1/crypto-log', cryptoLogRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/mfa', mfaRoutes);
app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/blockchain', blockchainRoutes);

// 登出接口
app.post('/api/v1/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(200).json({ success: true, message: '已退出登录' });
    }

    const token = authHeader.split(' ')[1];
    let decoded;
    
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      logger.info('[Logout] Token already expired or invalid');
      return res.status(200).json({ success: true, message: '已退出登录' });
    }

    if (!decoded.jti || !decoded.exp) {
      return res.status(200).json({ success: true, message: '已退出登录' });
    }

    const expiresAt = decoded.exp * 1000;
    const now = Date.now();

    if (expiresAt < now) {
      return res.status(200).json({ success: true, message: '已退出登录' });
    }

    // 先写入缓存（同步，确保立即生效）
    addToBlacklist(decoded.jti, expiresAt);

    try {
      await execute(
        'INSERT INTO token_blacklist (jti, expires_at) VALUES (?, ?)',
        [decoded.jti, expiresAt]
      );
      logger.info('[Logout] Token added to blacklist', { jti: decoded.jti });
    } catch (dbError) {
      logger.warning('[Logout] Failed to add token to blacklist', { error: dbError.message });
    }

    res.status(200).json({ success: true, message: '退出登录成功' });
  } catch (error) {
    logger.error('[Logout] Error', { error: error.message });
    res.status(500).json({ success: false, message: '退出登录失败' });
  }
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 错误处理
app.use(notFoundHandler);

// 全局错误处理
app.use(errorHandler);

// 启动服务器
app.listen(PORT, () => {
  logger.info(`服务器启动在端口 ${PORT}`);

  // 初始化数据库表
  const { createTables } = require('./scripts/create-tables');
  createTables().then(() => {
    logger.info('数据库表初始化成功');
  }).catch(error => {
    logger.error('数据库表初始化失败', { error: error.message });
  });

  // 每 1 小时检查一次逾期借款
  setInterval(async () => {
    try {
      const stats = await getOverdueStats();
      if (stats.pendingOverdueCount > 0) {
        logger.info('开始执行逾期借款检查', {
          pendingOverdueCount: stats.pendingOverdueCount,
          existingOverdueCount: stats.overdueCount
        });

        const result = await checkOverdueLoans();

        logger.info('逾期借款检查完成', {
          total: result.total,
          marked: result.marked,
          errors: result.errors
        });
      }
    } catch (error) {
      logger.error('逾期借款检查失败', { error: error.message });
    }
  }, 60 * 60 * 1000);

  // 启动时立即执行一次逾期检查
  setTimeout(async () => {
    try {
      logger.info('启动时执行逾期借款检查');
      const result = await checkOverdueLoans();
      logger.info('启动时逾期借款检查完成', {
        total: result.total,
        marked: result.marked,
        errors: result.errors
      });
    } catch (error) {
      logger.error('启动时逾期借款检查失败', { error: error.message });
    }
  }, 10000);

  // 每日凌晨 2 点执行安全审计
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 2 && now.getMinutes() === 0) {
      try {
        logger.info('开始执行安全审计');
        
        const freezeResult = await freezeOverdueAccounts();
        logger.info('逾期账户冻结完成', freezeResult);
        
        const dormantResult = await markDormantAccounts();
        logger.info('休眠账户标记完成', dormantResult);
        
        const report = await generateSecurityReport();
        logger.info('安全审计报告', report);
      } catch (error) {
        logger.error('安全审计执行失败', { error: error.message });
      }
    }
  }, 60 * 1000);

  // 每日凌晨 3 点执行出资到期自动赎回（与安全审计错开，避免资源争抢）
  setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
      try {
        logger.info('开始执行出资到期自动赎回');
        const result = await autoRedeemMaturedInvestments();
        logger.info('出资到期自动赎回完成', result);
      } catch (error) {
        logger.error('出资到期自动赎回失败', { error: error.message });
      }
    }
  }, 60 * 1000);

  // 启动区块链写入重试队列处理器
  const blockchainQueueService = require('./services/blockchainQueueService');
  blockchainQueueService.startProcessor();
});