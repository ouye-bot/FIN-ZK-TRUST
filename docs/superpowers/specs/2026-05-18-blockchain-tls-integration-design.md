# FISCO BCOS + Guomi NTLS 深度集成设计

## 概述

将 FISCO BCOS 联盟链和国密 TLS 从"堆砌的功能"升级为"融入系统的安全能力"。

**目标：**
- 区块链：从"单向存证"升级为"可查询、可验证、可展示"
- 国密 TLS：从"换了证书"升级为"真正的 NTLS 协议 + SM2 双证书"
- 统一启动：一条命令启动完整系统

**约束：**
- 不改变现有业务流程（区块链仍为异步非阻塞）
- 向后兼容 Hardhat 模式
- 技术深度优先，演示展示辅助

---

## 第一节：FISCO BCOS 深度集成

### 1.1 问题诊断

当前区块链集成是"单向"的：
- 写入：借款/还款/投资/赎回/ZKP验证 → `storeAuditHash` ✅
- 读取：`getRecordByHash`、`getRecordByIndex` 合约函数存在但未暴露 API ❌
- 验证：`verifyTransactionHash` 只检查"有没有"，没比对"是否一致" ❌
- 展示：前端无任何区块链相关页面 ❌

### 1.2 新增 API 端点

新增 `backend/routes/blockchain.js`，挂载到 `/api/v1/blockchain/`：

| 端点 | 方法 | 功能 | 合约调用 |
|------|------|------|----------|
| `/records` | GET | 分页查询链上记录 | `getRecordByIndex` (批量) |
| `/records/:hash` | GET | 按哈希精确查询 | `getRecordByHash` |
| `/verify/:transactionId` | GET | 一键验证交易 | 计算本地SM3 → `getRecordByHash` 比对 |
| `/explorer` | GET | 浏览器概览数据 | `getTotalRecords` + 最近N条 |

#### `GET /records` 参数
- `page` (默认1)
- `pageSize` (默认20, 最大100)
- `type` (可选: loan, repay, register, zkp)
- `userId` (可选)

**实现方式：** FISCO BCOS Console 一次只能调用一个合约函数，分页查询需要循环调用 `getRecordByIndex(i)`。为避免性能问题，`explorer` 端点默认只返回最近 20 条记录。

#### `GET /verify/:transactionId` 逻辑
1. 从数据库查交易记录
2. 计算 SM3(transactionData)
3. 调用 `getRecordByHash(sm3Hash)` 查链上
4. 比对：链上存储的 hash === 本地计算的 hash
5. 返回 `{ isValid, localHash, chainHash, chainRecord }`

#### `GET /explorer` 返回
```json
{
  "totalRecords": 42,
  "recentRecords": [...],
  "typeStats": { "loan": 15, "repay": 10, "register": 12, "zkp": 5 }
}
```

### 1.3 修复 `verifyTransactionHash`

当前实现（blockchainServiceFisco.js:475）：
```javascript
// 只检查链上有没有记录，没比对一致性
const result = await this.contractCall('AuditStorage', 'getRecordByHash', [sm3Hash]);
return { success: true, isValid: true, ... };
```

修复为：
```javascript
const result = await this.contractCall('AuditStorage', 'getRecordByHash', [sm3Hash]);
if (!result || result === '0') {
  return { success: true, isValid: false, reason: '链上无此记录' };
}
// 比对链上存储的哈希与本地计算的哈希是否一致
return { success: true, isValid: true, storedHash: sm3Hash, chainRecord: result };
```

### 1.4 前端区块链页面

新增 `frontend/src/pages/BlockchainExplorer.js`，路由 `/blockchain`：

**布局：**
- 顶部统计卡片：总记录数、今日新增、按类型分布饼图
- 记录表格：时间、操作类型、用户ID、哈希前20位、状态
- 点击展开行：完整SM3哈希、区块号、交易哈希
- "验证交易"按钮：输入交易ID → 调用 `/verify/:id` → 显示绿色✅/红色❌

