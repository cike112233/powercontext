// seekdb 混合检索工具服务（给 Dify 当"自定义工具"用）
//
// 它查的就是 Dify 自己在 seekdb 里建的那张知识库向量表
// （test.vector_index_<dataset_id>_node：VECTOR(512) + HNSW 向量索引 + ik 全文索引），
// 用我们手写的"全文通道 + 向量通道 + RRF 融合"SQL，而不是 Dify 内置的检索调用。
//
// 为什么要它：
// 1) 让评委能在应用里一键切换 hybrid / vector / fts 三种检索模式，直观看到 seekdb
//    混合检索相对纯向量的增益（Task3 的消融结论：纯向量会漏掉术语型问法）。
// 2) 返回 EXPLAIN 计划，作为"确实走了两个索引"的硬证据。
//
// 启动：node server.mjs   （端口与连接参数见下方 env 默认值，全部是本机占位值）
import { createServer } from "node:http";
import mysql from "mysql2/promise";

const PORT = Number(process.env.PORT || 3012);
const CFG = {
  host: process.env.SEEKDB_HOST || "127.0.0.1",
  port: Number(process.env.SEEKDB_PORT || 2881),
  user: process.env.SEEKDB_USER || "root",
  password: process.env.SEEKDB_PASSWORD || "difyai123456",
  database: process.env.SEEKDB_DATABASE || "test",
};
// Dify 建表的命名规则是 vector_index_<dataset_id 里的连字符换成下划线>_node
const TABLE = process.env.SEEKDB_TABLE || "vector_index_93bbd4ee_a5f2_48e4_aefc_f5215989f38a_node";
const EMBED_URL = process.env.EMBEDDING_BASE_URL || "http://127.0.0.1:8100/v1/embeddings";

let pool = null;
function db() {
  if (!pool) pool = mysql.createPool({ ...CFG, waitForConnections: true, connectionLimit: 4, charset: "utf8mb4" });
  return pool;
}

async function embed(text) {
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "Xenova/bge-small-zh-v1.5", input: [text] }),
  });
  if (!res.ok) throw new Error(`embedding 服务返回 ${res.status}`);
  const j = await res.json();
  return j.data[0].embedding;
}

// 两条通道：ik 全文 MATCH AGAINST + HNSW 向量 l2_distance APPROXIMATE，应用层 RRF 融合
// 注意 OceanBase 里 UNION ALL 两侧的分支必须各自加括号，否则 ER_PARSE_ERROR。
// 两个分支的打分列必须用同一个别名（这里都叫 score）：UNION ALL 的结果列名取自第一个分支，
// 若一个写 fts_score、一个写 vec_score，第二个分支的分数会被塞进 fts_score 列、vec_score 恒为 NULL。
function searchSql(queryText, queryVector, recall) {
  const vecLiteral = `[${queryVector.slice(0, 4).join(",")},…共 ${queryVector.length} 维]`;
  return `SELECT * FROM (
  (SELECT id, text, metadata, MATCH(\`text\`) AGAINST('${queryText}') AS score, 1 AS in_fts, 0 AS in_vec
     FROM ${TABLE} WHERE MATCH(\`text\`) AGAINST('${queryText}') LIMIT ${recall})
  UNION ALL
  (SELECT id, text, metadata, l2_distance(vector, '${vecLiteral}') AS score, 0 AS in_fts, 1 AS in_vec
     FROM ${TABLE} ORDER BY score APPROXIMATE LIMIT ${recall})
) t`;
}

async function hybridSearch({ queryText, queryVector, limit, mode, recall }) {
  const vecLiteral = `[${queryVector.join(",")}]`;
  const sql = `
    SELECT * FROM (
      (SELECT id, text, metadata, MATCH(\`text\`) AGAINST(?) AS score, 1 AS in_fts, 0 AS in_vec
       FROM ${TABLE} WHERE MATCH(\`text\`) AGAINST(?) LIMIT ${recall})
      UNION ALL
      (SELECT id, text, metadata, l2_distance(vector, '${vecLiteral}') AS score, 0 AS in_fts, 1 AS in_vec
       FROM ${TABLE} ORDER BY score APPROXIMATE LIMIT ${recall})
    ) t`;
  const [rows] = await db().query(sql, [queryText, queryText]);

  const fts = rows.filter((r) => r.in_fts).sort((a, b) => Number(b.score) - Number(a.score));
  const vec = rows.filter((r) => r.in_vec).sort((a, b) => Number(a.score) - Number(b.score));
  const K = 60;
  const merged = new Map();
  // 同一条素材可能在两路各出现一次（UNION ALL 两个分支的行是分开的），
  // 所以 fts_score / vec_distance 按通道各自记，不能只取先入表那一行的分数，
  // 否则 fts 分支先到的记录会把 vec_distance 显示成 0，消融表会误读成"没走向量"。
  const bump = (list, ch) => list.forEach((r, i) => {
    const prev = merged.get(r.id) || { row: r, rrf: 0, channels: [], fts: 0, vec: 0 };
    prev.rrf += 1 / (K + i + 1);
    prev.channels.push(`${ch}:${i + 1}`);
    if (ch === "fts") prev.fts = Number(r.score);
    else prev.vec = Number(r.score);
    merged.set(r.id, prev);
  });
  if (mode !== "vector") bump(fts, "fts");
  if (mode !== "fts") bump(vec, "vec");

  const out = [...merged.values()]
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, limit)
    .map((x) => ({
      id: x.row.id,
      text: String(x.row.text || "").replace(/\s+/g, " ").trim(),
      document_id: safeMeta(x.row.metadata, "document_id"),
      rrf: Number(x.rrf.toFixed(5)),
      fts_score: Number(x.fts.toFixed(6)),
      vec_distance: Number(x.vec.toFixed(6)),
      channels: x.channels.join(","),
    }));
  return out;
}

