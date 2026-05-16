const webpack = require('webpack');

module.exports = function override(config, env) {
  // 解决crypto等模块的polyfill问题
  config.resolve.fallback = {
    ...config.resolve.fallback,
    crypto: require.resolve('crypto-browserify'),
    stream: require.resolve('stream-browserify'),
    buffer: require.resolve('buffer'),
    assert: require.resolve('assert'),
    constants: require.resolve('constants-browserify'),
    os: false,
    readline: false,
    fs: false,
    path: false,
    net: false,
    tls: false
  };

  // 添加全局变量
  config.plugins = [
    ...config.plugins,
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer'],
      process: 'process'
    })
  ];

  return config;
};