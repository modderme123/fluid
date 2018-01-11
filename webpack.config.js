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
                exclude: /node_modules(?!\/webpack-dev-server)/,
                use: {
                    loader: 'babel-loader',
                    options: { 
                        presets: [ '@babel/preset-env' ] 
                    } 
                }
            }
        ]
    }
};