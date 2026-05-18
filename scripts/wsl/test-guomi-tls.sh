#!/bin/bash
# 国密 HTTPS 测试脚本
# 测试 Tengine + Tongsuo 的 SM2/RSA 双证书配置

set -e

TONGSUO="/usr/local/tongsuo/bin/openssl"
CERT_DIR="$HOME/sm2-certs"
export LD_LIBRARY_PATH=/usr/local/tongsuo/lib64

echo "=========================================="
echo "  国密 HTTPS 测试"
echo "=========================================="
echo ""

# 1. 检查 Tengine 是否运行
echo "[1/5] 检查 Tengine 状态..."
if pgrep -x nginx > /dev/null; then
    echo "  ✓ Tengine 正在运行"
else
    echo "  ✗ Tengine 未运行，请先启动: sudo /usr/local/tengine/sbin/nginx"
    exit 1
fi

# 2. 检查证书
echo "[2/5] 检查 SM2 证书..."
if [ -f "$CERT_DIR/sm2-server.crt" ]; then
    echo "  ✓ SM2 证书存在"
    echo "  证书信息:"
    $TONGSUO x509 -in "$CERT_DIR/sm2-server.crt" -noout -subject -issuer -dates 2>/dev/null | sed 's/^/    /'
else
    echo "  ✗ SM2 证书不存在"
    exit 1
fi

if [ -f "$CERT_DIR/rsa-server.crt" ]; then
    echo "  ✓ RSA 证书存在"
else
    echo "  ✗ RSA 证书不存在"
    exit 1
fi

# 3. 测试 RSA HTTPS 连接
echo ""
echo "[3/5] 测试 RSA HTTPS 连接 (TLSv1.3)..."
RSA_RESULT=$(curl -sk https://localhost 2>&1 | head -1)
if [ -n "$RSA_RESULT" ]; then
    echo "  ✓ RSA HTTPS 连接成功"
    echo "  响应: $RSA_RESULT"
else
    echo "  ✗ RSA HTTPS 连接失败"
fi

# 4. 测试 SM2 证书内容
echo ""
echo "[4/5] 验证 SM2 证书内容..."
SM2_SUBJECT=$($TONGSUO x509 -in "$CERT_DIR/sm2-server.crt" -noout -subject 2>/dev/null)
SM2_ISSUER=$($TONGSUO x509 -in "$CERT_DIR/sm2-server.crt" -noout -issuer 2>/dev/null)
SM2_ALGO=$($TONGSUO x509 -in "$CERT_DIR/sm2-server.crt" -noout -text 2>/dev/null | grep "Public Key Algorithm" | head -1)

echo "  主题: $SM2_SUBJECT"
echo "  颁发者: $SM2_ISSUER"
echo "  算法: $SM2_ALGO"

# 5. 检查 SM2 密码套件
echo ""
echo "[5/5] 检查 SM2 密码套件..."
SM2_CIPHERS=$($TONGSUO ciphers -v 2>/dev/null | grep -i sm2 | wc -l)
echo "  ✓ 支持 $SM2_CIPHERS 个 SM2 密码套件"
echo "  密码套件列表:"
$TONGSUO ciphers -v 2>/dev/null | grep -i sm2 | awk '{print "    " $1 " (" $2 ")"}'

echo ""
echo "=========================================="
echo "  测试完成"
echo "=========================================="
echo ""
echo "RSA HTTPS 可通过浏览器访问: https://localhost"
echo "SM2 TLS 需要使用 Tongsuo 客户端:"
echo "  $TONGSUO s_client -connect localhost:8443 -servername localhost -ntls"
echo ""
