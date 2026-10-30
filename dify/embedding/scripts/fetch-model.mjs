// 准备本地 embedding 模型：从 hf-mirror 下载 bge-small-zh-v1.5 的 ONNX 权重到 ./models/。
// 模型约 100MB（q8）刻意不进 git，克隆后跑一次本脚本即可本地复现；国内直连 hf-mirror 实测 ~11MB/s。
// 用法：cd dify/embedding && npm i && npm run fetch:model
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = path.resolve(__dirname, "../models/Xenova/bge-small-zh-v1.5");
const HF = process.env.HF_ENDPOINT || "https://hf-mirror.com";
const REPO = "Xenova/bge-small-zh-v1.5";

// q8 = model_quantized.onnx（默认用的就是这个）；另两个可选，方便对比 FP32/FP16
const FILES = [
  "config.json",
  "tokenizer_config.json",
  "tokenizer.json",
  "special_tokens_map.json",
  "vocab.txt",
  "quantize_config.json",
  "onnx/model_quantized.onnx",
  ...(process.env.FETCH_ALL_DTYPES ? ["onnx/model.onnx", "onnx/model_fp16.onnx"] : []),
];

async function download(url, dst) {
  if (fs.existsSync(dst) && fs.statSync(dst).size > 0) {
    console.log(`  跳过(已存在) ${path.relative(MODEL_DIR, dst)}`);
    return;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  process.stdout.write(`  下载 ${path.relative(MODEL_DIR, dst)} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dst, buf);
  console.log(` ✓ ${(buf.length / 1e6).toFixed(1)}MB`);
}

console.log(`[embedding] 目标目录 ${MODEL_DIR}`);
for (const f of FILES) await download(`${HF}/${REPO}/resolve/main/${f}`, path.join(MODEL_DIR, f));
console.log("[embedding] 完成，可以 npm start");
