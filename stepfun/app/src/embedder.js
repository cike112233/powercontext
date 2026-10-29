// 端侧 embedding 封装：优先 WebGPU，自动降级 WASM；支持量化 dtype 切换。
import { pipeline, env } from "@huggingface/transformers";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.backends.onnx.wasm.wasmPaths = "/ort-wasm/";

const MODEL = "Xenova/bge-small-zh-v1.5";

export const DIM = 512;

let extractor = null;
let activeBackend = null;
let activeDtype = null;

export async function detectGPU() {
  if (!navigator.gpu) return { ok: false, reason: "navigator.gpu 不存在" };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { ok: false, reason: "requestAdapter 返回 null" };
  const info = adapter.info || {};
  return { ok: true, vendor: info.vendor, architecture: info.architecture };
}

// 加载模型；返回 { backend, dtype, loadMs }
export async function load({ preferGPU = true, dtype = "q8" } = {}) {
  const gpu = await detectGPU();
  const backend = preferGPU && gpu.ok ? "webgpu" : "wasm";
  const t0 = performance.now();
  extractor = await pipeline("feature-extraction", MODEL, { device: backend, dtype });
  activeBackend = backend;
  activeDtype = dtype;
  return { backend, dtype, loadMs: performance.now() - t0, gpu };
}

export function backend() {
  return { backend: activeBackend, dtype: activeDtype };
}

// 单条文本 → 归一化 512 维向量
export async function embed(text) {
  if (!extractor) throw new Error("模型未加载");
  const t0 = performance.now();
  const out = await extractor(text, { pooling: "mean", normalize: true });
  return { vector: Array.from(out.data), ms: performance.now() - t0 };
}

// 批量向量化（导入文档时用）
export async function embedBatch(texts, onProgress) {
  const res = [];
  for (let i = 0; i < texts.length; i++) {
    const { vector, ms } = await embed(texts[i]);
    res.push({ vector, ms });
    if (onProgress) onProgress(i + 1, texts.length);
  }
  return res;
}
