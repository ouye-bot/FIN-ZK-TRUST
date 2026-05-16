/**
 * 系统集成脚本
 * 提供自动化部署、环境配置和系统初始化功能
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('../utils/logger');

class IntegrationManager {
  constructor() {
    this.rootDir = path.join(__dirname, '..');
    this.config = {
      nodeVersion: '18.0.0',
      requiredPorts: [3003, 8545],
      directories: [
        'data',
        'logs',
        'uploads',
        'test_results'
      ]
    };
  }

  /**
   * 完整系统初始化
   */
  async fullSetup() {
    console.log('🚀 开始系统完整初始化...\n');
    
    try {
      // 1. 环境检查
      await this.checkEnvironment();
      
      // 2. 安装依赖
      await this.installDependencies();
      
      // 3. 创建必要目录
      await this.createDirectories();
      
      // 4. 初始化数据文件
      await this.initializeDataFiles();
      
      // 5. 配置环境变量
      await this.setupEnvironment();
      
      // 6. 检查区块链连接
      await this.checkBlockchainConnection();
      
      // 7. 运行系统测试
      await this.runSystemTests();
      
      console.log('\n✅ 系统初始化完成！');
      console.log('\n可用命令：');
      console.log('  npm run dev     - 启动开发服务器');
      console.log('  npm start       - 启动生产服务器');
      console.log('  npm test        - 运行测试');
      
      return { success: true };
    } catch (error) {
      console.error('\n❌ 系统初始化失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 环境检查
   */
  async checkEnvironment() {
    console.log('📋 检查环境...');
    
    const checks = [];
    
    // 检查Node.js版本
    try {
      const nodeVersion = process.version;
      const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
      if (majorVersion < 16) {
        throw new Error(`Node.js版本需要 >= 16.0.0，当前版本: ${nodeVersion}`);
      }
      checks.push(`✅ Node.js版本: ${nodeVersion}`);
    } catch (error) {
      throw new Error(`Node.js检查失败: ${error.message}`);
    }
    
    // 检查npm
    try {
      const npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
      checks.push(`✅ npm版本: ${npmVersion}`);
    } catch (error) {
      throw new Error('npm未安装或不可用');
    }
    
    // 检查Git
    try {
      const gitVersion = execSync('git --version', { encoding: 'utf8' }).trim();
      checks.push(`✅ ${gitVersion}`);
    } catch (error) {
      checks.push('⚠️  Git未安装（可选）');
    }
    
    // 检查端口占用
    for (const port of this.config.requiredPorts) {
      const isAvailable = await this.checkPortAvailability(port);
      if (isAvailable) {
        checks.push(`✅ 端口 ${port} 可用`);
      } else {
        checks.push(`⚠️  端口 ${port} 已被占用`);
      }
    }
    
    checks.forEach(check => console.log(`   ${check}`));
    console.log('');
  }

  /**
   * 安装依赖
   */
  async installDependencies() {
    console.log('📦 安装依赖...');
    
    try {
      // 检查node_modules是否存在
      const nodeModulesPath = path.join(this.rootDir, 'node_modules');
      if (fs.existsSync(nodeModulesPath)) {
        console.log('   ✅ 依赖已安装');
        return;
      }
      
      console.log('   正在安装依赖，这可能需要几分钟...');
      execSync('npm install', {
        cwd: this.rootDir,
        stdio: 'inherit'
      });
      console.log('   ✅ 依赖安装完成\n');
    } catch (error) {
      throw new Error(`依赖安装失败: ${error.message}`);
    }
  }

  /**
   * 创建必要目录
   */
  async createDirectories() {
    console.log('📁 创建必要目录...');
    
    for (const dir of this.config.directories) {
      const dirPath = path.join(this.rootDir, dir);
      try {
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
          console.log(`   ✅ 创建目录: ${dir}`);
        } else {
          console.log(`   ✅ 目录已存在: ${dir}`);
        }
      } catch (error) {
        throw new Error(`创建目录 ${dir} 失败: ${error.message}`);
      }
    }
    console.log('');
  }

  /**
   * 初始化数据文件
   */
  async initializeDataFiles() {
    console.log('🗄️  初始化数据文件...');
    
    const dataFiles = [
      { name: 'users.json', defaultData: [] },
      { name: 'transactions.json', defaultData: [] },
      { name: 'pool.json', defaultData: { totalAmount: 0, interestRate: 0.05 } },
      { name: 'credit_history.json', defaultData: [] },
      { name: 'credit_proofs.json', defaultData: [] },
      { name: 'investments.json', defaultData: [] }
    ];
    
    const dataDir = path.join(this.rootDir, 'data');
    
    for (const { name, defaultData } of dataFiles) {
      const filePath = path.join(dataDir, name);
      try {
        if (!fs.existsSync(filePath)) {
          fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
          console.log(`   ✅ 创建数据文件: ${name}`);
        } else {
          console.log(`   ✅ 数据文件已存在: ${name}`);
        }
      } catch (error) {
        throw new Error(`创建数据文件 ${name} 失败: ${error.message}`);
      }
    }
    console.log('');
  }

  /**
   * 配置环境变量
   */
  async setupEnvironment() {
    console.log('⚙️  配置环境变量...');
    
    const envPath = path.join(this.rootDir, '.env');
    const envExamplePath = path.join(this.rootDir, '.env.example');
    
    try {
      if (!fs.existsSync(envPath)) {
        let envContent = '';
        
        if (fs.existsSync(envExamplePath)) {
          // 复制示例文件
          envContent = fs.readFileSync(envExamplePath, 'utf8');
        } else {
          // 创建默认配置
          envContent = this.generateDefaultEnvConfig();
        }
        
        fs.writeFileSync(envPath, envContent);
        console.log('   ✅ 创建.env文件');
      } else {
        console.log('   ✅ .env文件已存在');
      }
    } catch (error) {
      throw new Error(`配置环境变量失败: ${error.message}`);
    }
    console.log('');
  }

  /**
   * 检查区块链连接
   */
  async checkBlockchainConnection() {
    console.log('⛓️  检查区块链连接...');
    
    try {
      const blockchainService = require('../services/blockchainService');
      const isConnected = await blockchainService.initialize();
      
      if (isConnected) {
        const status = blockchainService.getStatus();
        console.log(`   ✅ 区块链连接成功`);
        console.log(`      网络: ${status.network.name}`);
        console.log(`      链ID: ${status.network.chainId}`);
        console.log(`      合约: ${status.contractAddress}`);
      } else {
        console.log('   ⚠️  区块链连接失败，部分功能可能不可用');
      }
    } catch (error) {
      console.log(`   ⚠️  区块链检查失败: ${error.message}`);
    }
    console.log('');
  }

  /**
   * 运行系统测试
   */
  async runSystemTests() {
    console.log('🧪 运行系统测试...');
    
    try {
      // 运行密码技术测试
      const CryptoTest = require('../test/crypto-test');
      const cryptoTest = new CryptoTest();
      await cryptoTest.run();
      
      console.log('   ✅ 系统测试完成\n');
    } catch (error) {
      console.log(`   ⚠️  测试运行失败: ${error.message}\n`);
    }
  }

  /**
   * 快速启动（跳过依赖安装）
   */
  async quickStart() {
    console.log('⚡ 快速启动模式...\n');
    
    try {
      await this.createDirectories();
      await this.initializeDataFiles();
      await this.checkBlockchainConnection();
      
      console.log('\n✅ 快速启动完成！');
      console.log('运行 npm start 启动服务器');
      
      return { success: true };
    } catch (error) {
      console.error('\n❌ 快速启动失败:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 系统健康检查
   */
  async healthCheck() {
    console.log('🏥 系统健康检查...\n');
    
    const checks = {
      environment: false,
      dependencies: false,
      directories: false,
      dataFiles: false,
      blockchain: false
    };
    
    // 环境检查
    try {
      const nodeVersion = process.version;
      checks.environment = parseInt(nodeVersion.slice(1).split('.')[0]) >= 16;
      console.log(`${checks.environment ? '✅' : '❌'} 环境检查`);
    } catch (error) {
      console.log(`❌ 环境检查: ${error.message}`);
    }
    
    // 依赖检查
    try {
      checks.dependencies = fs.existsSync(path.join(this.rootDir, 'node_modules'));
      console.log(`${checks.dependencies ? '✅' : '❌'} 依赖检查`);
    } catch (error) {
      console.log(`❌ 依赖检查: ${error.message}`);
    }
    
    // 目录检查
    try {
      checks.directories = this.config.directories.every(dir => 
        fs.existsSync(path.join(this.rootDir, dir))
      );
      console.log(`${checks.directories ? '✅' : '❌'} 目录检查`);
    } catch (error) {
      console.log(`❌ 目录检查: ${error.message}`);
    }
    
    // 数据文件检查
    try {
      const dataDir = path.join(this.rootDir, 'data');
      checks.dataFiles = fs.existsSync(dataDir) && 
        fs.existsSync(path.join(dataDir, 'users.json'));
      console.log(`${checks.dataFiles ? '✅' : '❌'} 数据文件检查`);
    } catch (error) {
      console.log(`❌ 数据文件检查: ${error.message}`);
    }
    
    // 区块链检查
    try {
      const blockchainService = require('../services/blockchainService');
      checks.blockchain = blockchainService.isInitialized;
      console.log(`${checks.blockchain ? '✅' : '❌'} 区块链连接检查`);
    } catch (error) {
      console.log(`❌ 区块链检查: ${error.message}`);
    }
    
    const allHealthy = Object.values(checks).every(check => check);
    console.log(`\n${allHealthy ? '✅' : '⚠️'}  系统健康状态: ${allHealthy ? '良好' : '需要修复'}`);
    
    return { healthy: allHealthy, checks };
  }

  /**
   * 生成默认环境配置
   * @private
   */
  generateDefaultEnvConfig() {
    return `# Fin-ZK-Trust 环境配置
NODE_ENV=development
PORT=3003

# 数据库配置
DB_HOST=localhost
DB_PORT=3306
DB_NAME=fin_zk_trust
DB_USER=root
DB_PASSWORD=your_password

# JWT配置
JWT_SECRET=your_jwt_secret_key_here
JWT_EXPIRES_IN=24h

# 区块链配置
BLOCKCHAIN_PROVIDER_URL=http://127.0.0.1:8545
BLOCKCHAIN_CHAIN_ID=31337
HARDHAT_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

# CORS配置
CORS_ORIGIN=http://localhost:3000

# 日志配置
LOG_LEVEL=info

# 安全配置
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
`;
  }

  /**
   * 检查端口可用性
   * @private
   */
  async checkPortAvailability(port) {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      
      server.once('error', () => {
        resolve(false);
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port);
    });
  }
}

// 命令行接口
if (require.main === module) {
  const manager = new IntegrationManager();
  const command = process.argv[2];
  
  switch (command) {
    case 'setup':
    case 'full':
      manager.fullSetup();
      break;
    case 'quick':
    case 'start':
      manager.quickStart();
      break;
    case 'health':
    case 'check':
      manager.healthCheck();
      break;
    default:
      console.log('使用方法:');
      console.log('  node integration.js setup  - 完整系统初始化');
      console.log('  node integration.js quick  - 快速启动');
      console.log('  node integration.js health - 系统健康检查');
  }
}

module.exports = new IntegrationManager();
