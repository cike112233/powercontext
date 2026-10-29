import { defineConfig } from "vite";

export default defineConfig({
  // 模型 + onnxruntime wasm + 评测数据都在 spike/public 里，直接复用，避免 282MB 重复拷贝
  publicDir: "../spike/public",
  server: {
    port: 5210,
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:3011", changeOrigin: true } },
  },
  preview: {
    port: 5210,
    host: "127.0.0.1",
    proxy: { "/api": { target: "http://127.0.0.1:3011", changeOrigin: true } },
  },
});
