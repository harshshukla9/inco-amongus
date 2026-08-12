const webpack = require("webpack");
const path = require("path");
const fs = require("fs");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");

// Optional file written by `cd inco && npm run deploy:*`
let incoDeploy = {};
try {
  const deployPath = path.resolve(__dirname, "../.inco-deploy.json");
  if (fs.existsSync(deployPath)) {
    incoDeploy = JSON.parse(fs.readFileSync(deployPath, "utf8"));
  }
} catch (e) {
  incoDeploy = {};
}

module.exports = {
  mode: "development",
  devtool: "eval-source-map",
  resolve: {
    extensions: [".js", ".mjs", ".json"],
    mainFields: ["browser", "module", "main"],
  },
  // Project root is contentBase (WDS3 default) so /static/inco.bundle.js is served.
  devServer: {
    contentBase: path.resolve(__dirname, ".."),
    watchContentBase: true,
  },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        include: /node_modules\/(viem|abitype|ox|@inco|isows|ws)/,
        use: {
          loader: "babel-loader",
          options: {
            presets: [
              [
                "@babel/preset-env",
                { targets: { browsers: [">1%", "last 2 versions"] } },
              ],
            ],
          },
        },
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader"
        }
      },
      {
        test: [/\.vert$/, /\.frag$/],
        use: "raw-loader"
      },
      {
        test: /\.(gif|png|jpe?g|svg|xml|mp3|wav|ogg|m4a)$/i,
        use: "file-loader"
      }
    ]
  },
  plugins: [
    new CleanWebpackPlugin({
      root: path.resolve(__dirname, "../")
    }),
    new webpack.DefinePlugin({
      CANVAS_RENDERER: JSON.stringify(true),
      WEBGL_RENDERER: JSON.stringify(true),
      "process.env.INCO_ROLES_ADDRESS": JSON.stringify(
        process.env.INCO_ROLES_ADDRESS || incoDeploy.contractAddress || ""
      ),
      "process.env.INCO_MARKET_FACTORY": JSON.stringify(
        process.env.INCO_MARKET_FACTORY || incoDeploy.marketFactoryAddress || ""
      ),
      "process.env.INCO_NETWORK": JSON.stringify(
        process.env.INCO_NETWORK || incoDeploy.network || "baseSepolia"
      ),
      "process.env.INCO_ENABLED": JSON.stringify(
        process.env.INCO_ENABLED ||
          (incoDeploy.enabled ? "true" : "") ||
          ""
      ),
      "process.env.INCO_IMPOSTOR_COUNT": JSON.stringify(
        process.env.INCO_IMPOSTOR_COUNT ||
          String(incoDeploy.impostorCount || 1)
      ),
    }),
    new HtmlWebpackPlugin({
      template: "./index.html"
    })
  ]
};