function safeMeta(raw, key) {
  try {
    const m = typeof raw === "string" ? JSON.parse(raw) : raw;
    return m?.[key] ?? null;
  } catch { return null; }
}

// seekdb/OceanBase 的 EXPLAIN 输出是单个 "Query Plan" 文本列（树状计划）。
// 完整输出里 "Outputs & filters" 段会把整条 512 维查询向量原样打出来，几百 KB 没法给评委看，
// 所以默认只返回算子树（能直接看到 TEXT RETRIEVAL SCAN 走全文索引、VECTOR INDEX SCAN 走 HNSW），
// 需要全文时传 explain_detail=true。
async function explain(queryText, queryVector, { detail = false } = {}) {
  const vecLiteral = `[${queryVector.join(",")}]`;
  const sql = `EXPLAIN SELECT * FROM (
      (SELECT id, MATCH(\`text\`) AGAINST(?) AS fts_score FROM ${TABLE} WHERE MATCH(\`text\`) AGAINST(?) LIMIT 10)
      UNION ALL
      (SELECT id, l2_distance(vector, '${vecLiteral}') AS vec_score FROM ${TABLE} ORDER BY vec_score APPROXIMATE LIMIT 10)
    ) t`;
  const [rows] = await db().query(sql, [queryText, queryText]);
  const plan = rows.map((r) => String(r["Query Plan"] ?? JSON.stringify(r))).join("\n");
  if (detail) return redact(plan);
  // 只要算子树：截到 "Outputs & filters:" 之前
  const lines = plan.split("\n");
  const cut = lines.findIndex((l) => l.includes("Outputs & filters"));
  return redact(lines.slice(0, cut > 0 ? cut : lines.length).join("\n").trim());
}

// 把打印出来的查询向量压掉，免得响应体积爆掉
function redact(plan) {
  return plan
    .split("\n")
    .map((line) => (line.length > 160 ? `${line.slice(0, 160)}…<截断：此处为 ${512} 维查询向量字面量>` : line))
    .join("\n");
}

function send(res, code, obj) {
  const buf = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": buf.length });
  res.end(buf);
}

// Dify 传参可能是 "true"/1/["hybrid"] 这类形态，先做一层归一化
function unwrap(v) {
  return Array.isArray(v) ? v[0] : v;
}
function truthy(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/health") {
      const [r] = await db().query(`SELECT COUNT(*) AS n FROM ${TABLE}`);
      return send(res, 200, { status: "ok", seekdb: { host: CFG.host, port: CFG.port, database: CFG.database }, table: TABLE, segments: r[0].n });
    }
    if (req.method === "POST" && (url.pathname === "/search" || url.pathname === "/api/search")) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const queryText = String(unwrap(body.query) || unwrap(body.queryText) || "").trim();
      if (!queryText) return send(res, 400, { error: "query 不能为空" });
      // Dify 工具节点把参数当字符串/数组传过来，这里统一做一次宽松解析
      const limit = Math.min(Number(unwrap(body.top_k) || unwrap(body.limit) || 5) || 5, 20);
      const recall = Math.min(Number(unwrap(body.recall) || 20) || 20, 100);
      const wantMode = String(unwrap(body.mode) || "hybrid").toLowerCase();
      const mode = ["hybrid", "vector", "fts"].includes(wantMode) ? wantMode : "hybrid";
      const t0 = Date.now();
      const queryVector = await embed(queryText);
      const tEmbed = Date.now() - t0;
      const results = await hybridSearch({ queryText, queryVector, limit, mode, recall });
      const out = { query: queryText, mode, limit, took_ms: Date.now() - t0, embed_ms: tEmbed, results };
      if (truthy(unwrap(body.explain))) out.explain = await explain(queryText, queryVector, { detail: truthy(unwrap(body.explain_detail)) });
      if (truthy(unwrap(body.show_sql))) out.sql = searchSql(queryText, queryVector, recall);
      return send(res, 200, out);
    }
    return send(res, 404, { error: `no route ${req.method} ${url.pathname}` });
  } catch (err) {
    console.error("[retrieval] error:", err);
    return send(res, 500, { error: String(err?.message || err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[retrieval] 监听 :${PORT}；目标表 ${CFG.database}.${TABLE}`);
});
