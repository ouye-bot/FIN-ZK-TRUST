# FinZkTrust - 隐私金融信贷系统

基于国密算法与零知识证明的隐私金融信贷系统，实现"数据可用不可见"的隐私信用评估，同时构建企业级纵深安全防御体系。

## 核心特性

- **端侧零知识证明**：浏览器本地利用 Web Worker 和 WASM 生成 Groth16 证明，证明用户信用达标而不泄露真实分数；后端只进行验证
- **全链路国密合规**：SM2 用于身份认证和交易签名，SM3 用于哈希和完整性校验，SM4 用于敏感数据加密存储
- **金融业务闭环**：借款、还款（先息后本、提前还款）、出资、赎回、资金池管理，利率按信用评分差异化定价
- **五层纵深安全**：接入层 → 路由层 → 业务层 → 数据层 → 传输层，全方位安全防护
- **区块链存证**：FISCO BCOS 联盟链部署 4 个合约（AuditStorage、ZKPVerifier、Verifier、PublicKeyRegistry），支持公钥锚定、审计存证、ZKP 验证
- **国密 HTTPS**：Tengine + Tongsuo 实现 NTLS 国密传输（SM2 双证书 + SM4 加密），支持 4 种国密密码套件
- **密钥生命周期**：SM4 主密钥作为 KEK 保护多个 DEK，支持版本化轮换、Shamir 秘密共享灾备恢复
- **MFA 多因素认证**：基于 RFC 6238 标准的 TOTP 动态口令，种子经 SM4 加密存储
- **动态风控**：借款利率、限额、冷静期、平台利差等参数根据资金池健康度和用户信用分实时推导

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端层 (React 18)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐    │
│  │ 信用证明页   │  │  借款/还款   │  │   出资/赎回/资金池   │    │
│  │(ZKP Worker) │  │   业务页     │  │       业务页        │    │
│  └──────┬──────┘  └──────┬──────┘  └─────────┬───────────┘    │
│         │                │                    │                 │
│         ▼                ▼                    ▼                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              前端安全层                                  │    │
│  │  SM2签名 | 设备主密钥 | 防重放签名 | 业务层签名          │    │
│  └─────────────────────────────────────────────────────────┘    │
└───────────────────────────┬─────────────────────────────────────┘
                            │ NTLS (SM2+SM4) / TLS
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Tengine NTLS (端口 8443)                      │
│           SM2 双证书 | 4 种国密套件 | RSA TLS 回落              │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTP
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        后端层 (Node.js:3003)                    │
│  ┌─────────────────────────────────────────────────────┐      │
│  │ 接入层: Helmet → RateLimit → Joi 参数校验           │      │
│  ├─────────────────────────────────────────────────────┤      │
│  │ 安全链: JWT黑名单 → 异常检测 → SM2签名 → 防重放 → 权限│      │
│  ├─────────────────────────────────────────────────────┤      │
│  │ 业务层: 动态风控 → 大额操作二次签名 → 挑战应答       │      │
│  ├─────────────────────────────────────────────────────┤      │
│  │ 数据层: SM4密文存储 → SM3哈希链 → DAO透明加解密     │      │
│  └─────────────────────────────────────────────────────┘      │
│                              │                                 │
│        ┌─────────────────────┼─────────────────────┐           │
│        ▼                     ▼                     ▼           │
│  ┌──────────┐       ┌──────────────┐       ┌─────────────┐    │
│  │  认证模块 │       │   业务模块    │       │  ZKP服务    │    │
│  │ (JWT/MFA) │       │ (借款/还款/投资)│       │ (Groth16)   │    │
│  └──────────┘       └──────────────┘       └─────────────┘    │
│                              │                                 │
│                              ▼                                 │
│  ┌─────────────────────────────────────────────────────┐      │
│  │                    数据库层 (MySQL)                 │      │
│  │  用户表 | 交易表 | 信用证明表 | 资金池表 | 黑名单表  │      │
│  └─────────────────────────────────────────────────────┘      │
└───────────────────────────┬─────────────────────────────────────┘
                            │ SM3哈希存证（异步重试队列）
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                区块链层 (FISCO BCOS 联盟链)                     │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────────┐    │
│  │ AuditStorage  │ │ ZKPVerifier   │ │ PublicKeyRegistry │    │
│  │ (审计存证)    │ │ (ZKP验证存证) │ │ (公钥生命周期管理) │    │
│  └───────────────┘ └───────────────┘ └───────────────────┘    │
│  ┌───────────────┐                                            │
│  │   Verifier    │                                            │
│  │ (Groth16验证) │                                            │
│  └───────────────┘                                            │
└─────────────────────────────────────────────────────────────────┘
```

## 技术栈

| 分类 | 技术 |
|------|------|
| 前端 | React 18, Material-UI, Web Worker, WebAssembly |
| 密码学 | sm-crypto (SM2/SM3/SM4), snarkjs (Groth16) |
| 后端 | Node.js, Express, MySQL (mysql2), jsonwebtoken, otplib |
| 安全 | helmet, express-rate-limit, joi |
| 区块链 | Solidity, FISCO BCOS (联盟链), ethers.js |
| 国密传输 | Tengine + Tongsuo (NTLS, SM2 双证书) |
| 部署 | PM2 |
| 文档 | swagger-jsdoc, swagger-ui-express |

## 性能指标

| 指标 | 数值 |
|------|------|
| SM2 签名吞吐量 | 287,781 ops/s |
| SM3 哈希吞吐量（1KB 数据） | 227 MB/s |
| SM4 加解密吞吐量（1KB 数据） | 11.67 MB/s |
| ZKP 证明生成平均耗时 | 168ms（10 次连续运算） |
| ZKP 证明验证平均耗时 | 11.3ms（10 次连续核验） |
| API 容量 QPS | 173（安全中间件全开） |
| API P99 响应延迟 | 129ms |
| 安全测试 | 34/34 通过 |
| 密码学测试 | 64/64 通过 |

## 快速开始

### 前置要求

- Node.js >= 18.x
- MySQL >= 8.0
- WSL (用于 FISCO BCOS 和国密 HTTPS)
- FISCO BCOS 联盟链节点

### 安装步骤

1. **克隆仓库**

```bash
git clone <repository-url>
cd fin-zk-trust-master
```

2. **安装依赖**

```bash
# 后端依赖
cd backend && npm install

