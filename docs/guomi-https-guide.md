# 国密 HTTPS 配置指南

## 概述

本系统使用 **Tengine + Tongsuo** 实现国密 HTTPS 传输层加密，支持 SM2/RSA 双证书模式。

### 架构

```
浏览器/客户端
    │
    ├── HTTPS (RSA) ──→ Tengine (:443) ──→ Node.js Backend (:3003)
    │
    └── NTLS (SM2) ──→ Tongsuo s_server (:8443) ──→ Node.js Backend (:3003)
```

### 技术栈

| 组件 | 用途 |
|------|------|
| **Tongsuo** | 国密 SSL 库（铜锁），支持 SM2/SM3/SM4 |
| **Tengine** | 阿里巴巴 Nginx 分支，编译时链接 Tongsuo |
| **SM2 证书** | 国密 TLS 证书，用于 NTLS 协议 |
| **RSA 证书** | 标准 TLS 证书，用于普通浏览器 |

## 环境要求

- Windows 11 22H2+（支持 WSL2 镜像网络模式）
- WSL2 Ubuntu 24.04
- 构建工具：gcc, make, perl

## 快速安装

### 1. 配置 WSL2 镜像网络

在 `C:\Users\<用户名>\.wslconfig` 中添加：

```ini
[wsl2]
networkingMode=mirrored
```

然后重启 WSL：

```powershell
wsl --shutdown
```

### 2. 运行安装脚本

```bash
wsl -- bash -c "cd /mnt/d/ZK\ SM\ DEFI/fin-zk-trust-master/fin-zk-trust-master && bash scripts/wsl/setup-guomi-tls.sh"
```

### 3. 启动 Tengine

```bash
wsl -- bash -c "export LD_LIBRARY_PATH=/usr/local/tongsuo/lib64 && sudo /usr/local/tengine/sbin/nginx"
```

### 4. 验证安装

```bash
wsl -- bash -c "bash /mnt/d/ZK\ SM\ DEFI/fin-zk-trust-master/fin-zk-trust-master/scripts/wsl/test-guomi-tls.sh"
```

## 证书说明

### SM2 证书

- **算法**：SM2 椭圆曲线（256 位）
- **哈希**：SM3
- **用途**：国密 TLS 客户端（如支持 NTLS 的浏览器/工具）
- **位置**：`~/sm2-certs/sm2-server.crt` / `sm2-server.key`

### RSA 证书

- **算法**：ECDSA P-256（兼容 RSA 语义）
- **哈希**：SHA-256
- **用途**：标准浏览器兼容
- **位置**：`~/sm2-certs/rsa-server.crt` / `rsa-server.key`

## SM2 TLS 演示

使用 Tongsuo 的 `openssl s_server` 演示 SM2 TLS 连接：

```bash
# 终端 1：启动 SM2 TLS 服务器
wsl -- bash -c "export LD_LIBRARY_PATH=/usr/local/tongsuo/lib64 && /usr/local/tongsuo/bin/openssl s_server -accept 8443 -cert ~/sm2-certs/sm2-server.crt -key ~/sm2-certs/sm2-server.key -www -ntls"

# 终端 2：连接 SM2 TLS 服务器
wsl -- bash -c "export LD_LIBRARY_PATH=/usr/local/tongsuo/lib64 && /usr/local/tongsuo/bin/openssl s_client -connect localhost:8443 -servername localhost -ntls"
```

### SM2 密码套件

| 密码套件 | 协议 | 密钥交换 | 加密 | 哈希 |
|---------|------|---------|------|------|
| ECDHE-SM2-SM4-GCM-SM3 | NTLSv1.1 | SM2DHE | SM4-GCM | SM3 |
| ECC-SM2-SM4-GCM-SM3 | NTLSv1.1 | SM2 | SM4-GCM | SM3 |
| ECDHE-SM2-SM4-CBC-SM3 | NTLSv1.1 | SM2DHE | SM4-CBC | SM3 |
| ECC-SM2-SM4-CBC-SM3 | NTLSv1.1 | SM2 | SM4-CBC | SM3 |

## 前端配置

前端代理配置在 `frontend/src/setupProxy.js`：

```javascript
const HTTPS_TARGET = process.env.HTTPS_TARGET || 'https://localhost:443';
```

- 默认使用 Tengine（端口 443）
- 可通过环境变量切换到 local-ssl-proxy（端口 8443）

## 浏览器兼容性

| 浏览器 | RSA HTTPS | SM2 NTLS |
|--------|-----------|----------|
| Chrome | ✓ | 需要扩展 |
| Firefox | ✓ | ✗ |
| Safari | ✓ | ✗ |
| Edge | ✓ | 需要扩展 |
| Tongsuo curl | ✓ | ✓ |

## 故障排除

### Tengine 启动失败

```bash
# 检查端口占用
wsl -- bash -c "sudo ss -tlnp | grep :443"

# 检查配置语法
wsl -- bash -c "export LD_LIBRARY_PATH=/usr/local/tongsuo/lib64 && sudo /usr/local/tengine/sbin/nginx -t"

# 查看错误日志
wsl -- bash -c "sudo cat /usr/local/tengine/logs/error.log"
```

### 证书问题

```bash
# 验证 SM2 证书
wsl -- bash -c "export LD_LIBRARY_PATH=/usr/local/tongsuo/lib64 && /usr/local/tongsuo/bin/openssl x509 -in ~/sm2-certs/sm2-server.crt -noout -text"

# 验证证书链
wsl -- bash -c "export LD_LIBRARY_PATH=/usr/local/tongsuo/lib64 && /usr/local/tongsuo/bin/openssl verify -CAfile ~/sm2-certs/sm2-ca.crt ~/sm2-certs/sm2-server.crt"
```

### WSL2 网络问题

如果 WSL2 无法访问 Windows 代理：

1. 确保 `.wslconfig` 中启用了 `networkingMode=mirrored`
2. 重启 WSL：`wsl --shutdown`
3. 确保代理软件开启了 Allow LAN

## 相关文件

- `scripts/wsl/setup-guomi-tls.sh` - 一键安装脚本
- `scripts/wsl/test-guomi-tls.sh` - 测试脚本
- `scripts/wsl/sm2-tls-demo.sh` - SM2 TLS 演示脚本
- `frontend/src/setupProxy.js` - 前端代理配置
- `backend/app.js` - CORS 配置
