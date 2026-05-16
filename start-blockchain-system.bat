@echo off
chcp 65001 >nul
echo ============================================
echo FinZkTrust 区块链系统启动脚本
echo 国密SM3+私链不可篡改+ZK零知识隐私核验三合一安全架构
echo ============================================
echo.

REM 检查是否以管理员身份运行
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo 警告：建议以管理员身份运行此脚本
    echo.
)

echo [1/4] 检查 Hardhat 本地节点...
curl -s http://127.0.0.1:8545 -X POST -H "Content-Type: application/json" -d "{\"jsonrpc\":\"2.0\",\"method\":\"eth_chainId\",\"params\":[],\"id\":1}" >nul 2>&1
if %errorLevel% neq 0 (
    echo.
    echo 错误：Hardhat 本地节点未启动！
    echo.
    echo 请先启动 Hardhat 节点：
    echo   cd contracts
echo   npx hardhat node
echo.
    echo 或者运行自动部署脚本：
echo   cd contracts
echo   npx hardhat run scripts/deploy.js --network localhost
echo.
    pause
    exit /b 1
)

echo [2/4] Hardhat 本地节点运行正常
echo.

echo [3/4] 检查智能合约是否已部署...
if not exist "contracts\contract-address-local.json" (
    echo.
    echo 警告：智能合约尚未部署！
    echo.
    echo 是否现在部署合约？(Y/N)
    set /p deploy_choice=
    if /i "%deploy_choice%"=="Y" (
        echo.
        echo 正在部署智能合约...
        cd contracts
        call npx hardhat run scripts/deploy.js --network localhost
        cd ..
        echo.
        echo 合约部署完成！
    ) else (
        echo.
        echo 跳过合约部署，系统将在无区块链存证模式下运行
    )
) else (
    echo [3/4] 智能合约已部署
echo.
)

echo [4/4] 启动后端服务...
echo.
cd backend
start "FinZkTrust Backend" cmd /k "npm run dev"
cd ..

echo.
echo ============================================
echo 系统启动完成！
echo ============================================
echo.
echo 服务地址：
echo   - 后端API: http://localhost:3003
echo   - Hardhat节点: http://127.0.0.1:8545
echo.
echo 区块链功能：
echo   - 链ID: 31337 (Hardhat本地私链)
echo   - 自动签名上链：已启用
echo   - SM3哈希存证：已启用
echo   - 交易验证接口：/api/v1/loan/verify-transaction
echo.
echo 使用说明：
echo   1. 每笔借款/还款/信用证明生成后会自动上链存证
echo   2. 可通过 /api/v1/loan/blockchain-status 查看区块链状态
echo   3. 可通过 POST /api/v1/loan/verify-transaction 验证交易
echo.
echo ============================================
echo.

pause
