#!/bin/bash
# FinZkTrust 一键启动脚本 (WSL)
# 启动: FISCO BCOS + 后端 + 前端 + Tengine(HTTPS/NTLS)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  FinZkTrust 系统启动${NC}"
echo -e "${GREEN}========================================${NC}"

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. 检查 FISCO BCOS
echo -e "\n${YELLOW}=== 1. 检查 FISCO BCOS ===${NC}"
FISCO_DIR="$HOME/fisco-bcos-node"
if [ -d "$FISCO_DIR" ]; then
  NODE_COUNT=$(bash "$FISCO_DIR/start_all.sh" 2>/dev/null | grep -c "success" || echo "0")
  echo -e "  FISCO BCOS 节点: ${GREEN}已启动${NC}"
else
  echo -e "  ${RED}FISCO BCOS 目录不存在: $FISCO_DIR${NC}"
  echo -e "  ${YELLOW}跳过区块链启动，系统将使用 Hardhat 模式${NC}"
fi

# 2. 启动后端
echo -e "\n${YELLOW}=== 2. 启动后端 ===${NC}"
cd "$PROJECT_ROOT/backend"
if [ ! -f ".env" ]; then
  echo -e "  ${YELLOW}警告: .env 文件不存在，使用默认配置${NC}"
fi
BLOCKCHAIN_NETWORK=${BLOCKCHAIN_NETWORK:-fisco-bcos} node app.js &
BACKEND_PID=$!
echo -e "  后端 PID: ${GREEN}$BACKEND_PID${NC}"
echo "  等待后端启动..."
sleep 3

# 检查后端是否存活
if kill -0 $BACKEND_PID 2>/dev/null; then
  echo -e "  后端: ${GREEN}运行中${NC} (http://localhost:3003)"
else
  echo -e "  ${RED}后端启动失败${NC}"
  exit 1
fi

# 3. 启动前端
echo -e "\n${YELLOW}=== 3. 启动前端 ===${NC}"
cd "$PROJECT_ROOT/frontend"
npm start &
FRONTEND_PID=$!
echo -e "  前端 PID: ${GREEN}$FRONTEND_PID${NC}"

# 4. 启动 Tengine (HTTPS)
echo -e "\n${YELLOW}=== 4. 启动 Tengine (HTTPS) ===${NC}"
if [ -f "/usr/local/tengine-static/sbin/nginx" ]; then
  sudo /usr/local/tengine-static/sbin/nginx -t 2>/dev/null && {
    sudo /usr/local/tengine-static/sbin/nginx
    echo -e "  Tengine (HTTPS): ${GREEN}运行中${NC} (https://localhost:443)"
  } || echo -e "  ${YELLOW}Tengine 配置检查失败，跳过${NC}"
else
  echo -e "  ${YELLOW}Tengine 未安装，跳过 HTTPS${NC}"
fi

# 5. 启动 Tengine NTLS (可选)
echo -e "\n${YELLOW}=== 5. 启动 Tengine NTLS ===${NC}"
NTLS_CONF="/usr/local/tengine-ntls/conf/nginx-ntls.conf"
if [ -f "/usr/local/tengine-ntls/sbin/nginx" ] && [ -f "$NTLS_CONF" ]; then
  sudo /usr/local/tengine-ntls/sbin/nginx -c "$NTLS_CONF" -t 2>/dev/null && {
    sudo /usr/local/tengine-ntls/sbin/nginx -c "$NTLS_CONF"
    echo -e "  Tengine (NTLS): ${GREEN}运行中${NC} (ntls://localhost:8443)"
  } || echo -e "  ${YELLOW}NTLS 配置检查失败，跳过${NC}"
else
  echo -e "  ${YELLOW}Tengine NTLS 未安装或配置不存在，跳过${NC}"
fi

# 输出
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}  系统就绪${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "  后端:      http://localhost:3003"
echo -e "  前端:      http://localhost:3000"
echo -e "  HTTPS:     https://localhost:443 (RSA)"
echo -e "  NTLS:      ntls://localhost:8443 (SM2 双证书)"
echo -e "  区块链:    http://localhost:3000/blockchain"
echo ""
echo -e "  ${YELLOW}Ctrl+C 停止所有服务${NC}"

# 等待子进程
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; sudo /usr/local/tengine-static/sbin/nginx -s stop 2>/dev/null; sudo /usr/local/tengine-ntls/sbin/nginx -s stop 2>/dev/null; echo -e '\n${RED}系统已停止${NC}'" SIGINT SIGTERM

wait
