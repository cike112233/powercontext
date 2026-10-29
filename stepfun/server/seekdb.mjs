// seekdb 后端模块：连接、建表（512 维向量 + ik 全文索引）、混合检索、写入
// 复用 Task 1 验证过的三步 bootstrap + charset utf8mb4 经验。
import { SeekdbClient } from "seekdb";

const DB = "stepfun_kb";
const TABLE = "kb_docs";
export const EMBED_DIM = 512; // bge-small-zh-v1.5

let client = null;

async function connect() {
  if (client) return client;
  // 1) 无库连接，确保 database 存在
  const bootstrap = new SeekdbClient({
    host: "127.0.0.1", port: 2881, user: "root", password: "", charset: "utf8mb4",
  });
  await bootstrap.execute("SELECT 1");
  const dbs = await bootstrap.listDatabases();
  if (!dbs.some((d) => d.name === DB)) await bootstrap.createDatabase(DB);
  await bootstrap.close();
  // 2) 带库连接
  client = new SeekdbClient({
    host: "127.0.0.1", port: 2881, user: "root", password: "",
    database: DB, charset: "utf8mb4",
  });
  await client.execute("SELECT 1");
  return client;
}

// 建表：同时带 VECTOR KEY(HNSW/COSINE) 与 FULLTEXT KEY(ik 中文分词)
export async function initSchema() {
  const c = await connect();
  const exists = await c.execute(
    "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
    [DB, TABLE]
  );
  if (Number(exists[0]?.n ?? 0) > 0) return { created: false, table: TABLE };
  await c.execute(`
    CREATE TABLE ${TABLE} (
      id VARCHAR(64) NOT NULL,
      title VARCHAR(255) DEFAULT '',
      document TEXT,
      embedding VECTOR(${EMBED_DIM}),
      meta JSON,
      PRIMARY KEY (id),
      FULLTEXT KEY idx_fts (document) WITH PARSER ik,
      VECTOR KEY idx_vec (embedding) WITH (DISTANCE=COSINE, TYPE=HNSW, LIB=VSAG, M=16, EF_CONSTRUCTION=200, EF_SEARCH=64)
    )
  `);
  return { created: true, table: TABLE };
}

export async function upsertDoc({ id, title, document, embedding, meta }) {
  const c = await connect();
  const vecLiteral = `[${embedding.join(",")}]`;
  await c.execute(
    `INSERT INTO ${TABLE} (id, title, document, embedding, meta)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), document=VALUES(document),
       embedding=VALUES(embedding), meta=VALUES(meta)`,
    [id, title || "", document, vecLiteral, JSON.stringify(meta || {})]
  );
}

export async function count() {
  const c = await connect();
  const r = await c.execute(`SELECT COUNT(*) AS n FROM ${TABLE}`);
  return Number(r[0]?.n ?? 0);
}

export async function allIds() {
  const c = await connect();
  const r = await c.execute(`SELECT id FROM ${TABLE} ORDER BY id`);
  return r.map((x) => x.id);
}

export async function deleteIds(ids) {
  const c = await connect();
  for (const id of ids) await c.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [id]);
  return ids.length;
}

// 混合检索：一条 SQL，UNION ALL 全文候选 + 向量候选，应用层 RRF 融合
// mode: 'hybrid'（默认，双通道 RRF）| 'vector'（仅向量）| 'fts'（仅全文）—— 用于消融对比
export async function hybridSearch({ queryText, queryVector, limit = 5, k = 60, mode = "hybrid" }) {
  const c = await connect();
  const vecLiteral = `[${queryVector.join(",")}]`;
  const cand = limit * 4;
  const sql = `
    SELECT id, title, document, fts_score, vec_score, channel FROM (
      (SELECT id, title, document,
              MATCH(document) AGAINST(?) AS fts_score,
              0 AS vec_score, 'fts' AS channel
       FROM ${TABLE}
       WHERE MATCH(document) AGAINST(?)
       ORDER BY fts_score DESC
       LIMIT ${cand})
      UNION ALL
      (SELECT id, title, document,
              0 AS fts_score,
              (1 - cosine_distance(embedding, ?)) AS vec_score,
              'vector' AS channel
       FROM ${TABLE}
       ORDER BY cosine_distance(embedding, ?) APPROXIMATE
       LIMIT ${cand})
    ) AS _hybrid`;
  const rows = await c.execute(sql, [queryText, queryText, vecLiteral, vecLiteral]);

  // RRF 融合：按 fts_score / vec_score 各自排名，score = Σ 1/(k+rank)
  const byId = new Map();
  const rank = (arr) => {
    arr.forEach((row, i) => {
      const cur = byId.get(row.id) || { id: row.id, title: row.title, document: row.document, rrf: 0, fts: 0, vec: 0 };
      cur.rrf += 1 / (k + i + 1);
      if (row.channel === "fts") cur.fts = Number(row.fts_score);
      else cur.vec = Number(row.vec_score);
      byId.set(row.id, cur);
    });
  };
  const ftsRows = rows.filter((r) => r.channel === "fts").sort((a, b) => Number(b.fts_score) - Number(a.fts_score));
  const vecRows = rows.filter((r) => r.channel === "vector").sort((a, b) => Number(b.vec_score) - Number(a.vec_score));
  if (mode === "vector") rank(vecRows);
  else if (mode === "fts") rank(ftsRows);
  else { rank(ftsRows); rank(vecRows); }

  return [...byId.values()].sort((a, b) => b.rrf - a.rrf).slice(0, limit);
}

export async function explainHybrid(queryText, queryVector) {
  const c = await connect();
  const vecLiteral = `[${queryVector.join(",")}]`;
  const sql = `EXPLAIN SELECT id FROM (
      (SELECT id FROM ${TABLE} WHERE MATCH(document) AGAINST(?) ORDER BY MATCH(document) AGAINST(?) DESC LIMIT 10)
      UNION ALL
      (SELECT id FROM ${TABLE} ORDER BY cosine_distance(embedding, ?) APPROXIMATE LIMIT 10)
    ) t`;
  // SDK execute() 只对 SELECT/SHOW/DESCRIBE 返回行，EXPLAIN 需用底层 mysql2 连接直取
  const raw = c._delegate._internal.connectionManager.getRawConnection();
  const [rows] = await raw.query(sql, [queryText, queryText, vecLiteral]);
  return rows;
}

export async function close() {
  if (client) { await client.close(); client = null; }
}
