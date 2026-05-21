# 中间件安全架构重构 — 实现指导文档

**日期**: 2026-05-21
**设计文档**: `docs/superpowers/specs/2026-05-21-middleware-security-redesign.md`
**执行者**: 编程 AI
**审查者**: 设计 AI（会话结束后深度审查）

---

## 执行原则与高标准要求

### 核心原则

1. **一次做对** — 这是交付前的最后一批改动，不允许"先实现再修补"。每个文件改动前先理解上下文，改动后立即验证。
2. **不引入新缺陷** — 修复 19 个已有缺陷的同时，不能引入任何新的缺陷。改动前后必须保持系统功能完整。
3. **测试先行思维** — 每改一个文件，脑中模拟：这个改动会影响哪些调用方？前后端是否一致？现有测试是否会失败？
4. **最小改动原则** — 只改必须改的，不顺手重构不相关的代码。不要"顺便"优化，不要引入不必要的抽象。
5. **保持向后兼容** — 前端已经在用的 API 调用方式不能被破坏（除非设计文档明确要求修改）。

### 执行效率指南

1. **先读完所有相关文件再动手** — 不要改一个文件读一个文件。先全局理解，再逐一修改。
2. **批量修改独立文件** — 多个无依赖的文件可以并行修改（用多个 Edit 工具调用），不要串行等待。
3. **不要在同一个文件上来回改** — 一次把一个文件改到位，避免反复读-改-读-改的循环。
4. **遇到不确定先停下来** — 如果某个改动不确定是否正确，不要猜测。记录问题，继续其他确定的部分。
5. **不要重复实现已有功能** — `cryptoUtils.js` 已有 `canonicalStringify` 就不要自己写一个。
6. **检查 import/export** — Node.js 的 `require` 和 ES Module 的 `import` 不能混用。后端用 `require`，前端用 `import`。

### 质量检查清单（每个文件改完后自查）

- [ ] 新增的 `require`/`import` 是否正确？
- [ ] 导出的函数名是否与调用方一致？
- [ ] 错误处理是否完整（try/catch）？
- [ ] 返回的 HTTP 状态码是否合理？
- [ ] 日志记录是否包含足够上下文？
- [ ] 是否有未处理的 edge case（null/undefined/空字符串）？

---

## 实现步骤（按顺序执行）

### 步骤 1：创建端点注册表

**文件**: `backend/config/endpointRegistry.js`（新建）

**操作**: 创建统一端点注册表，包含所有端点的安全级别定义。

**关键实现细节**:
- `SecurityLevel` 枚举：`PUBLIC`、`AUTHENTICATED`、`FINANCIAL`
- `endpoints` 对象：key 格式为 `"METHOD /path"`，value 为 `{ level: string }`
- `getSecurityLevel(method, path)` 函数：先精确匹配，再路径参数匹配，最后默认 `authenticated`
- `matchPath(pattern, path)` 函数：支持 `:param` 和 `*` 通配符，路径段数量必须一致
- 导出：`{ SecurityLevel, endpoints, getSecurityLevel }`

**参考设计文档第 1 节的代码**，但注意以下细节：
- 端点列表必须**完整覆盖** `app.js` 中注册的所有路由
- 路径必须与 Express 路由实际注册的路径一致（包含 `/api/v1` 前缀）
- `*` 通配符只匹配单个路径段，不匹配多级路径

**验证方法**: 写一个简单的测试，遍历 `endpoints` 对象确认无重复 key。

---

### 步骤 2：修改 SM2 签名中间件

**文件**: `backend/middleware/sm2SignatureMiddleware.js`

**操作**: 重写中间件，从端点注册表读取安全级别，对 `FINANCIAL` 端点强制要求 SM2 签名。

**当前状态**:
- 无 `x-user-id` → 放行（**缺陷 #8**）
- 用户不存在 → 放行（**缺陷 #8**，已部分修复）
- 无公钥 → 放行（**缺陷 #9**）

