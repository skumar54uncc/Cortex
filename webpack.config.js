const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");

module.exports = (env, argv) => {
  const mode = argv.mode || "production";
  const cortexDebug =
    process.env.CORTEX_DEBUG === "0"
      ? false
      : process.env.CORTEX_DEBUG === "1" || mode === "development";
  /**
   * `--env e2e` builds dist-e2e/ with an open overlay shadow root so axe-core
   * can audit the overlay. Everything else is identical to production.
   * The shipped build (dist/) always uses a closed shadow root.
   */
  const e2eAudit = Boolean(env && env.e2e);

  return {
  entry: {
    "service-worker": "./src/background/service-worker.ts",
    content: "./src/content/main.ts",
    overlay: "./src/content/overlay-entry.ts",
    extract: "./src/content/extract-entry.ts",
    "resurface-chip": "./src/content/resurface-chip.ts",
    "youtube-bridge": "./src/content/youtube-bridge.ts",
    offscreen: "./src/offscreen/offscreen.ts",
    popup: "./src/popup/popup.ts",
    options: "./src/options/options.ts",
    onboarding: "./src/onboarding/onboarding.ts",
    "search-shell": "./src/search/search-shell.ts",
  },
  output: {
    path: path.resolve(__dirname, e2eAudit ? "dist-e2e" : "dist"),
    filename: "[name].js",
    /** Lazy chunks (pdf.js for Phase 5.9) sit next to the entry bundles. */
    chunkFilename: "[name].js",
    /** style-loader breaks in MV3 pages when left as `auto` */
    publicPath: "",
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
      /**
       * onnxruntime-web references its .wasm through new URL(..., import.meta.url).
       * The binary already ships once as wasm/ort-wasm-simd-threaded.wasm
       * (CopyWebpackPlugin below), so point the reference there and do not emit
       * a second, hashed 14 MB copy.
       */
      { test: /\.wasm$/, type: "asset/resource", generator: { emit: false, filename: "wasm/[name][ext]" } },
      {
        test: /\.css$/,
        exclude: /\.shadow\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  resolve: {
    extensions: [".ts", ".js"],
    alias: {
      /**
       * Transformers.js imports the WebGPU+WASM ORT bundle (28 MB binary).
       * Cortex ships int8 weights that only run on the WASM execution
       * provider, so use the CPU-only bundle (14 MB binary, no WebGPU code).
       */
      "onnxruntime-web/webgpu": "onnxruntime-web/wasm",
    },
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
      __CORTEX_E2E_OPEN_SHADOW__: JSON.stringify(e2eAudit),
    }),
    new CopyWebpackPlugin({
      patterns: [
        { from: "manifest.json", to: "." },
        { from: "managed_schema.json", to: "." },
        { from: "src/offscreen/offscreen.html", to: "." },
        { from: "src/popup/popup.html", to: "." },
        { from: "src/popup/popup.css", to: "." },
        { from: "src/styles/cortex-theme.css", to: "." },
        { from: "src/options/options.html", to: "." },
        { from: "src/options/options.css", to: "." },
        { from: "src/onboarding/onboarding.html", to: "." },
        { from: "src/onboarding/onboarding.css", to: "." },
        { from: "src/search/search-shell.html", to: "." },
        { from: "src/search/search-shell.css", to: "." },
        { from: "icons", to: "icons", noErrorOnMissing: true },
        { from: "fonts", to: "fonts", noErrorOnMissing: true },
        { from: "vendor/models", to: "models", noErrorOnMissing: true },
        /** pdfjs-dist worker, loaded by the offscreen document only when a PDF is read. */
        { from: "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs", to: "pdf.worker.min.mjs" },
        {
          from: "node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm",
          to: "wasm/ort-wasm-simd-threaded.wasm",
        },
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
