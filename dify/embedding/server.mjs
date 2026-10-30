// 本地 OpenAI 兼容 Embedding 服务
// 作用：给 Dify 提供 embedding 模型（Dify 知识库切片后调用它拿向量，向量再写进真实 seekdb），
//       同时给 dify/retrieval 的混合检索工具复用同一个模型，保证"写入向量"和"查询向量"完全同源。
// 模型：BAAI/bge-small-zh-v1.5 的 Xenova/ONNX 端口，512 维，q8 量化，与 Task3 端侧推理用的是同一个模型。
// 全部本地加载（allowRemoteModels=false），运行期零外网依赖。
//
// 启动：EMBEDDING_PORT=8100 node server.mjs
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { pipeline, env } from "@huggingface/transformers";

const PORT = Number(process.env.EMBEDDING_PORT || 8100);
const MODEL_ID = process.env.EMBEDDING_MODEL || "Xenova/bge-small-zh-v1.5";
const DTYPE = process.env.EMBEDDING_DTYPE || "q8";
const API_KEY = process.env.EMBEDDING_API_KEY || ""; // 留空=不校验（本机自部署演示用）
const modelRoot = decodeURIComponent(new URL("./models/", import.meta.url).pathname.replace(/^\/([a-zA-Z]:)/, "$1"));

env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = modelRoot;
env.useBrowserCache = false;

if (!existsSync(`${modelRoot}${MODEL_ID}/config.json`)) {
  console.error(`[embedding] 本地模型不存在：${modelRoot}${MODEL_ID}，请先执行 npm run fetch:model`);
  process.exit(1);
}

const t0 = Date.now();
const extractor = await pipeline("feature-extraction", MODEL_ID, { dtype: DTYPE });
console.log(`[embedding] 模型就绪 ${MODEL_ID} (${DTYPE})，加载 ${Date.now() - t0}ms，维度 ${extractor.model?.session?.outputNames?.join(",") || "512"}`);

const DIM = 512;

function json(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

function authorized(req) {
  if (!API_KEY) return true;
  const h = req.headers.authorization || "";
  return h.replace(/^Bearer\s+/i, "") === API_KEY;
}

/** 批量向量化：input 允许 string 或 string[]，返回 number[][] */
async function embedMany(texts) {
  const out = [];
  for (const text of texts) {
    const vec = await extractor(String(text ?? ""), { pooling: "cls", normalize: true });
    out.push(Array.from(vec.data, (x) => Number(x)));
  }
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return json(res, 200, { status: "ok", model: MODEL_ID, dtype: DTYPE, dim: DIM });
    }
    if (req.method === "GET" && url.pathname === "/v1/models") {
      if (!authorized(req)) return json(res, 401, { error: { message: "invalid api key" } });
      return json(res, 200, {
        object: "list",
        data: [{ id: MODEL_ID, object: "model", created: Math.floor(Date.now() / 1000), owned_by: "local-bge" }],
      });
    }
    if (req.method === "POST" && url.pathname === "/v1/embeddings") {
      if (!authorized(req)) return json(res, 401, { error: { message: "invalid api key", type: "authentication_error" } });
      const body = await readBody(req);
      const input = Array.isArray(body.input) ? body.input : [body.input];
      if (!input.length || input.every((x) => !String(x ?? "").trim())) {
        return json(res, 400, { error: { message: "input is empty", type: "invalid_request_error" } });
      }
      const ts = Date.now();
      const vectors = await embedMany(input);
      return json(res, 200, {
        object: "list",
        model: body.model || MODEL_ID,
        data: vectors.map((embedding, index) => ({ object: "embedding", index, embedding })),
        usage: { prompt_tokens: 0, total_tokens: 0 },
        _timing_ms: Date.now() - ts,
      });
    }
    return json(res, 404, { error: { message: `no route ${req.method} ${url.pathname}` } });
  } catch (err) {
    console.error("[embedding] error:", err);
    return json(res, 500, { error: { message: String(err?.message || err), type: "server_error" } });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[embedding] OpenAI 兼容服务已监听 http://0.0.0.0:${PORT}/v1 （模型 ${MODEL_ID} / ${DTYPE} / ${DIM} 维）`);
});