**目标状态**:
```javascript
const { getSecurityLevel } = require('../config/endpointRegistry');

const sm2SignatureMiddleware = async (req, res, next) => {
  const level = getSecurityLevel(req.method, req.path);

  // PUBLIC 和 AUTHENTICATED 端点不要求 SM2 签名
  if (level !== 'financial') {
    return next();
  }

  // FINANCIAL 端点强制要求 SM2 签名
  const userId = req.headers['x-user-id'];
  const signature = req.headers['x-sm2-signature'];

  if (!userId) {
    return res.status(403).json({ success: false, message: '金融操作需要用户身份标识' });
  }
  if (!signature) {
    return res.status(403).json({ success: false, message: '金融操作需要SM2签名' });
  }

  // 查用户
  const user = await userDao.findById(parseInt(userId));
  if (!user) {
    return res.status(401).json({ success: false, message: '用户不存在' });
  }
  if (!user.sm2_public_key) {
    return res.status(403).json({ success: false, message: '用户未设置SM2公钥，无法执行金融操作' });
  }

  // 构建签名原文
  const timestamp = req.headers['x-request-timestamp'] || '';
  const nonce = req.headers['x-request-nonce'] || '';
  const signatureData = timestamp + nonce + JSON.stringify(req.body);

  // 验证签名
  const isValid = verifySM2Signature(signatureData, signature, user.sm2_public_key);
  if (!isValid) {
    return res.status(401).json({ success: false, message: 'SM2签名验证失败' });
  }

  req.sm2Verified = true;
  next();
};
```

**注意**:
- `req.path` 在 Express 中是相对于挂载点的路径。中间件在 `securityChain.js` 中通过 `app.use()` 全局注册，所以 `req.path` 就是完整路径（如 `/api/v1/loan/borrow`）。
- 但安全链中间件在路由注册**之前**通过 `setupSecurityChain(app)` 注册，此时 `req.path` 是完整路径。
- 保留 `try/catch` 错误处理。

---

### 步骤 3：修改防重放中间件

**文件**: `backend/middleware/antiReplayMiddleware.js`

**操作**: 重写中间件，从端点注册表读取安全级别，**移除签名验证逻辑**。

**当前状态**:
- 白名单硬编码在中间件内
- 无签名时放行（**缺陷 #4**）
- 做 SM2 签名验证（**缺陷 #1**，与 SM2 中间件重复）

**目标状态**:
```javascript
const { getSecurityLevel } = require('../config/endpointRegistry');

exports.antiReplayMiddleware = async (req, res, next) => {
  // GET/HEAD/OPTIONS 不需要防重放
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }

  const level = getSecurityLevel(req.method, req.path);

  // PUBLIC 端点不需要防重放
  if (level === 'public') {
    return next();
  }

  // AUTHENTICATED 和 FINANCIAL 都需要防重放
  const timestamp = req.headers['x-request-timestamp'];
  const nonce = req.headers['x-request-nonce'];

  if (!timestamp || !nonce) {
    return res.status(403).json({
      code: '403_MISSING_REPLAY_FIELDS',
      message: 'Missing required anti-replay headers'
    });
  }

  // 验证时间戳
  const now = Date.now();
  const requestTime = parseInt(timestamp);
  if (isNaN(requestTime) || Math.abs(now - requestTime) > 5 * 60 * 1000) {
    return res.status(403).json({
      code: '403_REPLAY_ATTACK',
      message: 'Request expired, possible replay attack'
    });
  }

  // 验证 nonce
  if (typeof nonce !== 'string' || nonce.length < 32) {
    return res.status(403).json({
      code: '403_INVALID_NONCE',
      message: 'Invalid nonce'
    });
  }

  // 检查 nonce 唯一性（内存 + DB）
  // ... 保持现有的 nonce 检查逻辑 ...

  // 记录 nonce
  const expiryTime = Date.now() + 5 * 60 * 1000;
  // ... 保持现有的 nonce 记录逻辑 ...

  next();
};
```

**关键变化**:
- 移除白名单硬编码 → 从端点注册表读取
- 移除签名验证逻辑（`verifySM2Signature` 调用）→ 由 SM2 中间件负责
- 移除"无签名放行"逻辑
- 移除 `x-request-sign` 相关代码
- 保留 nonce 检查和记录逻辑

**注意**: 保留 `nonceCache` 和清理定时器，这些是防重放的核心。

---

### 步骤 4：修改异常检测中间件

**文件**: `backend/middleware/anomalyDetection.js`

**操作**: R1 暴力破解改为阻断模式，添加内存上限。

**改动点**:
1. `detectLoginBruteForce` 函数：当 `entry.count >= 5` 时，**阻断请求**（返回 429），而非只记录日志
2. `loginFailures` 和 `apiCallCounts` Map：添加 10000 条目上限，超过时清理最旧条目

**R1 阻断实现**:
```javascript
const detectLoginBruteForce = async (req) => {
  if (req.path !== '/api/v1/auth/login' || req.method !== 'POST') {
    return; // 不阻断
  }
  // ... 现有逻辑 ...
  if (entry.count >= 5) {
    logger.warning('异常行为检测：短时多次登录失败', { ... });
    // 新增：返回阻断标记
    return { blocked: true, message: '登录尝试过于频繁，请5分钟后再试' };
  }
  return null;
};
```

