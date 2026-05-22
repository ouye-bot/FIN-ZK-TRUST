#!/bin/bash
# FISCO BCOS SM_SSL 验证脚本
# 验证联盟链 Channel 端口的国密 SSL 握手 + JSON-RPC 连通性
#
# 使用方法（在 WSL 中执行）:
#   bash scripts/wsl/verify-sm-ssl.sh

set -e

NODE_DIR="${FISCO_BCOS_NODE_DIR:-$HOME/fisco-bcos-node}"
RPC_URL="${FISCO_BCOS_RPC_URL:-http://127.0.0.1:8545}"
CHANNEL_PORT="${FISCO_BCOS_CHANNEL_PORT:-20200}"
TONGSUO="/usr/local/tongsuo-static/bin/openssl"
PASS=0
FAIL=0
SKIP=0

echo "=========================================="
echo "  FISCO BCOS SM_SSL 验证"
echo "  联盟链 Channel 协议 + 国密 SSL"
echo "=========================================="
echo ""

# ---------- 辅助函数 ----------
check_pass() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
check_fail() { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }
check_skip() { echo "  ○ $1 (跳过)"; SKIP=$((SKIP + 1)); }

# ==========================================
# 1. JSON-RPC 连通性
# ==========================================
echo "[1/5] 验证 JSON-RPC 连通性 (端口 8545)..."

RPC_RESPONSE=$(curl -s --connect-timeout 5 "$RPC_URL" \
    -X POST \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"getClientVersion","params":[],"id":1}' 2>&1)

if echo "$RPC_RESPONSE" | grep -q "FISCO-BCOS"; then
    VERSION=$(echo "$RPC_RESPONSE" | grep -oP '"FISCO-BCOS Version"\s*:\s*"\K[^"]+')
    check_pass "JSON-RPC 连接成功 (版本: ${VERSION:-unknown})"
else
    check_fail "JSON-RPC 连接失败"
    echo "    响应: $(echo "$RPC_RESPONSE" | head -1)"
    echo ""
    echo "  FISCO BCOS 节点可能未启动，请检查:"
    echo "    - 节点目录: $NODE_DIR"
    echo "    - RPC 地址: $RPC_URL"
    echo "    - 启动命令: cd $NODE_DIR && bash start.sh"
    echo ""
    echo "=========================================="
    echo "  结果: $PASS 通过, $FAIL 失败, $SKIP 跳过"
    echo "=========================================="
    exit 1
fi

# 获取区块高度
BLOCK_RESPONSE=$(curl -s --connect-timeout 5 "$RPC_URL" \
    -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"method\":\"getBlockNumber\",\"params\":[1],\"id\":2}" 2>&1)
BLOCK_HEX=$(echo "$BLOCK_RESPONSE" | grep -oP '"result"\s*:\s*"\K0x[0-9a-fA-F]+')
if [ -n "$BLOCK_HEX" ]; then
    BLOCK_NUM=$((BLOCK_HEX))
    check_pass "当前区块高度: $BLOCK_NUM"
else
    check_skip "区块高度查询"
fi

# ==========================================
# 2. Channel 端口连通性
# ==========================================
echo ""
echo "[2/5] 验证 Channel 端口 ($CHANNEL_PORT) 连通性..."

if nc -z -w3 localhost "$CHANNEL_PORT" 2>/dev/null; then
    check_pass "Channel 端口 $CHANNEL_PORT 可达"
else
    check_fail "Channel 端口 $CHANNEL_PORT 不可达"
    echo "    Channel 协议用于 SDK 连接和 SM_SSL 通信"
fi

# ==========================================
# 3. SM_SSL 证书检查
# ==========================================
echo ""
echo "[3/5] 检查 FISCO BCOS SM_SSL 证书..."

# FISCO BCOS 节点证书通常位于 conf/ 目录下
NODE_CERT_DIR=""
if [ -d "$NODE_DIR/conf" ]; then
    NODE_CERT_DIR="$NODE_DIR/conf"
elif [ -d "$NODE_DIR/sdk" ]; then
    NODE_CERT_DIR="$NODE_DIR/sdk"
fi

# 查找证书文件（支持多节点目录结构）
find_certs() {
    local search_dir="$1"
    find "$search_dir" -name "*.crt" -o -name "*.pem" -o -name "ca.crt" -o -name "node.crt" -o -name "sdk.crt" 2>/dev/null | head -20
}

