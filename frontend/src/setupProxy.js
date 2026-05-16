const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function(app) {
  app.use(
    '/api',
    createProxyMiddleware({
      target: 'https://localhost:8443',  // 指向本地 HTTPS 代理
      changeOrigin: true,
      secure: false,                     // 开发环境忽略证书验证
    })
  );
};
