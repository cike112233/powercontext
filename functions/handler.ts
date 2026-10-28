// 智能科研助手 - Qoder Sites Function 代理层
//
// 作用：发布站点是 https，浏览器不允许直连 http 的后端服务器（mixed content）。
// 本 Function 在服务端把同源请求转发到运行 seekdb 的后端服务器（固定可信目标），
// 使发布站点上的语义搜索、知识入库、检索记录全部由真实 seekdb 完成。
//
// 路由（逻辑子路径 /functions/v1/app/*）：
//   GET  status  -> 后端 /api/status   seekdb 连接状态与数据量
//   GET  list    -> 后端 /api/list      知识库列表
//   GET  logs    -> 后端 /api/logs      检索记录（使用痕迹）
//   POST search  -> 后端 /api/search    seekdb 向量语义检索
//   POST add     -> 后端 /api/add       知识入库（自动向量化）

// 后端服务器地址（运行 seekdb 的 ECS 公网地址）。部署时替换为实际 IP。
const API_ORIGIN = Deno.env.get("RESEARCH_API_ORIGIN") ?? "http://SEEKDB_BACKEND_IP:3001";
const UPSTREAM_TIMEOUT_MS = 20000;

const JSON_HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function proxy(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const upstream = await fetch(`${API_ORIGIN}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
    });
    const data = await upstream.json();
    return json(data, upstream.ok ? 200 : 502);
  } catch {
    // 后端不可达时返回稳定错误码，前端据此回退到演示模式
    return json({ ok: false, error: "backend_unavailable" }, 503);
  } finally {
    clearTimeout(timer);
  }
}

export function handler(request: Request): Response | Promise<Response> {
  const url = new URL(request.url);
  // 取逻辑子路径的最后一段作为路由键（网关会替换函数名段，不能假设完整路径）
  const segments = url.pathname.split("/").filter(Boolean);
  const route = segments[segments.length - 1] ?? "";

  if (request.method === "GET") {
    if (route === "status") return proxy("/api/status");
    if (route === "logs") return proxy("/api/logs");
    if (route === "list") {
      const category = url.searchParams.get("category");
      return proxy(`/api/list${category ? `?category=${encodeURIComponent(category)}` : ""}`);
    }
    if (route === "app" || route === "") {
      return json({ ok: true, service: "research-assistant-api", routes: ["status", "list", "logs", "search", "add"] });
    }
    return json({ ok: false, error: "not_found" }, 404);
  }

  if (request.method === "POST") {
    if (route === "search" || route === "add") {
      return (async () => {
        let body: unknown;
        try {
          const text = await request.text();
          if (text.length > 100_000) return json({ ok: false, error: "payload_too_large" }, 413);
          body = JSON.parse(text);
        } catch {
          return json({ ok: false, error: "invalid_json" }, 400);
        }
        if (route === "search") {
          const q = (body as { query?: unknown })?.query;
          if (typeof q !== "string" || !q.trim() || q.length > 500) {
            return json({ ok: false, error: "invalid_query" }, 400);
          }
        } else {
          const entry = body as { title?: unknown; content?: unknown };
          if (typeof entry.title !== "string" || !entry.title.trim() ||
              typeof entry.content !== "string" || !entry.content.trim() ||
              entry.title.length > 200 || entry.content.length > 20_000) {
            return json({ ok: false, error: "invalid_entry" }, 400);
          }
        }
        return proxy(route === "search" ? "/api/search" : "/api/add", {
          method: "POST",
          body: JSON.stringify(body),
        });
      })();
    }
    return json({ ok: false, error: "not_found" }, 404);
  }

  return json({ ok: false, error: "method_not_allowed" }, 405);
}
