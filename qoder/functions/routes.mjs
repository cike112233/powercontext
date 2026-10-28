// 智能科研助手 · Qoder Sites Function 业务路由（function_backend 模式）
//
// 所有数据访问都在服务端完成：浏览器只请求同源 /functions/v1/app/api/*，
// 数据库凭据由平台注入，绝不出现在前端产物中。
//
// 路由：
//   GET  /api/health   健康检查（匿名）
//   GET  /api/status   后端连接状态与知识库条目数
//   GET  /api/list     知识库列表（可按 category 过滤）
//   GET  /api/logs     检索记录（使用痕迹，可追溯）
//   POST /api/search   服务端向量语义检索 + 写入检索记录
//   POST /api/add      知识入库
//
// 依赖注入（db / BackendError）仅用于本地测试；index.ts 保留 Deno.serve。

const CATEGORIES = ["paper", "note", "idea", "reference", "experiment"];
const DIM = 128; // 向量维度
const LIST_LIMIT = 200;
const SEARCH_SCAN_LIMIT = 500;
const LOG_LIMIT = 20;
const NO_STORE = { "Cache-Control": "no-store" };

// ---------- 服务端向量化：TF-IDF 加权哈希向量 + 余弦相似度 ----------

function tokenize(text) {
  const lowered = String(text ?? "").toLowerCase();
  const tokens = [];
  // 英文/数字词
  for (const match of lowered.matchAll(/[a-z0-9_+#.]{2,}/g)) tokens.push(match[0]);
  // 中文字符二元组（无需分词器即可覆盖中文语义片段）
  for (const segment of lowered.matchAll(/[\u4e00-\u9fff]+/g)) {
    const chars = segment[0];
    if (chars.length === 1) tokens.push(chars);
    for (let i = 0; i + 1 < chars.length; i += 1) tokens.push(chars.slice(i, i + 2));
  }
  return tokens;
}

function hashToken(token) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

export function embedTokens(tokens, weight) {
  const vector = new Array(DIM).fill(0);
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const [token, count] of counts) {
    const hash = hashToken(token);
    const index = hash % DIM;
    const sign = (hash >>> 16) & 1 ? 1 : -1;
    // 词频取对数抑制长文本，IDF 权重（由调用方按候选集词频提供）抑制通用词
    vector[index] += sign * (1 + Math.log(count)) * (weight ? weight(token) : 1);
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  return vector.map((value) => value / norm);
}

export function embed(text, weight) {
  return embedTokens(tokenize(text), weight);
}

/** 基于候选集的词频统计构造 IDF 权重函数（TF-IDF 加权哈希向量） */
export function createIdfWeight(documents) {
  const total = documents.length || 1;
  const df = new Map();
  for (const tokens of documents) {
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
  }
  return (token) => {
    const freq = df.get(token) ?? 0;
    // 查询词未出现在候选集中时按 0.5 篇文档估算，避免权重为 0
    return Math.log(1 + total / (freq || 0.5));
  };
}

function cosine(a, b) {
  let sum = 0;
  for (let i = 0; i < DIM; i += 1) sum += a[i] * b[i];
  return sum;
}

function documentText(row) {
  const tags = Array.isArray(row.tags) ? row.tags.join(" ") : "";
  return `${row.title} ${tags} ${row.content}`;
}

// ---------- 应用 ----------

export function application({ db, BackendError }) {
  const fail = (code, status) => {
    throw new BackendError(code, status);
  };
  const rows = (result) => {
    if (result?.error) fail(result.error.code || "database_error", result.error.status || 503);
    return result.data;
  };

  async function readJson(request, limit = 32768) {
    if (!request.headers.get("content-type")?.startsWith("application/json")) fail("invalid_input", 400);
    const reader = request.body?.getReader();
    if (!reader) fail("invalid_input", 400);
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          fail("payload_too_large", 413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      fail("invalid_input", 400);
    }
  }

  const toEntry = (row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    category: row.category,
    tags: Array.isArray(row.tags) ? row.tags : [],
    source: row.source ?? undefined,
    created_at: row.created_at,
  });

  return async (ctx) => {
    const request = ctx.request;
    const method = request.method;
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 网关保留业务后缀，但把 app 替换为部署的物理 Function 名；
    // Provider 也可能先剥掉 /functions/v1 前缀。本地测试直接用 /api/*。
    const match = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
    const path = match ? match[1] || "/" : pathname.startsWith("/api/") ? pathname : null;
    if (!path) fail("not_found", 404);

    if (path === "/api/health" && method === "GET") return Response.json({ ok: true }, { headers: NO_STORE });

    if (path === "/api/status" && method === "GET") {
      const counted = await db.from("knowledge_entries").select("id", { count: "exact" }).limit(1);
      if (counted.error) fail(counted.error.code || "database_error", counted.error.status || 503);
      const total = Number.isSafeInteger(counted.count) ? counted.count : 0;
      return Response.json(
        {
          connected: true,
          count: total,
          collection: "knowledge_entries",
          backend: "qoder-sites-function-database",
          vector: { algorithm: "cosine", dimensions: DIM, embedding: "tfidf-hashing" },
        },
        { headers: NO_STORE },
      );
    }

    if (path === "/api/list" && method === "GET") {
      const category = url.searchParams.get("category");
      let query = db.from("knowledge_entries").select("id,title,content,category,tags,source,created_at");
      if (category && category !== "all") {
        if (!CATEGORIES.includes(category)) fail("invalid_input", 400);
        query = query.eq("category", category);
      }
      const data = rows(await query.order("created_at", { ascending: false }).limit(LIST_LIMIT));
      return Response.json({ entries: (data ?? []).map(toEntry) }, { headers: NO_STORE });
    }

    if (path === "/api/logs" && method === "GET") {
      const data = rows(
        await db
          .from("search_logs")
          .select("query,category,result_count,top_score,created_at")
          .order("created_at", { ascending: false })
          .limit(LOG_LIMIT),
      );
      return Response.json(
        {
          logs: (data ?? []).map((row) => ({
            query: row.query,
            category: row.category,
            result_count: row.result_count,
            // 数据库以整数基点（0-10000）存储相似度，返回给前端时还原为 0-1
            top_score: (row.top_score ?? 0) / 10000,
            created_at: row.created_at,
          })),
        },
        { headers: NO_STORE },
      );
    }

    if (path === "/api/search" && method === "POST") {
      const body = await readJson(request);
      const queryText = typeof body?.query === "string" ? body.query.trim() : "";
      if (!queryText || queryText.length > 200) fail("invalid_input", 400);
      const category = typeof body?.category === "string" && body.category !== "all" ? body.category : undefined;
      if (category && !CATEGORIES.includes(category)) fail("invalid_input", 400);
      const topK = Number.isInteger(body?.topK) && body.topK >= 1 && body.topK <= 20 ? body.topK : 5;

      let scan = db.from("knowledge_entries").select("id,title,content,category,tags,source,created_at");
      if (category) scan = scan.eq("category", category);
      const candidates = rows(await scan.order("created_at", { ascending: false }).limit(SEARCH_SCAN_LIMIT)) ?? [];

      // TF-IDF 加权哈希向量：IDF 由当前候选集的词频统计得出，通用词权重被抑制
      const docTokens = candidates.map((row) => tokenize(documentText(row)));
      const idf = createIdfWeight(docTokens);
      const queryVector = embed(queryText, idf);
      const scored = candidates
        .map((row, index) => ({
          entry: toEntry(row),
          score: cosine(queryVector, embedTokens(docTokens[index], idf)),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((item) => ({ ...item.entry, score: Math.max(0, Math.round(item.score * 10000) / 10000) }));

      const topScore = scored.length > 0 ? scored[0].score : 0;

      // 检索记录：使用痕迹落库，供“验证材料”追溯（尽力而为，失败不影响检索结果）
      const log = await db.from("search_logs").insert({
        id: crypto.randomUUID(),
        query: queryText,
        category: category ?? "all",
        result_count: scored.length,
        top_score: Math.round(topScore * 10000),
        created_at: new Date().toISOString(),
      });
      const recorded = !log?.error;

      return Response.json({ results: scored, query: queryText, logged: recorded }, { headers: NO_STORE });
    }

    if (path === "/api/add" && method === "POST") {
      const body = await readJson(request);
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const content = typeof body?.content === "string" ? body.content.trim() : "";
      const category = typeof body?.category === "string" ? body.category : "";
      if (!title || title.length > 200) fail("invalid_input", 400);
      if (!content || content.length > 8000) fail("invalid_input", 400);
      if (!CATEGORIES.includes(category)) fail("invalid_input", 400);
      const tags = Array.isArray(body?.tags)
        ? body.tags.filter((tag) => typeof tag === "string" && tag.trim()).slice(0, 10).map((tag) => tag.trim().slice(0, 50))
        : [];
      const source = typeof body?.source === "string" && body.source.trim() ? body.source.trim().slice(0, 300) : null;
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();

      rows(
        await db.from("knowledge_entries").insert({
          id,
          title,
          content,
          category,
          tags,
          source,
          created_at: createdAt,
        }),
      );
      return Response.json({ success: true, id, created_at: createdAt }, { status: 201, headers: NO_STORE });
    }

    fail("not_found", 404);
  };
}
