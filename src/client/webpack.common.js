const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
    entry: './src/client/client.ts',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/,
            },
            {
                // GLSL sources: `#include "file.glsl"` resolved at build time,
                // exported as a string (see webpack/glslIncludeLoader.js).
                test: /\.glsl$/,
                use: path.resolve(__dirname, 'webpack/glslIncludeLoader.js'),
            },
        ],
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js'],
    },
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, '../../dist/client'),
        // Required for worker chunks to load correctly
        publicPath: '/',
    },
    plugins: [
        new HtmlWebpackPlugin({
            title: 'ThreeJs World',
        }),
    ],
};