# 前端依赖
cd ../frontend && npm install

# 电路编译依赖
cd ../circuits && npm install

# 合约编译依赖
cd ../contracts && npm install
```

3. **配置环境变量**

在 `backend/.env` 中配置：

| 变量名 | 说明 | 格式要求 |
|--------|------|---------|
| `SM4_MASTER_KEY` | SM4 主密钥（128位） | 32 位十六进制字符串，禁止使用弱密钥 |
| `JWT_SECRET` | JWT 签名密钥 | 至少 32 个字符，禁止使用默认弱值 |
| `SESSION_SECRET` | Session 密钥 | 至少 32 个字符 |
| `DB_HOST` | 数据库主机 | IP 地址或域名 |
| `DB_PORT` | 数据库端口 | 默认 3306 |
| `DB_USER` | 数据库用户名 | - |
| `DB_PASSWORD` | 数据库密码 | - |
| `DB_NAME` | 数据库名称 | 默认 finzktrust |
| `FISCO_BCOS_PRIVATE_KEY` | FISCO BCOS 账户私钥 | 64 位十六进制，前缀 0x |

4. **启动 FISCO BCOS 联盟链**

```bash
# WSL 中
cd ~/fisco-bcos-node/127.0.0.1
bash start_all.sh
```

5. **部署智能合约**

```bash
node scripts/deploy-fisco.js
```

6. **启动后端服务**

```bash
cd backend
node app.js
# 或使用 PM2 集群模式
pm2 start ecosystem.config.js
```

7. **启动前端服务**

```bash
cd frontend
npm start
```

8. **（可选）启动国密 HTTPS**

```bash
# WSL 中
sudo /usr/local/tengine-ntls/sbin/nginx -c /path/to/nginx-ntls.conf
```

## 项目结构

```
fin-zk-trust-master/
├── backend/                        # 后端服务
│   ├── app.js                      # 服务入口，中间件注册
│   ├── routes/                     # API 路由
│   │   ├── auth.js                 # 用户认证 (MFA)
│   │   ├── loan.js                 # 借款/还款业务
│   │   ├── credit.js               # 信用证明生成与验证
│   │   ├── invest.js               # 出资业务
│   │   ├── redeem.js               # 赎回业务
│   │   ├── pool.js                 # 资金池查询
│   │   ├── blockchain.js           # 区块链查询/验证 API
│   │   └── mfa.js                  # MFA 管理
│   ├── services/                   # 核心业务服务
│   │   ├── dynamicConfigService.js # 动态风控配置
│   │   ├── poolService.js          # 资金池业务逻辑
│   │   ├── zkService.js            # ZKP 验证服务
│   │   ├── blockchainServiceFisco.js # FISCO BCOS 区块链服务
│   │   ├── blockchainQueueService.js # 区块链写入重试队列
│   │   └── mfaService.js           # TOTP 多因素认证
│   ├── middleware/                  # 中间件
│   │   ├── securityChain.js        # 安全过滤器链
│   │   ├── antiReplayMiddleware.js # 防重放中间件
│   │   ├── sm2SignatureMiddleware.js # SM2 签名验证
│   │   ├── anomalyDetection.js     # 异常行为检测
│   │   └── authPermissionMiddleware.js # 权限校验
│   ├── config/
│   │   ├── database.js             # 数据库连接池
│   │   ├── endpointRegistry.js     # 端点安全级别注册表
│   │   └── swagger.js              # API 文档配置
│   └── utils/                      # 工具函数
│       ├── cryptoUtils.js          # SM2/SM3 算法
│       ├── sm4Crypto.js            # SM4 加密工具
│       └── keyManager.js           # 密钥生命周期管理
├── frontend/                       # 前端应用
│   └── src/
│       ├── App.js                  # 主路由 + 安全签名处理
│       ├── pages/                  # 页面组件
│       │   ├── Borrow.js           # 借款页（含冷静期提示）
│       │   ├── CreditProof.js      # 信用证明页（ZKP Worker）
│       │   ├── InvestPage.js       # 出资页
│       │   ├── RedeemPage.js       # 赎回页
│       │   └── MfaVerify.js        # MFA 验证页
│       ├── components/
│       │   └── CryptoLogPanel.js   # 密码操作日志面板
│       ├── workers/
│       │   └── zkProofWorker.js    # 端侧 ZKP Worker
│       └── utils/
│           ├── apiUtils.js         # 防重放签名与 API 封装
│           ├── sm2Utils.js         # SM2 密钥管理与签名
│           └── deviceKeyManager.js # 设备主密钥管理
├── circuits/                       # ZKP 电路
│   ├── credit.circom               # 信用证明电路
│   └── build/                      # 编译产物
├── contracts/                      # 智能合约
│   ├── contracts/
│   │   ├── AuditStorage.sol        # 审计存证合约
│   │   ├── ZKPVerifier.sol         # ZKP 验证合约
│   │   ├── Verifier.sol            # Groth16 链上验证合约
│   │   └── PublicKeyRegistry.sol   # SM2 公钥生命周期管理合约
│   └── scripts/
│       └── deploy.js               # Hardhat 部署脚本
├── scripts/                        # 运维脚本
│   ├── deploy-fisco.js             # FISCO BCOS 合约部署
│   └── wsl/                        # WSL 相关脚本
│       ├── setup-guomi-tls.sh      # 国密 TLS 搭建
│       ├── test-guomi-tls.sh       # 国密握手测试
│       └── verify-sm-ssl.sh        # SM_SSL 验证
└── nginx-ntls.conf                 # Tengine NTLS 配置
```

## 核心业务流程

### 借款流程

1. 用户登录获取 JWT 令牌（支持 MFA）
2. 生成信用证明（端侧 ZKP + SM2 签名）
3. 提交借款请求（含业务层 SM2 签名）
4. 大额借款（≥5,000 元）触发挑战-应答式 SM2 二次签名确认
5. 后端验证：JWT → SM2 签名 → ZKP → 动态风控评估
6. 资金池扣款，生成交易记录
7. 异步上链存证（AuditStorage + 公钥锚定）

### 还款流程

1. 用户提交还款请求（含信用证明和 SM2 签名）
2. 验证信用证明有效性
3. 部分还款遵循先息后本原则：优先抵扣利息，剩余归还本金
4. 提前还款按实际占用天数计息，取约定利息与实际利息的较小值
5. 更新用户余额和信用分（含信用历史记录）
6. 逾期还款按逾期天数计算罚息
7. 异步上链存证

### 出资/赎回流程

1. 用户发起出资/赎回请求（含信用证明和 SM2 签名）
2. 动态出资限额根据资金池可用比例调整
3. 赎回支持流动性感知策略：高流动性(≥60%)可提前赎回全部，中等(40-60%)可赎回50%
4. 大额赎回（≥10,000 元）触发挑战-应答式 SM2 二次签名确认
5. 更新用户余额和资金池状态
6. 交易哈希上链存证

### ZKP 验证流程

```
前端生成证明 (Web Worker + WASM)
        │
        ▼
   发送 proof + publicSignals + SM2签名
        │
        ▼