中间件主函数需要根据返回值决定是否阻断：
```javascript
const anomalyDetectionMiddleware = async (req, res, next) => {
  const r1Result = await detectLoginBruteForce(req);
  if (r1Result?.blocked) {
    return res.status(429).json({ success: false, message: r1Result.message });
  }
  // R2-R4 只记录不阻断
  await detectLargeTransaction(req);
  await detectHighFrequency(req);
  await detectAbnormalTime(req);
  next();
};
```

---

### 步骤 5：修改权限中间件

**文件**: `backend/middleware/authPermissionMiddleware.js`

**操作**: 从端点注册表读取安全级别，移除硬编码白名单。

**改动点**:
1. 移除 `whitelistPaths` 数组
2. 使用 `getSecurityLevel` 判断：
   - `PUBLIC` → 放行
   - `AUTHENTICATED` / `FINANCIAL` → 要求 `req.user`，校验 targetUserId

**注意**: 修复白名单中的错误路径（`/api-v1/risk/assessment` 拼写错误已在之前修复）。

---

### 步骤 6：修改前端 apiUtils.js

**文件**: `frontend/src/utils/apiUtils.js`

**操作**: 改造 `fetchWithAntiReplay` 函数。

**改动点**:
1. 所有 POST 请求添加 `X-Request-Timestamp` + `X-Request-Nonce` 头
2. 非 `skipSignature` 的 POST 请求额外添加 `X-User-Id` + `X-SM2-Signature` 头
3. 移除 `X-Request-Sign` 头
4. 签名原文使用 `canonicalStringify` 处理 body

**注意**:
- `canonicalStringify` 函数需要在前端实现（或从 `cryptoUtils.js` 导入，如果已有的话）
- 检查 `sm2Utils.js` 中是否已有 canonical JSON 序列化功能

---

### 步骤 7：修改 securityChain.js

**文件**: `backend/middleware/securityChain.js`

**操作**: 确认安全链顺序正确，中间件注册顺序不变。

**当前顺序**（保持不变）:
1. JWT 解析
2. 异常检测
3. SM2 签名验证
4. 防重放
5. 权限校验

**可能需要的改动**: 如果中间件内部逻辑变化需要调整顺序，在此处修改。

---

### 步骤 8：验证与测试

**操作**: 启动系统，运行测试脚本，验证所有功能正常。

**验证清单**:
1. 后端启动无报错
2. 前端启动无报错
3. 登录流程正常
4. 金融操作（借款/投资/赎回/还款）正常，SM2 签名生效
5. 非金融操作（查询/日志）正常，不要求 SM2 签名
6. 防重放生效：重复请求被拒绝
7. 暴力破解阻断：连续5次失败后被阻断
8. 现有测试脚本通过

---

## 已知风险点

1. **req.path vs req.baseUrl** — Express 中 `req.path` 是相对于挂载点的路径。全局中间件中 `req.path` 是完整路径，但在路由中间件中不是。安全链中间件是全局注册的，所以用 `req.path` 即可。

2. **JSON.stringify key 顺序** — 当前设计文档要求使用 `canonicalStringify`，但如果前端和后端的 key 顺序恰好一致（大多数情况），也可以暂时保持 `JSON.stringify`。优先保证功能正确，canonical 化可以后续优化。

3. **Borrow.js 手动签名** — Borrow.js 当前手动构建签名数据并调用 `signWithSM2`。改造后签名由 `apiUtils.post()` 自动处理。但 Borrow.js 还有挑战签名（challengeSignature）逻辑，这部分需要保留。

4. **前端 localStorage 中的 user 对象** — `apiUtils.js` 需要从 `localStorage.getItem('user')` 获取 userId。确保登录后 user 对象已正确存储。

5. **测试脚本** — `backend/test/` 目录下的测试脚本可能需要更新以适应新的中间件行为。

---

## 文件改动清单

| # | 文件 | 操作 | 优先级 |
|---|------|------|--------|
| 1 | `backend/config/endpointRegistry.js` | 新建 | P0 |
| 2 | `backend/middleware/sm2SignatureMiddleware.js` | 重写 | P0 |
| 3 | `backend/middleware/antiReplayMiddleware.js` | 重写 | P0 |
| 4 | `backend/middleware/anomalyDetection.js` | 修改 | P1 |
| 5 | `backend/middleware/authPermissionMiddleware.js` | 修改 | P1 |
| 6 | `frontend/src/utils/apiUtils.js` | 修改 | P0 |
| 7 | `backend/middleware/securityChain.js` | 检查 | P2 |
| 8 | `frontend/src/pages/Borrow.js` | 检查 | P2 |
| 9 | `backend/test/*` | 检查 | P2 |

**执行顺序**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9
