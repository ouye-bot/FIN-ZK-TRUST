module.exports = {
  apps: [{
    name: 'fin-zk-trust-backend',
    script: 'app.js',
    exec_mode: 'cluster',
    instances: 8,
    autorestart: true,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'development',
      PORT: 3003
    }
  }]
};