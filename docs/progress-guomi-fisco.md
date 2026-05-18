# 国密 HTTPS + FISCO BCOS 进度记录

> 日期: 2026-05-18
> 状态: 任务2完成，任务1进行中

---

## 任务 2: 国密 HTTPS 传输层加密 ✅ 已完成

### 目标
替代 local-ssl-proxy + 自签名 RSA 证书，使用 Tengine + Tongsuo 实现 SM2/RSA 双证书 HTTPS。

### 完成内容

| 组件 | 状态 | 位置 |
|------|------|------|
| Tongsuo (国密SSL库) | ✅ 编译安装 | `/usr/local/tongsuo` |
| Tengine (Nginx国密版) | ✅ 编译安装 | `/usr/local/tengine` |
| SM2 CA 证书 | ✅ 生成 | `~/sm2-certs/sm2-ca.crt` |
| SM2 服务器证书 | ✅ 生成 | `~/sm2-certs/sm2-server.crt` |
| RSA 服务器证书 | ✅ 生成 | `~/sm2-certs/rsa-server.crt` |
| Tengine 配置 | ✅ 配置 | `/usr/local/tengine/conf/nginx.conf` |
| 前端代理更新 | ✅ 修改 | `frontend/src/setupProxy.js` |
| 安装脚本 | ✅ 创建 | `scripts/wsl/setup-guomi-tls.sh` |
| 测试脚本 | ✅ 创建 | `scripts/wsl/test-guomi-tls.sh` |
| 演示脚本 | ✅ 创建 | `scripts/wsl/sm2-tls-demo.sh` |
| 文档 | ✅ 创建 | `docs/guomi-https-guide.md` |

### 测试结果
```
✓ Tengine 正在运行
✓ SM2 证书存在 (CN=localhost, O=FinZkTrust, C=CN)
✓ RSA 证书存在
✓ RSA HTTPS 连接成功 (TLSv1.3)
✓ 支持 4 个 SM2 密码套件:
  - ECC-SM2-SM4-GCM-SM3 (NTLSv1.1)
  - ECDHE-SM2-SM4-GCM-SM3 (NTLSv1.1)
  - ECC-SM2-SM4-CBC-SM3 (NTLSv1.1)
  - ECDHE-SM2-SM4-CBC-SM3 (NTLSv1.1)
```

### WSL2 环境配置
- 镜像网络模式: `C:\Users\联想\.wslconfig` → `networkingMode=mirrored`
- 代理: `localhost:7897` (Clash Verge, Allow LAN 已开启)

---

## 任务 1: FISCO BCOS 联盟链适配 ⏳ 进行中

### 目标
从 Hardhat 本地私链迁移到 FISCO BCOS 4 节点联盟链，实现:
1. 多方共识审计存证
2. 可监管审计的零知识证明存证
3. 多方验证的用户公钥锚定

### 已完成

| 内容 | 状态 |
|------|------|
| FISCO BCOS Docker 镜像 | ✅ 已拉取 (v2.9.0) |
| build_chain.sh 脚本 | ✅ 已下载 |

### 未完成 (按顺序)

1. **修复 OpenSSL 版本兼容**
   - `build_chain.sh` 第 254 行检查 OpenSSL 1.0.2/1.1
   - WSL 有 OpenSSL 3.0.13，需要修改检查逻辑

2. **生成 4 节点网络**
   ```bash
   bash build_chain.sh -l 127.0.0.1:4 -o ~/fisco-bcos-node -p 30300,20200,8545
   ```

3. **启动 4 个 Docker 容器**
   - 每个节点一个容器
   - 端口映射: 30300-30303 (P2P), 8545-8548 (RPC), 20200-20203 (Channel)

4. **智能合约部署**
   - 现有合约 (AuditStorage, ZKPVerifier, UserRegistry) 部署到 FISCO BCOS
   - Verifier.sol 需要验证 EVM 预编译兼容性

5. **blockchainService.js 适配**
   - 从 ethers.js 改为 FISCO BCOS JSON-RPC 调用
   - 或使用 FISCO BCOS Node.js SDK

6. **多方共识验证**
   - 展示 4 节点共识效果
   - 验证审计存证在多节点间一致

7. **前端/测试更新**
   - 适配新的链端点
   - 更新相关测试

### 关键设计决策
- **智能合约基本不变** — FISCO BCOS 支持 Solidity，合约逻辑无需修改
- **交易签名方式变了** — FISCO BCOS 使用 SM2 签名（不是 ECDSA）
- **必须 4 节点** — 单节点无意义，联盟链核心价值是多方共识

---

## 文件清单

### 新增文件
- `scripts/wsl/setup-guomi-tls.sh` — 国密HTTPS一键安装
- `scripts/wsl/test-guomi-tls.sh` — 国密HTTPS测试
- `scripts/wsl/sm2-tls-demo.sh` — SM2 TLS演示
- `scripts/wsl/setup-fisco-bcos.sh` — FISCO BCOS部署(待完善)
- `docs/guomi-https-guide.md` — 国密HTTPS文档
- `docs/progress-guomi-fisco.md` — 本文件

### 修改文件
- `frontend/src/setupProxy.js` — 代理目标改为 `https://localhost:443`
- `backend/package.json` — 添加 `proxy-ssl:guomi` 脚本

---

## 下次继续

从修复 `build_chain.sh` 的 OpenSSL 版本检查开始，然后生成 4 节点网络。