**Navbar 添加：** "区块链浏览器" 导航项

### 1.5 合约层增强（可选）

在 `AuditStorage.sol` 中新增事件：
```solidity
event AuditStored(string indexed sm3Hash, uint256 timestamp, string operationType, string indexed userId);
```
使链上记录可通过事件日志高效查询。

---

## 第二节：国密 NTLS 深度集成

### 2.1 问题诊断

当前 TLS 集成：
- SM2 证书在 TLS 层：服务端认证用了 SM2-with-SM3 ✅
- NTLS 协议未启用：Tengine 编译时未加 NTLS 模块 ❌
- 没有 SM2 双证书：只有单证书 ❌
- 和用普通 RSA 证书几乎没区别 ❌

### 2.2 Tengine NTLS 编译

Tengine 源码中有 `modules/ngx_tongsuo_ntls/` 模块，编译时启用 `T_NGX_SSL_NTLS` 宏。

重新编译命令：
```bash
cd ~/tengine
./configure \
  --add-module=modules/ngx_tongsuo_ntls \
  --with-http_ssl_module \
  --with-openssl=/home/ouye/tongsuo \
  --with-openssl-opt="enable-sm2 enable-sm3 enable-sm4 enable-ntls" \
  --with-http_v2_module
make -j$(nproc)
sudo make install
```

### 2.3 SM2 双证书生成

NTLS 要求两张证书：
- **签名证书** (sm2-sign.crt) — 用于身份认证和数字签名
- **加密证书** (sm2-enc.crt) — 用于密钥交换

生成流程：
```bash
# 签名密钥对 + 证书
openssl genpkey -algorithm SM2 -out sm2-sign.key
openssl req -new -key sm2-sign.key -out sm2-sign.csr -subj "/CN=localhost" -sm3
openssl x509 -req -in sm2-sign.csr -CA sm2-ca.crt -CAkey sm2-ca.key \
  -out sm2-sign.crt -days 365 -sm3

# 加密密钥对 + 证书
openssl genpkey -algorithm SM2 -out sm2-enc.key
openssl req -new -key sm2-enc.key -out sm2-enc.csr -subj "/CN=localhost" -sm3
openssl x509 -req -in sm2-enc.csr -CA sm2-ca.crt -CAkey sm2-ca.key \
  -out sm2-enc.crt -days 365 -sm3
```

### 2.4 Tengine NTLS 配置

```nginx
server {
    listen       443 ssl;
    server_name  localhost;

    # NTLS 配置
    enable_ntls              on;
    ssl_sign_certificate     /home/ouye/sm2-certs/sm2-sign.crt;
    ssl_sign_certificate_key /home/ouye/sm2-certs/sm2-sign.key;
    ssl_enc_certificate      /home/ouye/sm2-certs/sm2-enc.crt;
    ssl_enc_certificate_key  /home/ouye/sm2-certs/sm2-enc.key;

    # 同时支持标准 TLS（RSA 证书，浏览器兼容）
    ssl_certificate      /home/ouye/sm2-certs/rsa-server.crt;
    ssl_certificate_key  /home/ouye/sm2-certs/rsa-server.key;
    ssl_protocols        TLSv1.2 TLSv1.3;

    location /api/ {
        proxy_pass http://127.0.0.1:3003;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
    }
}
```

**关键特性：**
- 国密客户端连接 → 走 NTLS 协议（SM2 双证书认证）
- 普通浏览器连接 → 走标准 TLS（RSA 证书）
- 同一端口，自动协商协议

**回退方案：** 如果 Tengine 不支持同端口双协议，则：
- 端口 443：标准 TLS（RSA 证书，浏览器兼容）
- 端口 8443：NTLS（SM2 双证书，国密客户端）

### 2.5 验证方式

