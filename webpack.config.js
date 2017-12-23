const path = require("path");

module.exports = {
    entry: require.resolve("./script.js"),
    output: {
        path: path.resolve(__dirname, "dist"),
        filename: "bundle.js"
    },
    devtool: "source-map",
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