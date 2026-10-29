import { pipeline, env } from "@huggingface/transformers";

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = "/models/";
env.backends.onnx.wasm.wasmPaths = "/ort-wasm/";

const out = document.getElementById("out");
const log = (msg, cls = "") => {
  const d = document.createElement("div");
  d.className = "row " + cls;
  d.textContent = msg;
  out.appendChild(d);
};

const MODEL = "Xenova/bge-small-zh-v1.5";
const TEXT = "OceanBase 分布式数据库支持向量检索与全文检索混合查询。";

async function detectGPU() {
  if (!navigator.gpu) { log("navigator.gpu 不存在 → 仅 WASM", "fail"); return null; }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) { log("requestAdapter() 返回 null → 无可用 GPU", "fail"); return null; }
  const info = adapter.info || {};
  log(`WebGPU 可用 | vendor=${info.vendor||"?"} architecture=${info.architecture||"?"}`, "ok");
  const maxMem = adapter.limits?.maxStorageBufferBindingSize;
  log(`maxStorageBufferBindingSize=${maxMem}`, "");
  return adapter;
}

async function runOnce(device, dtype) {
  const label = `${device}/${dtype}`;
  try {
    const t0 = performance.now();
    const extractor = await pipeline("feature-extraction", MODEL, { device, dtype });
    const tLoad = performance.now() - t0;
    const t1 = performance.now();
    const vec = await extractor(TEXT, { pooling: "mean", normalize: true });
    const tInf = performance.now() - t1;
    const arr = Array.from(vec.data).slice(0, 5).map((x) => x.toFixed(4));
    let norm = 0; for (const v of vec.data) norm += v * v; norm = Math.sqrt(norm);
    log(`[${label}] 加载 ${tLoad.toFixed(0)}ms | 推理 ${tInf.toFixed(0)}ms | dim=${vec.data.length} | ‖v‖=${norm.toFixed(3)} | [${arr.join(",")}]`, "ok");
    return { label, ok: true, load: tLoad, inf: tInf };
  } catch (e) {
    log(`[${label}] 失败: ${e.message}`, "fail");
    return { label, ok: false, err: String(e.message) };
  }
}

(async () => {
  log("=== 环境检测 ===", "warn");
  await detectGPU();
  log("=== 推理测试 ===", "warn");
  const results = [];
  results.push(await runOnce("webgpu", "q8"));
  results.push(await runOnce("webgpu", "fp32"));
  results.push(await runOnce("wasm", "q8"));
  log("=== 结果 JSON ===", "warn");
  const pre = document.createElement("pre");
  pre.id = "result-json";
  pre.textContent = JSON.stringify(results, null, 2);
  out.appendChild(pre);
  const done = document.createElement("div");
  done.className = "row ok";
  done.id = "spike-done";
  done.textContent = "DONE";
  out.appendChild(done);
})();
