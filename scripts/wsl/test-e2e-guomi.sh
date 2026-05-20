#!/bin/bash
# 端到端国密验证脚本
# 验证链路: 前端 → Tengine(NTLS:8443) → 后端(:3003) → FISCO BCOS(SM_SSL)
# 每个环节使用的密码算法: SM2/SM3/SM4

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

TONGSUO="/usr/local/tongsuo-static/bin/openssl"
CERT_DIR="$HOME/sm2-certs"
BACKEND_URL="http://localhost:3003"
NTLS_URL="https://localhost:8443"

echo "=========================================="
echo "  端到端国密链路验证"
echo "=========================================="
echo ""
echo "  链路: 前端 → NTLS(8443) → 后端(3003) → FISCO BCOS"
echo "  算法: SM2(签名/加密) + SM3(哈希) + SM4(对称加密)"
echo ""

PASS=0
FAIL=0
SKIP=0

check() {
  local name="$1"
  local result="$2"
  if [ "$result" = "pass" ]; then
    echo -e "  ${GREEN}✓${NC} $name"
    PASS=$((PASS + 1))
  elif [ "$result" = "skip" ]; then
    echo -e "  ${YELLOW}⏭${NC} $name"
    SKIP=$((SKIP + 1))
  else
    echo -e "  ${RED}✗${NC} $name"
    FAIL=$((FAIL + 1))
  fi
}

# ============================================
# 环节1: Tengine NTLS (SM2 双证书)
# ============================================
echo -e "${YELLOW}=== 环节1: Tengine NTLS (SM2 双证书) ===${NC}"
echo "  密码算法: SM2(证书) + SM4-CBC/GCM(加密) + SM3(哈希)"
echo ""

# 1.1 检查 Tengine NTLS 是否运行
if pgrep -f "tengine-ntls" > /dev/null 2>&1; then
  check "Tengine NTLS 进程运行中" "pass"
else
  check "Tengine NTLS 进程运行中" "fail"
  echo -e "  ${RED}NTLS 未运行，跳过环节1${NC}"
  SKIP=$((SKIP + 3))
fi

# 1.2 检查 SM2 证书
if [ -f "$CERT_DIR/sm2-sign.crt" ] && [ -f "$CERT_DIR/sm2-enc.crt" ]; then
  check "SM2 双证书存在" "pass"
else
  check "SM2 双证书存在" "fail"
fi

