const UglifyJsPlugin = require('uglifyjs-webpack-plugin')

module.exports = {
    entry: require.resolve("./script.js"),
    output: {
        path: __dirname,
        filename: "bundle.js"
    },
    plugins: [
        new UglifyJsPlugin()
    ],
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /(node_modules|bower_components)/,

                use: {
                    loader: 'babel-loader',
                    options: {
                      presets: ['@babel/preset-env']
                    }
                  }
            
            },
            { test: /\.css$/, loader: "style-loader!css-loader" }
        ]
    }
};