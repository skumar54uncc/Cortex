# Bundled embedding model (required for release)

Run **`npm run prepare-model`** once to download **Xenova/all-MiniLM-L6-v2** (`tokenizer.json`, config files, `onnx/model_quantized.onnx`) into `vendor/models/Xenova/all-MiniLM-L6-v2/`.

Webpack copies **`vendor/models/` → `dist/models/`**. Runtime sets **`env.allowRemoteModels = false`** — the extension does **not** list Hugging Face or jsDelivr in `manifest.json` host permissions.

Without running the script, embeddings fail until weights exist locally.
