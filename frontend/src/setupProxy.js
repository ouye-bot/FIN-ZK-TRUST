const { createProxyMiddleware } = require('http-proxy-middleware');

// 本地开发: 直接代理到后端 3003
// 国密 HTTPS: 设置 HTTPS_TARGET=https://localhost:443
const API_TARGET = process.env.HTTPS_TARGET || 'http://localhost:3003';

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: API_TARGET,
      changeOrigin: true,
      secure: false,
    })
  );
};
