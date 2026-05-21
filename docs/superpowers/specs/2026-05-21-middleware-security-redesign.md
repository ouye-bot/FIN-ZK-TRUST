# 中间件安全架构重构设计

**日期**: 2026-05-21
**状态**: 已确认
**方案**: 方案 B — 中度重构（端点注册表 + 职责分离）

## 背景

深度分析发现当前安全中间件存在 19 个缺陷，其中 2 个严重级别：
1. SM2 签名验证可选——攻击者不发 `x-user-id` 头即可完全绕过
2. 防重放中间件对无签名请求直接放行——只需 timestamp+nonce 即可绕过签名

根本原因：白名单分散在各中间件、职责边界不清晰、缺乏统一的端点安全分级。

## 核心决策

| 决策 | 选择 | 理由 |
|------|------|------|
| SM2 定位 | 强制安全层 | 金融操作必须强制 SM2 签名，与三层信任链设计一致 |
| 异常检测 | 混合模式 | 暴力破解阻断，大额/高频/异常时段告警不阻断 |
| 签名验证 | 职责分离 | SM2 中间件和防重放中间件各管各的签名头，避免双重验证 |
| 白名单设计 | 统一端点注册表 | 单一事实来源，消除不一致 |

## 设计

### 1. 端点注册表（endpointRegistry.js）

**文件**: `backend/config/endpointRegistry.js`

```javascript
const SecurityLevel = {
  PUBLIC: 'public',              // 无需认证
  AUTHENTICATED: 'authenticated', // 需要 JWT，不需要 SM2 签名
  FINANCIAL: 'financial',        // 需要 JWT + SM2 签名 + 防重放
};

const endpoints = {
  // === PUBLIC ===
  'POST /api/v1/auth/login':          { level: 'public', rateLimit: 'login' },
  'POST /api/v1/auth/register':       { level: 'public' },
  'POST /api/v1/auth/refresh':        { level: 'public' },
  'GET  /api/v1/health':              { level: 'public' },
  'GET  /api/v1/health/detailed':     { level: 'public' },
  'POST /api/v1/health/csp-report':   { level: 'public' },
  'POST /api/v1/mfa/verify':          { level: 'public' },
  'GET  /api/v1/mfa/setup':           { level: 'public' },
  'POST /api/v1/mfa/verify-and-enable': { level: 'public' },
  'GET  /api/v1/public/*':            { level: 'public' },
  'GET  /api-docs/*':                 { level: 'public' },

  // === AUTHENTICATED ===
  'GET  /api/v1/users/:id':           { level: 'authenticated' },
  'PUT  /api/v1/users/:id':           { level: 'authenticated' },
  'PUT  /api/v1/users/:id/update-sm2-key': { level: 'authenticated' },
  'GET  /api/v1/pool':                { level: 'authenticated' },
  'GET  /api/v1/pool/status':         { level: 'authenticated' },
  'POST /api/v1/auth/logout':         { level: 'authenticated' },
  'GET  /api/v1/credit/:id':          { level: 'authenticated' },
  'GET  /api/v1/credit/overdue-status/:id': { level: 'authenticated' },
  'POST /api/v1/credit/verify-proof': { level: 'authenticated' },
  'GET  /api/v1/risk/assessment':     { level: 'authenticated' },
  'GET  /api/v1/crypto-log':          { level: 'authenticated' },
  'POST /api/v1/crypto-log':          { level: 'authenticated' },
  'GET  /api/v1/audit/*':             { level: 'authenticated' },
  'GET  /api/v1/blockchain/*':        { level: 'authenticated' },
  'POST /api/v1/blockchain/verify':   { level: 'authenticated' },
  'GET  /api/v1/investments':         { level: 'authenticated' },
  'GET  /api/v1/zk/task/:taskId':     { level: 'authenticated' },

  // === FINANCIAL ===
  'POST /api/v1/loan/borrow':         { level: 'financial' },
  'POST /api/v1/loan/repay':          { level: 'financial' },
  'POST /api/v1/invest':              { level: 'financial' },
  'POST /api/v1/redeem':              { level: 'financial' },
  'POST /api/v1/credit/generate-proof': { level: 'financial' },
  'POST /api/v1/zk/generate-proof':   { level: 'financial' },
};

// 查询函数：支持路径参数匹配
function getSecurityLevel(method, path) {
  // 1. 精确匹配
  const exactKey = `${method} ${path}`;
  if (endpoints[exactKey]) return endpoints[exactKey].level;

  // 2. 路径参数匹配（:id 等）
  for (const [pattern, config] of Object.entries(endpoints)) {
    const [patternMethod, patternPath] = pattern.split(' ');
    if (patternMethod !== method) continue;
    if (matchPath(patternPath, path)) return config.level;
  }

  // 3. 默认：需要认证
  return 'authenticated';
}

function matchPath(pattern, path) {
  const patternParts = pattern.split('/');
  const pathParts = path.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, i) =>
    part.startsWith(':') || part === '*' || part === pathParts[i]
  );
}

module.exports = { SecurityLevel, endpoints, getSecurityLevel };
```

