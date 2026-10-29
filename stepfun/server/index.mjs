// stepfun 后端 API 服务器：桥接前端与 seekdb
// 前端在浏览器端算好 512 维向量后 POST 过来，本服务只负责存储 + 混合检索。
import http from "node:http";
import { initSchema, upsertDoc, hybridSearch, count, explainHybrid, close, EMBED_DIM } from "./seekdb.mjs";

const PORT = process.env.PORT || 3011;
let ready = false;

async function ensureReady() {
  if (ready) return;
  await initSchema();
  ready = true;
  console.log(`[seekdb] schema 就绪，dim=${EMBED_DIM}`);
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  try {
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, backend: "seekdb", dim: EMBED_DIM });

    if (url.pathname === "/api/status") {
      await ensureReady();
      return json(res, 200, { connected: true, count: await count(), dim: EMBED_DIM });
    }

    if (url.pathname === "/api/add" && req.method === "POST") {
      await ensureReady();
      const { id, title, document, embedding, meta } = await readBody(req);
      if (!Array.isArray(embedding) || embedding.length !== EMBED_DIM)
        return json(res, 400, { error: `embedding 必须是 ${EMBED_DIM} 维数组` });
      const docId = id || String(Date.now());
      await upsertDoc({ id: docId, title, document, embedding, meta });
      return json(res, 200, { success: true, id: docId });
    }

    if (url.pathname === "/api/search" && req.method === "POST") {
      await ensureReady();
      const { queryText, queryVector, limit, mode } = await readBody(req);
      if (!queryText || !Array.isArray(queryVector))
        return json(res, 400, { error: "需要 queryText 与 queryVector" });
      const results = await hybridSearch({ queryText, queryVector, limit: limit || 5, mode: mode || "hybrid" });
      return json(res, 200, { results });
    }

    if (url.pathname === "/api/explain" && req.method === "POST") {
      await ensureReady();
      const { queryText, queryVector } = await readBody(req);
      const plan = await explainHybrid(queryText || "测试", queryVector || new Array(EMBED_DIM).fill(0.01));
      return json(res, 200, { plan });
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    console.error("[api] error:", err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`stepfun API on http://127.0.0.1:${PORT}`));
process.on("SIGINT", async () => { await close(); server.close(); process.exit(0); });