后端验证 (SM2签名 → snarkjs.groth16.verify)
        │
        ▼
   验证结果上链存证 (ZKPVerifier)
```

## 安全机制

### 五层纵深安全架构

1. **接入层**：Helmet 安全响应头 + 速率限制（登录 5 次/分钟，通用 200 次/分钟）+ Joi 参数校验
2. **路由层**：JWT 黑名单（内存 + 数据库双重存储）+ 异常行为检测（四类规则）+ SM2 签名验证 + 防重放（时间戳 + Nonce）+ 权限校验
3. **业务层**：大额操作 SM2 二次签名（借款 ≥¥5,000，赎回 ≥¥10,000）+ 挑战应答
4. **数据层**：SM4 密文存储（余额、信用分等敏感字段）+ SM3 哈希链审计日志 + DAO 透明加解密
5. **传输层**：Tengine NTLS 国密传输（SM2 双证书 + SM4 加密），支持 4 种国密密码套件

### SM2 双签名机制

1. **传输层签名**（X-SM2-Signature header）：防重放中间件验证，所有携带 body 的请求自动附加
2. **业务层签名**（body.signature 字段）：路由层验证，表达操作意图，需手动生成

### 公钥链上管理

- **注册**：用户注册/更新公钥时自动写入 PublicKeyRegistry 合约
- **查询**：第三方可通过 `GET /api/v1/blockchain/public-key/:userId` 验证链上公钥
- **撤销**：管理员可通过 `POST /api/v1/blockchain/public-key/revoke` 紧急撤销公钥
- **历史**：支持查询用户公钥历史（含已撤销密钥）

### 动态风控系统

所有风控参数从资金池健康度和用户信用分实时推导：

| 参数 | 动态逻辑 |
|------|---------|
| 借款利率 | 基础利率 × 资金池紧张系数 |
| 借款限额 | 基础限额 × 风险系数 × 池可用比例 |
| 冷静期 | 高风险用户 7 天 / 中风险 14 天 / 低风险 21 天 |
| 平台利差 | 基础 2% + 利用率加成 + 逾期率加成 |
| 出资限额 | 根据可用比例动态调整（20K-100K） |

### MFA 多因素认证

- 基于 RFC 6238 标准的 TOTP 动态口令
- 种子经 SM4 加密存储
- 支持备份验证码（SM3 哈希存储）

### Shamir 秘密共享（SSS）灾备恢复

- SM4 主密钥支持 k/n 门限分片
- 离线保管分片
- 拉格朗日插值恢复

## 测试

### 安全机制与容错测试（34 项）

```bash
cd backend
node test/security-fault-tolerance-test.js
```

覆盖模块：防重放(6) + JWT(3) + 参数验证(4) + 错误处理(4) + SM2签名(5) + ZKP安全(3) + SM4静默失败(5) + 认证链路(4)

### 密码技术综合测试（64 项）

```bash
cd backend
node test/crypto-test.js
```

### 性能基准测试

```bash
cd backend
node test/performance-test.js
```

测试结果输出到 `backend/test/test_results/` 目录。

## 国密 HTTPS

系统支持通过 Tengine NTLS 提供国密 HTTPS 传输：

| 密码套件 | 说明 |
|---------|------|
| `ECC-SM2-SM4-CBC-SM3` | SM2 认证 + SM4-CBC 加密 |
| `ECC-SM2-SM4-GCM-SM3` | SM2 认证 + SM4-GCM 加密 |
| `ECDHE-SM2-SM4-CBC-SM3` | ECDHE 密钥交换 + SM2 认证 |
| `ECDHE-SM2-SM4-GCM-SM3` | ECDHE 密钥交换 + SM2 认证 + SM4-GCM |

启动命令（WSL）：
```bash
sudo /usr/local/tengine-ntls/sbin/nginx -c nginx-ntls.conf
```

## API 文档

启动后端服务后，访问 Swagger UI：

```
http://localhost:3003/api-docs
```

## 合约地址

FISCO BCOS 联盟链（部署于 `backend/contract-addresses.json`）：

| 合约 | 用途 |
|------|------|
| AuditStorage | 审计哈希存证 |
| ZKPVerifier | ZKP 验证记录 |
| Verifier | Groth16 链上验证 |
| PublicKeyRegistry | SM2 公钥生命周期管理 |

## 许可证

MIT License