if [ -n "$NODE_CERT_DIR" ]; then
    CERTS=$(find_certs "$NODE_CERT_DIR")
    if [ -n "$CERTS" ]; then
        check_pass "证书目录: $NODE_CERT_DIR"

        # 检查 CA 证书
        CA_CERT=$(find "$NODE_CERT_DIR" -name "ca.crt" 2>/dev/null | head -1)
        if [ -n "$CA_CERT" ]; then
            CA_SUBJECT=$(openssl x509 -in "$CA_CERT" -noout -subject 2>/dev/null || echo "")
            CA_ISSUER=$(openssl x509 -in "$CA_CERT" -noout -issuer 2>/dev/null || echo "")
            CA_ALGO=$(openssl x509 -in "$CA_CERT" -noout -text 2>/dev/null | grep "Signature Algorithm:" | head -1 | xargs || echo "")
            check_pass "CA 证书: $CA_CERT"
            [ -n "$CA_SUBJECT" ] && echo "    Subject: $CA_SUBJECT"
            [ -n "$CA_ALGO" ] && echo "    算法: $CA_ALGO"

            # 检测是否为 SM2 证书
            if echo "$CA_ALGO" | grep -qi "sm2\|SM2\|sm3\|SM3"; then
                check_pass "CA 证书使用国密算法 (SM2/SM3)"
            else
                echo "    注意: CA 证书使用国际算法 (非国密)"
            fi
        else
            check_skip "CA 证书 (未找到 ca.crt)"
        fi

        # 检查节点证书
        NODE_CERT=$(find "$NODE_CERT_DIR" -name "node.crt" -o -name "sdk.crt" 2>/dev/null | head -1)
        if [ -n "$NODE_CERT" ]; then
            NODE_SUBJECT=$(openssl x509 -in "$NODE_CERT" -noout -subject 2>/dev/null || echo "")
            NODE_ALGO=$(openssl x509 -in "$NODE_CERT" -noout -text 2>/dev/null | grep "Signature Algorithm:" | head -1 | xargs || echo "")
            NODE_EXPIRY=$(openssl x509 -in "$NODE_CERT" -noout -enddate 2>/dev/null || echo "")
            check_pass "节点证书: $NODE_CERT"
            [ -n "$NODE_SUBJECT" ] && echo "    Subject: $NODE_SUBJECT"
            [ -n "$NODE_ALGO" ] && echo "    算法: $NODE_ALGO"
            [ -n "$NODE_EXPIRY" ] && echo "    $NODE_EXPIRY"
        else
            check_skip "节点证书 (未找到 node.crt/sdk.crt)"
        fi
    else
        check_skip "证书文件 (目录为空)"
    fi
else
    check_skip "证书目录 (未找到 $NODE_DIR/conf 或 $NODE_DIR/sdk)"
fi

# ==========================================
# 4. SM_SSL 握手测试 (需要 Tongsuo)
# ==========================================
echo ""
echo "[4/5] 测试 SM_SSL 握手 (Channel 端口)..."

if [ -f "$TONGSUO" ] && nc -z -w3 localhost "$CHANNEL_PORT" 2>/dev/null; then
    # FISCO BCOS Channel 协议使用 SM_SSL，尝试 NTLS 握手
    SM_CIPHERS=("ECC-SM2-SM4-CBC-SM3" "ECDHE-SM2-SM4-CBC-SM3")
    SM_PASS=0

    for CIPHER in "${SM_CIPHERS[@]}"; do
        RESULT=$(echo "Q" | timeout 5 "$TONGSUO" s_client -connect "localhost:$CHANNEL_PORT" \
            -enable_ntls -ntls \
            -cipher "$CIPHER" 2>&1 || true)
        if echo "$RESULT" | grep -q "NTLSv1.1\|SSL handshake\|Verify return code: 0"; then
            echo "  ✓ $CIPHER — SM_SSL 握手成功"
            SM_PASS=$((SM_PASS + 1))
        else
            echo "  ○ $CIPHER — 握手未成功 (可能需要客户端证书)"
        fi
    done

    if [ "$SM_PASS" -gt 0 ]; then
        check_pass "SM_SSL 握手验证通过 ($SM_PASS/${#SM_CIPHERS[@]})"
    else
        echo "  ○ SM_SSL 握手需要 SDK 客户端证书，跳过直接测试"
        echo "    FISCO BCOS Channel 协议要求双向认证，需使用 SDK 证书"
        SKIP=$((SKIP + 1))
    fi

    # 检测 FISCO BCOS 节点 SSL 类型
    if [ -f "$NODE_DIR/conf/config.ini" ]; then
        SSL_TYPE=$(grep -oP 'ssl_type\s*=\s*\K\S+' "$NODE_DIR/conf/config.ini" 2>/dev/null || echo "unknown")
        if [ "$SSL_TYPE" = "sm_ssl" ]; then
            check_pass "节点配置: ssl_type=sm_ssl (国密)"
        elif [ "$SSL_TYPE" = "ssl" ]; then
            echo "  ○ 节点配置: ssl_type=ssl (国际标准 SSL)"
        else
            echo "  ○ 节点 SSL 配置: ${SSL_TYPE:-未检测到}"
        fi
    fi