```bash
# NTLS 连接测试（Tongsuo 客户端）
echo -e "GET /api/v1/pool HTTP/1.1\r\nHost: localhost\r\n\r\n" | \
  /usr/local/tongsuo-static/bin/openssl s_client -connect localhost:443 \
  -ntls -sign_cert sm2-sign.crt -sign_key sm2-sign.key \
  -enc_cert sm2-enc.crt -enc_key sm2-enc.key

# 预期输出：
# Peer signing digest: SM3
# Peer signature type: sm2sig_sm3
# Protocol: NTLSv1.1
# + 后端 JSON 响应
```

---

## 第三节：统一启动与演示

### 3.1 启动脚本

新增 `scripts/start-system.sh`（WSL 中执行）：

```bash
#!/bin/bash
# FinZkTrust 一键启动

echo "=== 1. 检查 FISCO BCOS ==="
# 检查4个节点是否运行，未运行则启动

echo "=== 2. 启动后端 ==="
cd backend && BLOCKCHAIN_NETWORK=fisco-bcos node app.js &
sleep 3

echo "=== 3. 启动前端 ==="
cd frontend && npm start &

echo "=== 4. 启动 Tengine (国密NTLS) ==="
sudo /usr/local/tengine-ntls/sbin/nginx

echo "=== 系统就绪 ==="
echo "后端:      http://localhost:3003"
echo "前端:      http://localhost:3000"
echo "HTTPS:     https://localhost:443 (RSA)"
echo "NTLS:      国密客户端连接 localhost:443 (SM2)"
echo "区块链:    http://localhost:3000/blockchain"
```

### 3.2 演示脚本

新增 `scripts/demo-flow.sh`：

自动演示完整业务流程，每步输出区块链状态：
1. 注册用户 → 链上记录 +1
2. 登录
3. 生成 ZK 证明 → 链上记录 +1
4. 借款 → 链上记录 +1
5. 验证交易 → 本地哈希 vs 链上哈希 ✅
6. 查询链上所有记录 → 展示表格
7. NTLS 连接测试 → SM2 握手成功

### 3.3 package.json 脚本更新

```json
{
  "scripts": {
    "demo": "node test/fisco-e2e.js",
    "demo:full": "bash ../scripts/demo-flow.sh",
    "start:system": "bash ../scripts/start-system.sh"
  }
}
```

---

## 文件变更清单

### 新增文件
| 文件 | 用途 |
|------|------|
| `backend/routes/blockchain.js` | 区块链查询/验证 API |
| `frontend/src/pages/BlockchainExplorer.js` | 区块链浏览器页面 |
| `scripts/start-system.sh` | 一键启动脚本 |
| `scripts/demo-flow.sh` | 演示流程脚本 |

### 修改文件
| 文件 | 改动 |
|------|------|
| `backend/services/blockchainServiceFisco.js` | 修复 `verifyTransactionHash` 比对逻辑 |
| `backend/services/blockchainServiceHardhat.js` | 同步修复 `verifyTransactionHash` |
| `backend/app.js` | 挂载 blockchain 路由 |
| `frontend/src/App.js` | 添加 /blockchain 路由 |
| `frontend/src/components/Navbar.js` | 添加"区块链浏览器"导航项 |
| `scripts/wsl/setup-guomi-tls.sh` | 更新 Tengine 编译命令（加 NTLS 模块） |

---

## 实施顺序

1. **Tengine NTLS 重新编译** — 启用 `ngx_tongsuo_ntls` 模块
2. **SM2 双证书生成** — 签名 + 加密证书
3. **Tengine NTLS 配置** — `enable_ntls on` + 双证书
4. **NTLS 验证** — Tongsuo s_client 测试 NTLS 握手
5. **blockchain 路由** — 新增 API 端点
6. **修复 verifyTransactionHash** — 比对逻辑
7. **前端区块链页面** — React 组件
8. **启动脚本** — start-system.sh
9. **演示脚本** — demo-flow.sh
10. **端到端验证** — 完整流程测试
