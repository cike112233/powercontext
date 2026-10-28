/**
 * 本地运行真实的 Function 业务路由（无需 Deno、无需任何云端凭据）
 *
 *   node dev/function-local.mjs            # 内存数据库 + 8 条示例知识
 *   SEEKDB_API_ORIGIN=http://127.0.0.1:3001 node dev/function-local.mjs
 *                                          # 转发到本地真实 seekdb API 服务
 *
 * 配合 vite 代理（/functions/v1/app -> 127.0.0.1:8000），本地与发布站点
 * 使用完全相同的前端调用路径和完全相同的 functions/routes.mjs 业务代码。
 */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { application } from "../functions/routes.mjs";

const PORT = Number(process.env.PORT ?? 8000);
const HOST = "127.0.0.1";
const SEEKDB_API_ORIGIN = process.env.SEEKDB_API_ORIGIN;

class BackendError extends Error {
  constructor(code, status) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** 最小可用的内存数据库，模拟平台注入的 Supabase 风格链式客户端 */
export function createMemoryDb(seed = []) {
  const base = new Date("2026-10-20T09:00:00.000Z").getTime();
  const tables = {
    knowledge_entries: seed.map((entry, index) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      category: entry.category,
      tags: entry.tags ?? [],
      source: entry.source ?? null,
      created_at: new Date(base + index * 3600_000).toISOString(),
    })),
    search_logs: [],
  };

  const execute = (table, state) => {
    if (state.mode === "insert") {
      for (const row of state.rows) tables[table].push(row);
      return { data: state.rows, error: null, count: state.rows.length };
    }
    let data = tables[table].slice();
    for (const [column, value] of state.filters) data = data.filter((row) => row[column] === value);
    if (state.order) {
      const { column, ascending } = state.order;
      data.sort((a, b) => (a[column] < b[column] ? -1 : a[column] > b[column] ? 1 : 0) * (ascending ? 1 : -1));
    }
    const count = data.length;
    if (state.limit != null) data = data.slice(0, state.limit);
    return { data, error: null, count };
  };

  const from = (table) => {
    if (!tables[table]) tables[table] = [];
    const state = { mode: "select", filters: [], order: null, limit: null, rows: [], count: null };
    const builder = {
      select(_columns, options) {
        state.mode = "select";
        state.count = options?.count ?? null;
        return builder;
      },
      eq(column, value) {
        state.filters.push([column, value]);
        return builder;
      },
      order(column, options) {
        state.order = { column, ascending: options?.ascending !== false };
        return builder;
      },
      limit(n) {
        state.limit = n;
        return builder;
      },
      insert(row) {
        state.mode = "insert";
        state.rows = [row];
        return builder;
      },
      then(resolve, reject) {
        try {
          const result = execute(table, state);
          resolve(state.count ? { ...result } : result);
        } catch (error) {
          reject(error);
        }
      },
    };
    return builder;
  };

  return { from, tables };
}

async function loadSeed() {
  const path = fileURLToPath(new URL("./seed-entries.json", import.meta.url));
  return JSON.parse(await readFile(path, "utf-8"));
}

const seed = await loadSeed();
const db = createMemoryDb(seed);
const routes = application({ db, BackendError });

function errorResponse(error) {
  if (error instanceof BackendError) {
    return Response.json({ ok: false, error: error.code }, { status: error.status });
  }
  console.error("[local-function]", error);
  return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
}

async function handle(request) {
  const pathname = new URL(request.url).pathname;
  if (SEEKDB_API_ORIGIN && pathname.includes("/api/")) {
    const suffix = pathname.slice(pathname.indexOf("/api/"));
    try {
      const upstream = await fetch(`${SEEKDB_API_ORIGIN}${suffix}`, {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: request.method === "GET" ? undefined : await request.text(),
      });
      return Response.json(await upstream.json(), { status: upstream.ok ? 200 : 502 });
    } catch {
      return Response.json({ ok: false, error: "backend_unavailable" }, { status: 503 });
    }
  }
  try {
    return await routes({ request, requestId: crypto.randomUUID() });
  } catch (error) {
    return errorResponse(error);
  }
}

function startServer() {
  // Node 内置 HTTP 服务器适配到 Web Request/Response
  const server = createServer(async (nodeReq, nodeRes) => {
    const url = `http://${nodeReq.headers.host ?? `${HOST}:${PORT}`}${nodeReq.url}`;
    const chunks = [];
    for await (const chunk of nodeReq) chunks.push(chunk);
    const request = new Request(url, {
      method: nodeReq.method,
      headers: nodeReq.headers,
      body: nodeReq.method === "GET" || nodeReq.method === "HEAD" ? undefined : Buffer.concat(chunks),
    });
    const response = await handle(request);
    nodeRes.statusCode = response.status;
    for (const [key, value] of response.headers) nodeRes.setHeader(key, value);
    nodeRes.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(PORT, HOST);
  return server;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startServer();
  console.log(`[local-function] http://${HOST}:${PORT}/functions/v1/app/api/status`);
  console.log(`[local-function] 内存知识库 ${db.tables.knowledge_entries.length} 条（本地示例数据）`);
  if (SEEKDB_API_ORIGIN) console.log(`[local-function] /api/* 转发到 ${SEEKDB_API_ORIGIN}`);
}

export { handle, db, startServer };