### 2. 中间件职责划分

#### 2.1 JWT 中间件（securityChain.js 内）

职责：解析 JWT，设置 `req.user`。
- 有 auth header → 解析验证 → 设置 `req.user`
- 无 auth header → 不设置 `req.user`，不拒绝（由后续中间件处理）
- Token 在黑名单中 → 401 拒绝

#### 2.2 异常检测中间件（anomalyDetection.js）

职责：检测异常行为，暴力破解阻断，其他告警。

| 规则 | 触发条件 | 动作 |
|------|---------|------|
| R1 暴力破解 | 5分钟内同一IP登录失败≥5次 | **阻断**（429） |
| R2 大额异常 | 借款金额 > 历史平均3倍 | 告警日志 |
| R3 高频操作 | 1分钟内>30次请求 | 告警日志 |
| R4 异常时段 | 凌晨2-5点借款 | 告警日志 |

内存上限：`loginFailures` 和 `apiCallCounts` 各最大 10000 条目。

#### 2.3 SM2 签名中间件（sm2SignatureMiddleware.js）

职责：验证 SM2 签名（唯一负责签名验证的中间件）。

```
查端点注册表：
  PUBLIC → 直接放行
  AUTHENTICATED → 直接放行（不要求 SM2）
  FINANCIAL →
    无 x-user-id → 403 拒绝
    无 x-sm2-signature → 403 拒绝
    查用户 → 不存在 → 401 拒绝
    查用户 → 无公钥 → 403 拒绝
    构建签名原文 → verifySM2Signature → 无效 → 401 拒绝
    有效 → req.sm2Verified = true → next()
```

签名原文构建：`timestamp + nonce + canonicalStringify(body)`

**关键**：SM2 中间件是**唯一**做签名验证的地方。防重放中间件**不做**签名验证。

#### 2.4 防重放中间件（antiReplayMiddleware.js）

职责：验证请求唯一性和时间有效性（**不做签名验证**）。

```
查端点注册表：
  PUBLIC → 直接放行
  AUTHENTICATED →
    要求 x-request-timestamp + x-request-nonce
    验证 timestamp 在5分钟内
    验证 nonce 长度≥32
    验证 nonce 未使用过（内存+DB双重检查）
    记录 nonce → next()
  FINANCIAL →
    要求 x-request-timestamp + x-request-nonce（防重放）
    x-request-sign 头可选（仅用于日志记录，不验证签名）
    验证 timestamp 在5分钟内
    验证 nonce 长度≥32
    验证 nonce 未使用过
    记录 nonce → next()
```

**关键变化**：
- 不再有"无签名放行"逻辑
- 不再做 SM2 签名验证（职责移交给 SM2 中间件）
- `AUTHENTICATED` 端点需要防重放（timestamp + nonce），不需要签名
- `FINANCIAL` 端点需要防重放，签名由 SM2 中间件负责
- 消除双重 DB 查询（只查一次用户公钥，在 SM2 中间件中）

#### 2.5 权限中间件（authPermissionMiddleware.js）

职责：验证用户只能访问自己的资源。

```
查端点注册表：
  PUBLIC → 直接放行
  AUTHENTICATED / FINANCIAL →
    无 req.user → 401 拒绝
    有 targetUserId → 比较是否一致 → 不一致 → 403 拒绝
    无 targetUserId → 放行（如 pool 状态等无用户维度的端点）
```

### 3. 前端适配

#### 3.1 apiUtils.js 改造

`fetchWithAntiReplay` 函数改造：

```javascript
export const fetchWithAntiReplay = async (url, options = {}, skipSignature = false) => {
  // 添加 Authorization 头
  const token = localStorage.getItem('token');
  if (token) {
    options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
  }

  // Content-Type
  if (options.method === 'POST' && !options.headers?.['Content-Type']) {
    options.headers = { ...options.headers, 'Content-Type': 'application/json' };
  }

  // POST 请求添加防重放头
  if (options.method === 'POST') {
    const timestamp = Date.now().toString();
    const nonce = generateNonce();

    options.headers = {
      ...options.headers,
      // 防重放头（所有 POST 请求都需要）
      'X-Request-Timestamp': timestamp,
      'X-Request-Nonce': nonce,
    };

    // 金融端点需要 SM2 签名
    if (!skipSignature) {
      const requestBody = options.body || JSON.stringify({});
      const signatureData = timestamp + nonce + requestBody;

      const signature = await requestSignature(signatureData);
      if (!signature) {
        throw new Error('SM2签名生成失败，请确保设备密钥已正确设置');
      }

      const userId = JSON.parse(localStorage.getItem('user'))?.id;

      options.headers = {
        ...options.headers,
        // SM2 签名头（由 SM2 中间件验证）
        'X-User-Id': userId?.toString(),
        'X-SM2-Signature': signature,
      };
    }
  }

  return fetch(url, options);
};
```

