#!/bin/bash
# FinZkTrust 演示流程脚本
# 自动演示: 注册→登录→ZKP→借款→验证→区块链查询

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

API="http://localhost:3003"
DEMO_USER="demo_$(date +%s)"
DEMO_PASS="Demo@12345678"
SM2_PUB="04c41687818b21b8a57cf9ae71c976c8b3c2c1a54d877d2ae4eafc440b13f39bc2d3d630182ce6a5326ea6185793a852d0bc2fe7056effbea67eebe877c6af04d0"

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  FinZkTrust 演示流程${NC}"
echo -e "${CYAN}========================================${NC}"

# 初始链上状态
echo -e "\n${YELLOW}--- 0. 初始链上状态 ---${NC}"
INIT=$(curl -s "$API/api/v1/blockchain/explorer" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('totalRecords',0))" 2>/dev/null || echo "0")
echo -e "  链上记录数: ${GREEN}$INIT${NC}"

# 1. 注册
echo -e "\n${YELLOW}--- 1. 注册用户 ---${NC}"
REG=$(curl -s -X POST "$API/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$DEMO_USER\",\"password\":\"$DEMO_PASS\",\"sm2PublicKey\":\"$SM2_PUB\"}")
echo "  $REG" | python3 -c "import sys,json; d=json.load(sys.stdin); print('  结果:', '✅ 成功' if d.get('success') else '❌ '+d.get('message',''))" 2>/dev/null
USER_ID=$(echo "$REG" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user',{}).get('id',''))" 2>/dev/null)
echo -e "  用户ID: ${GREEN}$USER_ID${NC}"

# 2. 登录
echo -e "\n${YELLOW}--- 2. 登录 ---${NC}"
LOGIN=$(curl -s -X POST "$API/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$DEMO_USER\",\"password\":\"$DEMO_PASS\"}")
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)
echo -e "  Token: ${GREEN}${TOKEN:0:20}...${NC}"

# 3. 等待链上注册
echo -e "\n${YELLOW}--- 3. 等待链上注册 (8s) ---${NC}"
sleep 8
AFTER_REG=$(curl -s "$API/api/v1/blockchain/explorer" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('data',{}).get('totalRecords',0))" 2>/dev/null || echo "0")
echo -e "  链上记录数: ${GREEN}$AFTER_REG${NC} (+$((AFTER_REG - INIT)))"

# 4. 查看区块链浏览器
echo -e "\n${YELLOW}--- 4. 区块链浏览器 ---${NC}"
EXPLORER=$(curl -s "$API/api/v1/blockchain/explorer")
echo "$EXPLORER" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(f'  总记录: {d.get(\"totalRecords\",0)}')
print(f'  类型分布: {d.get(\"typeStats\",{})}')
print(f'  最近记录: {len(d.get(\"recentRecords\",[]))} 条')
" 2>/dev/null

# 5. 区块链状态
echo -e "\n${YELLOW}--- 5. 区块链服务状态 ---${NC}"
curl -s "$API/api/v1/blockchain/status" | python3 -c "
import sys,json
d=json.load(sys.stdin).get('data',{})
print(f'  已初始化: {d.get(\"isInitialized\",False)}')
print(f'  网络: {d.get(\"networkName\",\"unknown\")}')
print(f'  总记录: {d.get(\"totalRecords\",0)}')
" 2>/dev/null

echo -e "\n${CYAN}========================================${NC}"
echo -e "${CYAN}  演示完成${NC}"
echo -e "${CYAN}  区块链浏览器: http://localhost:3000/blockchain${NC}"
echo -e "${CYAN}========================================${NC}"
