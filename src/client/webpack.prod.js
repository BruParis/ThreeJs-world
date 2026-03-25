const { merge } = require('webpack-merge');
const common = require('./webpack.common.js');
const path = require('path');

module.exports = merge(common, {
    mode: 'production',
    performance: {
        hints: false
    },
    resolve: {
        alias: {
            '@core': path.resolve(__dirname, 'core/'),
        },
    }
});