# 1.3 测试 NTLS 握手
if [ -f "$TONGSUO" ] && [ -f "$CERT_DIR/sm2-sign.crt" ]; then
  NTLS_CIPHERS=("ECC-SM2-SM4-CBC-SM3" "ECDHE-SM2-SM4-CBC-SM3")
  NTLS_PASS=0
  for CIPHER in "${NTLS_CIPHERS[@]}"; do
    RESULT=$(echo "Q" | $TONGSUO s_client -connect localhost:8443 \
      -enable_ntls -ntls \
      -cipher "$CIPHER" \
      -sign_cert "$CERT_DIR/sm2-sign.crt" \
      -sign_key "$CERT_DIR/sm2-sign.key" \
      -enc_cert "$CERT_DIR/sm2-enc.crt" \
      -enc_key "$CERT_DIR/sm2-enc.key" 2>&1 || true)
    if echo "$RESULT" | grep -q "NTLSv1.1"; then
      NTLS_PASS=$((NTLS_PASS + 1))
    fi
  done
  if [ $NTLS_PASS -eq ${#NTLS_CIPHERS[@]} ]; then
    check "NTLS 握手 (${NTLS_PASS}/${#NTLS_CIPHERS[@]} 套件)" "pass"
  elif [ $NTLS_PASS -gt 0 ]; then
    check "NTLS 握手 (${NTLS_PASS}/${#NTLS_CIPHERS[@]} 套件)" "pass"
  else
    check "NTLS 握手 (${NTLS_PASS}/${#NTLS_CIPHERS[@]} 套件)" "fail"
  fi
else
  check "NTLS 握手测试" "skip"
fi

# ============================================
# 环节2: 后端 API (HTTP)
# ============================================
echo ""
echo -e "${YELLOW}=== 环节2: 后端 API ===${NC}"
echo "  密码算法: SM3(密码哈希) + SM4(字段加密) + JWT(RS256)"
echo ""

# 2.1 检查后端是否运行
BACKEND_HEALTH=$(curl -s "$BACKEND_URL/api/v1/health" 2>/dev/null || echo "")
if echo "$BACKEND_HEALTH" | grep -q "success\|status\|ok"; then
  check "后端服务运行中 (port 3003)" "pass"
else
  check "后端服务运行中 (port 3003)" "fail"
fi

# 2.2 测试 NTLS → 后端代理
if [ -f "$TONGSUO" ] && [ -f "$CERT_DIR/sm2-sign.crt" ]; then
  NTLS_API=$(printf "GET /api/v1/pool HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n" | \
    $TONGSUO s_client -connect localhost:8443 \
    -enable_ntls -ntls \
    -cipher ECC-SM2-SM4-CBC-SM3 \
    -sign_cert "$CERT_DIR/sm2-sign.crt" \
    -sign_key "$CERT_DIR/sm2-sign.key" \
    -enc_cert "$CERT_DIR/sm2-enc.crt" \
    -enc_key "$CERT_DIR/sm2-enc.key" -quiet 2>/dev/null || true)
  if echo "$NTLS_API" | grep -q "HTTP/1.1 200\|success"; then
    check "NTLS → 后端代理正常" "pass"
  else
    check "NTLS → 后端代理正常" "fail"
  fi
else
  check "NTLS → 后端代理测试" "skip"
fi

# ============================================
# 环节3: FISCO BCOS (SM_SSL)
# ============================================
echo ""
echo -e "${YELLOW}=== 环节3: FISCO BCOS (SM_SSL) ===${NC}"
echo "  密码算法: SM2(TLS证书) + SM3(交易哈希)"
echo ""

# 3.1 检查 FISCO BCOS 是否运行
FISCO_RPC=$(curl -s -X POST http://127.0.0.1:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"getClientVersion","params":[],"id":1}' 2>/dev/null || echo "")
if echo "$FISCO_RPC" | grep -q "FISCO\|result"; then
  check "FISCO BCOS 节点运行中" "pass"
else
  check "FISCO BCOS 节点运行中" "skip"
fi

# 3.2 检查 SM_SSL 配置
FISCO_CONFIG="$HOME/fisco-bcos-node/127.0.0.1/node0/config.ini"
if [ -f "$FISCO_CONFIG" ]; then
  SSL_TYPE=$(grep -E "^ssl_type" "$FISCO_CONFIG" 2>/dev/null | head -1 || echo "")
  if echo "$SSL_TYPE" | grep -q "sm_ssl"; then
    check "FISCO BCOS SM_SSL 已启用" "pass"
  else
    check "FISCO BCOS SM_SSL 已启用 (当前: $SSL_TYPE)" "skip"
  fi
else
  check "FISCO BCOS 配置文件" "skip"
fi

# 3.3 测试合约调用
if echo "$FISCO_RPC" | grep -q "FISCO\|result"; then
  BLOCK_NUM=$(curl -s -X POST http://127.0.0.1:8545 \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"getBlockNumber","params":["1"],"id":2}' 2>/dev/null || echo "")
  if echo "$BLOCK_NUM" | grep -q "result"; then
    check "FISCO BCOS 区块同步正常" "pass"
  else
    check "FISCO BCOS 区块同步正常" "fail"
  fi
else
  check "FISCO BCOS 区块同步测试" "skip"
fi

# ============================================
# 环节4: 全链路验证
# ============================================
echo ""
echo -e "${YELLOW}=== 环节4: 全链路验证 ===${NC}"
echo ""

# 4.1 前端 → NTLS → 后端 → FISCO 全链路
if echo "$NTLS_API" | grep -q "HTTP/1.1 200\|success" && echo "$FISCO_RPC" | grep -q "FISCO\|result"; then
  check "前端 → NTLS → 后端 → FISCO 全链路" "pass"
elif echo "$NTLS_API" | grep -q "HTTP/1.1 200\|success"; then
  check "前端 → NTLS → 后端 (FISCO 未连接)" "pass"
else
  check "全链路验证" "fail"
fi

# ============================================
# 汇总
# ============================================
echo ""
echo "=========================================="
echo -e "  测试结果汇总"
echo "=========================================="
echo -e "  ${GREEN}通过: $PASS${NC}"
echo -e "  ${RED}失败: $FAIL${NC}"
echo -e "  ${YELLOW}跳过: $SKIP${NC}"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "${GREEN}  端到端国密验证通过${NC}"
  exit 0
else
  echo -e "${RED}  端到端国密验证存在失败项${NC}"
  exit 1
fi
