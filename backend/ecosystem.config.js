module.exports = {
  apps: [{
    name: 'finzktrust-backend',
    script: 'app.js',
    exec_mode: 'cluster',
    instances: 8,          // ← 从 'max' 改为 8，确保总连接数可控
    autorestart: true,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 3003
    }
  }]
};