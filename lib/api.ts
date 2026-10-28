/**
 * 前端 API 统一入口
 *
 * 所有请求都走同源的业务 API 前缀 /functions/v1/app/api/*：
 * - 发布站点：由 Qoder Sites Function（functions/index.ts + routes.mjs）在服务端
 *   访问平台注入凭据的私有数据库，浏览器不接触任何数据库凭据。
 * - 本地开发：vite 代理把同一前缀转发到 dev/function-local.mjs（同一套路由代码），
 *   因此本地与线上走完全一致的调用路径。
 * - 本地额外回退：若同源 Function 未启动，再尝试本地 seekdb API 服务
 *   http://localhost:3001（node server/index.mjs，真实 seekdb 向量检索）。
 * - 两者都不可用时，各调用方回退到内置演示数据，保证页面永远可用。
 */

const FUNCTION_BASE = "/functions/v1/app";
const LOCAL_SEEKDB_BASE = "http://localhost:3001";

const isLocalhost =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export const API_BASE = FUNCTION_BASE;

export const isLiveEnvironment = !isLocalhost;

const BASES = isLocalhost ? [FUNCTION_BASE, LOCAL_SEEKDB_BASE] : [FUNCTION_BASE];

async function fetchOnce<T>(base: string, path: string, init: RequestInit | undefined, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: init?.body ? { "Content-Type": "application/json" } : init?.headers,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  let lastError: unknown;
  for (const base of BASES) {
    try {
      return await fetchOnce<T>(base, path, init, timeoutMs);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("backend_unavailable");
}

export interface BackendStatus {
  connected: boolean;
  count: number;
  collection: string;
  backend?: string;
  vector?: { algorithm: string; dimensions?: number; embedding?: string };
}

export interface BackendEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  source?: string;
  created_at?: string;
}

export interface BackendSearchItem extends BackendEntry {
  score: number;
}

export interface SearchLogRow {
  query: string;
  category: string;
  result_count: number;
  top_score: number;
  created_at: string;
}

export const api = {
  status: () => request<BackendStatus>("/api/status"),
  list: (category?: string) =>
    request<{ entries: BackendEntry[] }>(
      `/api/list${category && category !== "all" ? `?category=${encodeURIComponent(category)}` : ""}`,
    ),
  logs: () => request<{ logs: SearchLogRow[] }>("/api/logs"),
  search: (query: string, category?: string, topK = 5) =>
    request<{ results: BackendSearchItem[]; query?: string; logged?: boolean }>("/api/search", {
      method: "POST",
      body: JSON.stringify({ query, category: category && category !== "all" ? category : undefined, topK }),
    }),
  add: (entry: BackendEntry) =>
    request<{ success: boolean; id: string }>("/api/add", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
};
