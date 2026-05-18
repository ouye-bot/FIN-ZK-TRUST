#!/bin/bash
# SM2 TLS 演示脚本
# 使用 Tongsuo 的 openssl s_server 演示国密 TLS 连接

set -e

TONGSUO="/usr/local/tongsuo/bin/openssl"
CERT_DIR="$HOME/sm2-certs"
export LD_LIBRARY_PATH=/usr/local/tongsuo/lib64

echo "=== SM2 TLS 演示 ==="
echo ""
echo "证书信息："
$TONGSUO x509 -in "$CERT_DIR/sm2-server.crt" -noout -subject -issuer
echo ""
echo "支持的 SM2 密码套件："
$TONGSUO ciphers -v 2>/dev/null | grep -i sm2 | awk '{print $1}'
echo ""
echo "启动 SM2 TLS 服务器在端口 8443..."
echo "使用以下命令测试："
echo "  $TONGSUO s_client -connect localhost:8443 -servername localhost -ntls"
echo ""
echo "按 Ctrl+C 停止服务器"
echo ""

# 启动 SM2 TLS 服务器
$TONGSUO s_server \
    -accept 8443 \
    -cert "$CERT_DIR/sm2-server.crt" \
    -key "$CERT_DIR/sm2-server.key" \
    -www \
    -ntls
