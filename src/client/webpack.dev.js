const { merge } = require('webpack-merge')
const common = require('./webpack.common.js')
const path = require('path');

module.exports = merge(common, {
  mode: 'development',
  devtool: 'eval-source-map',
  devServer: {
    static: {
      directory: path.join(__dirname, '../../dist/client'),
    },
    hot: true,
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'core/'),
    },
  },
  output: {
    // Ensure worker chunks have unique names and load correctly
    chunkFilename: '[name].js',
  },
})
