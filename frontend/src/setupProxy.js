const { createProxyMiddleware } = require('http-proxy-middleware');

// 国密 HTTPS: Tengine 在 443 端口
// 本地开发: local-ssl-proxy 在 8443 端口
const HTTPS_TARGET = process.env.HTTPS_TARGET || 'https://localhost:443';

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: HTTPS_TARGET,
      changeOrigin: true,
      secure: false,  // 开发环境忽略证书验证
    })
  );
};
