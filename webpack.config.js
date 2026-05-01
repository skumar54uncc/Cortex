const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
  const mode = argv.mode || "production";
  const cortexDebug =
    process.env.CORTEX_DEBUG === "0"
      ? false
      : process.env.CORTEX_DEBUG === "1" || mode === "development";

  return {
  entry: {
    "service-worker": "./src/background/service-worker.ts",
    content: "./src/content/main.ts",
    offscreen: "./src/offscreen/offscreen.ts",
    popup: "./src/popup/popup.ts",
    options: "./src/options/options.ts",
    onboarding: "./src/onboarding/onboarding.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "[name].js",
    clean: true,
  },
  module: {
    rules: [
      { test: /\.ts$/, use: "ts-loader", exclude: /node_modules/ },
      {
        test: /\.woff2$/i,
        type: "asset/resource",
        generator: { filename: "fonts/[name][contenthash][ext]" },
      },
      { test: /\.shadow\.css$/i, type: "asset/source" },
      {
        test: /\.css$/,
        exclude: /\.shadow\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
    fallback: {
      fs: false,
      path: false,
      crypto: false,
      stream: false,
    },
  },
  plugins: [
    new webpack.DefinePlugin({
      __CORTEX_DEBUG__: JSON.stringify(cortexDebug),
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "manifest.json", to: "." },
        { from: "src/offscreen/offscreen.html", to: "." },
        { from: "src/popup/popup.html", to: "." },
        { from: "src/popup/popup.css", to: "." },
        { from: "src/options/options.html", to: "." },
        { from: "src/options/options.css", to: "." },
        { from: "src/onboarding/onboarding.html", to: "." },
        { from: "icons", to: "icons", noErrorOnMissing: true },
        { from: "fonts", to: "fonts", noErrorOnMissing: true },
        { from: "vendor/models", to: "models", noErrorOnMissing: true },
      ],
    }),
  ],
  optimization: {
    minimize: true,
    runtimeChunk: false,
    splitChunks: false,
  },
};
};
