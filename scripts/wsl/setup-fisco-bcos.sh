#!/bin/bash
# FISCO BCOS 单节点部署脚本
# 用于开发测试环境

set -e

NODE_DIR="$HOME/fisco-bcos-node"
DOCKER_IMAGE="fiscoorg/fiscobcos:latest"

echo "=========================================="
echo "  FISCO BCOS 单节点部署"
echo "=========================================="
echo ""

# 1. 创建节点目录
echo "[1/4] 创建节点目录..."
mkdir -p "$NODE_DIR/data"
mkdir -p "$NODE_DIR/conf"
mkdir -p "$NODE_DIR/log"

# 2. 生成节点证书
echo "[2/4] 生成节点证书..."
docker run --rm -v "$NODE_DIR:/data" "$DOCKER_IMAGE" \
    bash -c "cd /data && openssl genrsa -out conf/node.key 2048 2>/dev/null && openssl req -new -key conf/node.key -out conf/node.csr -subj '/CN=localhost/O=fisco-bcos/C=CN' 2>/dev/null && openssl x509 -req -in conf/node.csr -signkey conf/node.key -out conf/node.crt -days 3650 2>/dev/null && echo 'Certificates generated'"

# 3. 创建配置文件
echo "[3/4] 创建配置文件..."
cat > "$NODE_DIR/conf/config.ini" << 'CONFIG_EOF'
[network]
listen_ip=0.0.0.0
listen_port=30300
; ssl or sm_ssl
ssl_type=ssl
; ssl_type=sm_ssl

[channel]
listen_port=20200

[service]
jsonrpc_listen_port=8545

[storage]
type=leveldb
path=data

[tx_pool]
limit=150000

[chain]
id=1
CONFIG_EOF

# 4. 创建创世块配置
cat > "$NODE_DIR/conf/genesis.json" << 'GENESIS_EOF'
{
    "sealer": [],
    "observer": [],
    "consensus_type": "raft",
    "max_trans_num": 1000,
    "tx_pool_limit": 150000
}
GENESIS_EOF

# 5. 启动节点
echo "[4/4] 启动 FISCO BCOS 节点..."
docker run -d \
    --name fisco-bcos-node \
    -p 30300:30300 \
    -p 8545:8545 \
    -p 20200:20200 \
    -v "$NODE_DIR:/data" \
    "$DOCKER_IMAGE" \
    -c /data/conf/config.ini

echo ""
echo "=========================================="
echo "  FISCO BCOS 节点启动完成"
echo "=========================================="
echo ""
echo "JSON-RPC 端口: 8545"
echo "P2P 端口: 30300"
echo "Channel 端口: 20200"
echo ""
echo "测试连接:"
echo "  curl -s http://localhost:8545 -X POST -H 'Content-Type: application/json' -d '{\"jsonrpc\":\"2.0\",\"method\":\"getClientVersion\",\"params\":[],\"id\":1}'"
echo ""
