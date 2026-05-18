#!/bin/bash
# 国密 HTTPS + NTLS 测试脚本
# 测试 Tengine + Tongsuo 的 SM2/RSA 双证书 + NTLS 协议

set -e

TONGSUO="/usr/local/tongsuo-static/bin/openssl"
CERT_DIR="$HOME/sm2-certs"

echo "=========================================="
echo "  国密 HTTPS + NTLS 测试"
echo "=========================================="
echo ""

# 1. 检查 Tengine 是否运行
echo "[1/6] 检查 Tengine 状态..."
if pgrep -x nginx > /dev/null; then
    echo "  ✓ Tengine 正在运行"
else
    echo "  ✗ Tengine 未运行，请先启动: sudo /usr/local/tengine-ntls/sbin/nginx"
    exit 1
fi

# 2. 检查证书
echo "[2/6] 检查 SM2 证书..."
if [ -f "$CERT_DIR/sm2-sign.crt" ]; then
    echo "  ✓ SM2 签名证书存在"
    $TONGSUO x509 -in "$CERT_DIR/sm2-sign.crt" -noout -subject -issuer 2>/dev/null | sed 's/^/    /'
else
    echo "  ✗ SM2 签名证书不存在"
    exit 1
fi

if [ -f "$CERT_DIR/sm2-enc.crt" ]; then
    echo "  ✓ SM2 加密证书存在"
else
    echo "  ✗ SM2 加密证书不存在"
    exit 1
fi

if [ -f "$CERT_DIR/rsa-server.crt" ]; then
    echo "  ✓ RSA 证书存在"
else
    echo "  ✗ RSA 证书不存在"
    exit 1
fi

# 3. 测试 NTLS 握手（SM2 双证书）
echo ""
echo "[3/6] 测试 NTLS 握手 (SM2 双证书)..."
NTLS_CIPHERS=("ECC-SM2-SM4-CBC-SM3" "ECC-SM2-SM4-GCM-SM3" "ECDHE-SM2-SM4-CBC-SM3" "ECDHE-SM2-SM4-GCM-SM3")
NTLS_PASS=0
for CIPHER in "${NTLS_CIPHERS[@]}"; do
    RESULT=$(echo "Q" | $TONGSUO s_client -connect localhost:8443 \
        -enable_ntls -ntls \
        -cipher "$CIPHER" \
        -sign_cert "$CERT_DIR/sm2-sign.crt" \
        -sign_key "$CERT_DIR/sm2-sign.key" \
        -enc_cert "$CERT_DIR/sm2-enc.crt" \
        -enc_key "$CERT_DIR/sm2-enc.key" 2>&1)
    if echo "$RESULT" | grep -q "NTLSv1.1"; then
        echo "  ✓ $CIPHER — NTLSv1.1 握手成功"
        NTLS_PASS=$((NTLS_PASS + 1))
    else
        echo "  ✗ $CIPHER — 握手失败"
    fi
done
echo "  通过: $NTLS_PASS/${#NTLS_CIPHERS[@]}"

# 4. 测试 NTLS 完整请求
echo ""
echo "[4/6] 测试 NTLS 完整 HTTP 请求..."
NTLS_HTTP=$(printf "GET /api/v1/pool HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" | \
    $TONGSUO s_client -connect localhost:8443 \
    -enable_ntls -ntls \
    -cipher ECC-SM2-SM4-CBC-SM3 \
    -sign_cert "$CERT_DIR/sm2-sign.crt" \
    -sign_key "$CERT_DIR/sm2-sign.key" \
    -enc_cert "$CERT_DIR/sm2-enc.crt" \
    -enc_key "$CERT_DIR/sm2-enc.key" -quiet 2>/dev/null)
if [ -n "$NTLS_HTTP" ]; then
    echo "  ✓ NTLS HTTP 请求成功"
    echo "  响应: $(echo "$NTLS_HTTP" | head -1)"
else
    echo "  ✗ NTLS HTTP 请求失败（后端可能未运行）"
fi

# 5. 测试 RSA HTTPS 连接
echo ""
echo "[5/6] 测试 RSA HTTPS 连接 (TLSv1.3)..."
RSA_RESULT=$(curl -sk https://localhost 2>&1 | head -1)
if [ -n "$RSA_RESULT" ]; then
    echo "  ✓ RSA HTTPS 连接成功"
    echo "  响应: $RSA_RESULT"
else
    echo "  ✗ RSA HTTPS 连接失败"
fi

# 6. 证书详情
echo ""
echo "[6/6] SM2 证书详情..."
echo "  签名证书:"
$TONGSUO x509 -in "$CERT_DIR/sm2-sign.crt" -noout -text 2>/dev/null | grep -E "Subject:|Issuer:|Signature Algorithm:" | head -3 | sed 's/^/    /'
echo "  加密证书:"
$TONGSUO x509 -in "$CERT_DIR/sm2-enc.crt" -noout -text 2>/dev/null | grep -E "Subject:|Issuer:|Signature Algorithm:" | head -3 | sed 's/^/    /'

echo ""
echo "=========================================="
echo "  测试完成"
echo "=========================================="
echo ""
echo "RSA HTTPS:   https://localhost (浏览器)"
echo "NTLS:        国密客户端连接 localhost:8443"
echo ""
echo "NTLS 测试命令:"
echo "  $TONGSUO s_client -connect localhost:8443 \\"
echo "    -enable_ntls -ntls -cipher ECC-SM2-SM4-CBC-SM3 \\"
echo "    -sign_cert $CERT_DIR/sm2-sign.crt \\"
echo "    -sign_key $CERT_DIR/sm2-sign.key \\"
echo "    -enc_cert $CERT_DIR/sm2-enc.crt \\"
echo "    -enc_key $CERT_DIR/sm2-enc.key"
echo ""
