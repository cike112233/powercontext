// 端侧推理资源准备：模型权重从 hf-mirror 下载，onnxruntime-web wasm 从本地 node_modules 复制。
// 大文件(模型 183MB + wasm 100MB)刻意不进 git，克隆后跑一次本脚本即可本地复现。
// 用法（在 stepfun/ 目录）： npm i --prefix app && node scripts/fetch-assets.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const HF = "https://hf-mirror.com";
const REPO = "Xenova/bge-small-zh-v1.5";
const MODEL_DIR = path.join(ROOT, "spike/public/models", REPO);
const WASM_DST = path.join(ROOT, "spike/public/ort-wasm");

const MODEL_FILES = [
  "config.json", "tokenizer_config.json", "tokenizer.json",
  "special_tokens_map.json", "vocab.txt", "quantize_config.json",
  "onnx/model.onnx", "onnx/model_fp16.onnx", "onnx/model_int8.onnx", "onnx/model_quantized.onnx",
];

// onnxruntime-web dist 里端侧需要的运行时文件
const WASM_FILES = [
  "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm",
  "ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm",
  "ort.all.min.mjs", "ort.webgpu.min.mjs", "ort.wasm.min.mjs",
];

async function download(url, dst) {
  if (fs.existsSync(dst) && fs.statSync(dst).size > 0) { console.log(`  跳过(已存在) ${path.basename(dst)}`); return; }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  process.stdout.write(`  下载 ${path.relative(MODEL_DIR, dst)} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dst, buf);
  console.log(` ✓ ${(buf.length / 1e6).toFixed(1)}MB`);
}

console.log("[1/2] 下载 embedding 模型 (bge-small-zh-v1.5) …");
for (const f of MODEL_FILES) await download(`${HF}/${REPO}/resolve/main/${f}`, path.join(MODEL_DIR, f));

console.log("[2/2] 复制 onnxruntime-web 运行时 (wasm) …");
fs.mkdirSync(WASM_DST, { recursive: true });
const dist = [
  path.join(ROOT, "app/node_modules/onnxruntime-web/dist"),
  path.join(ROOT, "spike/node_modules/onnxruntime-web/dist"),
].find((d) => fs.existsSync(d));
if (!dist) { console.warn("  ! 未找到 onnxruntime-web/dist，请先 `npm i --prefix app` 或 `npm i --prefix spike`。"); }
else {
  for (const f of WASM_FILES) {
    const src = path.join(dist, f);
    if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(WASM_DST, f)); console.log(`  复制 ${f}`); }
  }
}

console.log("\n完成。可运行： node server/index.mjs  （后端 :3011） 与  npm --prefix app run preview  （前端 :5210）");
