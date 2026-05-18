#!/bin/bash
# 国密 HTTPS 一键安装脚本
# 在 WSL2 Ubuntu 中编译 Tongsuo + Tengine，配置 SM2 双证书

set -e

SUDO_PASS="080516"
TONGSUO_DIR="$HOME/tongsuo"
TENGINE_DIR="$HOME/tengine"
CERT_DIR="$HOME/sm2-certs"
TONGSUO_PREFIX="/usr/local/tongsuo"
TENGINE_PREFIX="/usr/local/tengine"

echo "=========================================="
echo "  国密 HTTPS 环境安装脚本"
echo "  Tongsuo + Tengine + SM2 双证书"
echo "=========================================="
echo ""

# 1. 安装依赖
echo "[1/6] 安装构建依赖..."
echo "$SUDO_PASS" | sudo -S apt-get update -qq
echo "$SUDO_PASS" | sudo -S apt-get install -y -qq build-essential libpcre3-dev zlib1g-dev git

# 2. 编译安装 Tongsuo
echo "[2/6] 编译安装 Tongsuo (国密 SSL 库)..."
if [ ! -d "$TONGSUO_DIR" ]; then
    git clone --depth 1 https://github.com/Tongsuo-Project/Tongsuo.git "$TONGSUO_DIR"
fi
cd "$TONGSUO_DIR"
./Configure --prefix="$TONGSUO_PREFIX" enable-sm2 enable-sm3 enable-sm4 enable-ntls
make -j$(nproc)
echo "$SUDO_PASS" | sudo -S make install_sw
echo "Tongsuo 安装完成: $TONGSUO_PREFIX"

# 3. 编译安装 Tengine
echo "[3/6] 编译安装 Tengine (Nginx 国密版)..."
if [ ! -d "$TENGINE_DIR" ]; then
    git clone --depth 1 https://github.com/alibaba/tengine.git "$TENGINE_DIR"
fi
cd "$TENGINE_DIR"
./configure \
    --prefix="$TENGINE_PREFIX" \
    --with-http_ssl_module \
    --with-openssl="$TONGSUO_DIR" \
    --with-openssl-opt='enable-sm2 enable-sm3 enable-sm4 enable-ntls' \
    --with-http_v2_module
make -j$(nproc)
echo "$SUDO_PASS" | sudo -S make install
echo "Tengine 安装完成: $TENGINE_PREFIX"

# 4. 生成 SM2 证书
echo "[4/6] 生成 SM2 + RSA 双证书..."
mkdir -p "$CERT_DIR"
export LD_LIBRARY_PATH="$TONGSUO_PREFIX/lib64"

# SM2 CA 证书
$TONGSUO_PREFIX/bin/openssl ecparam -genkey -name SM2 -out "$CERT_DIR/sm2-ca.key"
$TONGSUO_PREFIX/bin/openssl req -new -x509 -key "$CERT_DIR/sm2-ca.key" -out "$CERT_DIR/sm2-ca.crt" \
    -days 3650 -subj '/CN=FinZkTrust SM2 CA/O=FinZkTrust/C=CN' -sm3

# SM2 服务器证书
$TONGSUO_PREFIX/bin/openssl ecparam -genkey -name SM2 -out "$CERT_DIR/sm2-server.key"
$TONGSUO_PREFIX/bin/openssl req -new -key "$CERT_DIR/sm2-server.key" -out "$CERT_DIR/sm2-server.csr" \
    -subj '/CN=localhost/O=FinZkTrust/C=CN' -sm3
$TONGSUO_PREFIX/bin/openssl x509 -req -in "$CERT_DIR/sm2-server.csr" \
    -CA "$CERT_DIR/sm2-ca.crt" -CAkey "$CERT_DIR/sm2-ca.key" -CAcreateserial \
    -out "$CERT_DIR/sm2-server.crt" -days 365 -sm3

# RSA 服务器证书（浏览器兼容）
$TONGSUO_PREFIX/bin/openssl ecparam -genkey -name prime256v1 -out "$CERT_DIR/rsa-server.key"
$TONGSUO_PREFIX/bin/openssl req -new -x509 -key "$CERT_DIR/rsa-server.key" -out "$CERT_DIR/rsa-server.crt" \
    -days 365 -subj '/CN=localhost/O=FinZkTrust/C=CN'

echo "证书生成完成: $CERT_DIR"

# 5. 配置 Tengine
echo "[5/6] 配置 Tengine..."
echo "$SUDO_PASS" | sudo -S tee "$TENGINE_PREFIX/conf/nginx.conf" > /dev/null << 'NGINX_EOF'
worker_processes  1;

events {
    worker_connections  1024;
}

http {
    include       mime.types;
    default_type  application/octet-stream;

    sendfile        on;
    keepalive_timeout  65;

    gzip  on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    server {
        listen       443 ssl;
        server_name  localhost;

        # RSA certificate (for standard browsers)
        ssl_certificate      /home/ouye/sm2-certs/rsa-server.crt;
        ssl_certificate_key  /home/ouye/sm2-certs/rsa-server.key;

        ssl_protocols  TLSv1.2 TLSv1.3;
        ssl_ciphers  HIGH:!aNULL:!MD5;
        ssl_session_cache   shared:SSL:10m;
        ssl_session_timeout 10m;

        # API reverse proxy
        location /api/ {
            proxy_pass http://127.0.0.1:3003;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_ssl_verify off;
        }

        # Circuit files
        location /circuits/ {
            proxy_pass http://127.0.0.1:3003;
            proxy_set_header Host $host;
        }

        # Swagger docs
        location /api-docs/ {
            proxy_pass http://127.0.0.1:3003;
            proxy_set_header Host $host;
        }

        # Frontend
        location / {
            proxy_pass http://127.0.0.1:3000;
            proxy_set_header Host $host;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
NGINX_EOF

echo "$SUDO_PASS" | sudo -S chmod 777 "$TENGINE_PREFIX/logs"

# 6. 测试配置
echo "[6/6] 测试配置..."
export LD_LIBRARY_PATH="$TONGSUO_PREFIX/lib64"
echo "$SUDO_PASS" | sudo -S "$TENGINE_PREFIX/sbin/nginx" -t

echo ""
echo "=========================================="
echo "  安装完成！"
echo "=========================================="
echo ""
echo "启动 Tengine:  sudo $TENGINE_PREFIX/sbin/nginx"
echo "停止 Tengine:  sudo $TENGINE_PREFIX/sbin/nginx -s stop"
echo "SM2 TLS 演示:  bash scripts/wsl/sm2-tls-demo.sh"
echo ""
echo "证书位置: $CERT_DIR"
echo "Tongsuo:  $TONGSUO_PREFIX"
echo "Tengine:  $TENGINE_PREFIX"
echo ""