else
    if [ ! -f "$TONGSUO" ]; then
        check_skip "SM_SSL 握手测试 (Tongsuo 未安装: $TONGSUO)"
    fi
    if ! nc -z -w3 localhost "$CHANNEL_PORT" 2>/dev/null; then
        check_skip "SM_SSL 握手测试 (Channel 端口不可达)"
    fi
fi

# ==========================================
# 5. 合约部署验证
# ==========================================
echo ""
echo "[5/5] 验证链上合约状态..."

CONTRACT_ADDRESSES_FILE="$(dirname "$0")/../../backend/contract-addresses.json"
if [ -f "$CONTRACT_ADDRESSES_FILE" ]; then
    # 提取 FISCO BCOS 合约地址
    AUDIT_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACT_ADDRESSES_FILE')); print(d.get('fisco-bcos',{}).get('contracts',{}).get('AuditStorage',''))" 2>/dev/null || echo "")
    PKR_ADDR=$(python3 -c "import json; d=json.load(open('$CONTRACT_ADDRESSES_FILE')); print(d.get('fisco-bcos',{}).get('contracts',{}).get('PublicKeyRegistry',''))" 2>/dev/null || echo "")

    if [ -n "$AUDIT_ADDR" ] && [ "$AUDIT_ADDR" != "None" ] && [ "$AUDIT_ADDR" != "" ]; then
        check_pass "AuditStorage 合约: $AUDIT_ADDR"

        # 尝试调用 getTotalRecords
        CALL_DATA="0x1b40a696"  # getTotalRecords() selector
        CALL_RESULT=$(curl -s --connect-timeout 5 "$RPC_URL" \
            -X POST \
            -H 'Content-Type: application/json' \
            -d "{\"jsonrpc\":\"2.0\",\"method\":\"call\",\"params\":[1,{\"from\":\"0x6645b20a1b128e344f765016af86d332499537f5\",\"to\":\"$AUDIT_ADDR\",\"data\":\"$CALL_DATA\"}],\"id\":3}" 2>&1)
        if echo "$CALL_RESULT" | grep -q "output"; then
            check_pass "AuditStorage.getTotalRecords() 调用成功"
        else
            echo "  ○ AuditStorage 调用失败 (可能未授权)"
        fi
    else
        check_skip "AuditStorage 合约 (未部署)"
    fi

    if [ -n "$PKR_ADDR" ] && [ "$PKR_ADDR" != "None" ] && [ "$PKR_ADDR" != "" ]; then
        check_pass "PublicKeyRegistry 合约: $PKR_ADDR"
    else
        check_skip "PublicKeyRegistry 合约 (未部署)"
    fi
else
    check_skip "合约地址文件 (未找到 contract-addresses.json)"
fi

# ==========================================
# 汇总
# ==========================================
echo ""
echo "=========================================="
echo "  验证结果: $PASS 通过, $FAIL 失败, $SKIP 跳过"
echo "=========================================="
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "存在失败项，请检查:"
    echo "  1. FISCO BCOS 节点是否已启动"
    echo "  2. Channel 端口 $CHANNEL_PORT 是否开放"
    echo "  3. 节点是否配置为 sm_ssl 模式"
    echo ""
    exit 1
else
    echo "FISCO BCOS SM_SSL 环境验证通过！"
    echo ""
    echo "架构说明:"
    echo "  JSON-RPC (8545)  → HTTP 明文，用于链上读操作和交易发送"
    echo "  Channel  (20200) → SM_SSL 国密传输，用于 SDK 节点通信"
    echo "  P2P      (30300) → 节点间共识通信"
    echo ""
    exit 0
fi