**关键变化**：
- `X-Request-Timestamp` + `X-Request-Nonce`：所有 POST 请求都需要（防重放）
- `X-User-Id` + `X-SM2-Signature`：仅金融端点需要（SM2 签名）
- 移除 `X-Request-Sign` 头（防重放中间件不再验证签名）

#### 3.2 Borrow.js 简化

移除手动 SM2 签名逻辑，签名由 `apiUtils.post()` 自动处理：

```javascript
// 旧：手动构建签名数据、手动调用 signWithSM2
// 新：直接调用 post()，签名在底层自动完成
const response = await post('/api/v1/loan/borrow', borrowData);
```

#### 3.3 统一 canonicalStringify

前端 `apiUtils.js` 和后端 `antiReplayMiddleware.js` 共用同一 canonical JSON 序列化逻辑，确保签名原文一致。

### 4. 缺陷修复清单

| # | 缺陷 | 修复方案 |
|---|------|---------|
| 1 | 双重 SM2 验证 | 职责分离：SM2 中间件**唯一**负责签名验证，防重放中间件**只做**防重放（不再验证签名），消除双重 DB 查询 |
| 2 | 异常检测只记录不拦截 | R1 暴力破解阻断（429），R2-R4 告警 |
| 3 | JWT 不强制 | 由端点注册表决定，`AUTHENTICATED`/`FINANCIAL` 端点必须有 `req.user` |
| 4 | 无签名放行 | 删除此逻辑，`AUTHENTICATED` 明确不要求签名，`FINANCIAL` 明确要求 |
| 5 | 白名单路径匹配不严格 | 改用路径段匹配，不再用 `startsWith` |
| 6 | JSON.stringify 非确定性 | 前后端统一使用 `canonicalStringify` |
| 7 | 内存缓存竞态 | 保持 UNIQUE 索引兜底，减少不必要的错误日志 |
| 8 | SM2 无 userId 放行 | `FINANCIAL` 端点强制要求 `x-user-id` |
| 9 | 用户无公钥放行 | `FINANCIAL` 端点无公钥返回 403 |
| 10 | 签名原文不一致 | 统一使用 `canonicalStringify` 构建签名原文 |
| 11 | 权限白名单不匹配 | 改从端点注册表读取 |
| 12 | 无 targetUserId 放行 | 保持现有逻辑（适用于无用户维度的端点） |
| 13 | R3 高频检测时序 | 保持现状，JWT 在异常检测之前解析 |
| 14 | R2 大额检测覆盖不全 | 后续扩展，本次不改 |
| 15 | 内存无上限 | 添加 10000 条目上限 |
| 16 | skipSignature 依赖缺陷逻辑 | 通过端点注册表明确哪些端点需要签名 |
| 17 | 前端 GET 不带认证头 | 统一使用 `apiUtils.get()` |
| 18 | SM2 可选与三层信任链矛盾 | `FINANCIAL` 端点强制 SM2，解决矛盾 |
| 19 | ZKP 超时 | 保持 200ms，后续可配置 |

### 5. 安全链最终顺序

```
请求 → JWT解析 → 异常检测(含R1阻断) → SM2签名(FINANCIAL强制) → 防重放(AUTH+FINANCIAL) → 权限校验 → Handler
```

每层职责清晰，互不重叠：
- **JWT**：身份解析（设置 req.user）
- **异常检测**：行为分析 + 暴力破解阻断（R1 阻断，R2-R4 告警）
- **SM2**：**唯一**的签名验证点（x-user-id + x-sm2-signature，仅金融端点）
- **防重放**：请求唯一性 + 时间有效性（timestamp + nonce，所有 POST 请求）
- **权限**：资源访问控制（用户只能访问自己的资源）

### 6. 不在本次范围

- R2 大额检测扩展到投资/赎回（后续）
- ZKP 超时可配置化（后续）
- `requestUtils.js` 死代码清理（低优先级）
- 前端 GET 请求统一使用 `apiUtils.get()`（低优先级，不影响安全）
