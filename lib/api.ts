/**
 * 前端 API 统一入口
 *
 * - 本地开发（localhost）：直连本地 API 服务器 http://localhost:3001
 * - 发布站点（https）：走同源 Qoder Sites Function 代理 /functions/v1/app，
 *   由 Function 在服务端转发到运行 seekdb 的后端服务器，避免 mixed content。
 * - 后端不可达时各调用方回退到内置演示数据，保证页面永远可用。
 */

const isLocalhost =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

export const API_BASE = isLocalhost ? "http://localhost:3001" : "/functions/v1/app";

export const isLiveEnvironment = !isLocalhost;

async function request<T>(path: string, init?: RequestInit, timeoutMs = 12000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
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

export interface BackendStatus {
  connected: boolean;
  count: number;
  collection: string;
}

export interface BackendEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  source?: string;
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
  status: () => request<BackendStatus>("/status"),
  list: (category?: string) =>
    request<{ entries: BackendEntry[] }>(`/list${category && category !== "all" ? `?category=${encodeURIComponent(category)}` : ""}`),
  logs: () => request<{ logs: SearchLogRow[] }>("/logs"),
  search: (query: string, category?: string, topK = 5) =>
    request<{ results: BackendSearchItem[] }>("/search", {
      method: "POST",
      body: JSON.stringify({ query, category: category && category !== "all" ? category : undefined, topK }),
    }),
  add: (entry: BackendEntry) =>
    request<{ success: boolean; id: string }>("/add", {
      method: "POST",
      body: JSON.stringify(entry),
    }),
};
