const UglifyJsPlugin = require('uglifyjs-webpack-plugin');

module.exports = {
    entry: "./script.js",
    output: {
        path: __dirname,
        filename: "bundle.js"
    },
    module: {
        rules: [
            { test: /\.css$/, loader: "style-loader!css-loader" },
            {
                test: /\.js$/,
                exclude: /(node_modules|bower_components)/,
                loader: 'babel-loader',
                options: {
                    presets: [ 'env' ]
                }
            }
        ]
    },
    plugins: [ new UglifyJsPlugin() ]
};