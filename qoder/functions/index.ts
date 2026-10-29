import { createDatabaseClient, createSiteContext, errorResponse, BackendError } from "./_qoder/backend.mjs";
import { application } from "./routes.mjs";

// ---------- seekdb 桥接开关 ----------
// 本地跑 `bash scripts/start-seekdb-bridge.sh` 起 Docker seekdb + Node API +
// Cloudflare quick tunnel 后，把隧道输出的 https URL 填到这里，重新构建发布，
// 站点就会真实调用 seekdb（HNSW 向量索引 + 自动向量化 + search_logs 落库）。
// 留空字符串 = 回退到 Qoder Sites 私有数据库的 128 维哈希向量检索模式。
const SEEKDB_PROXY_URL = "https://hills-investing-def-delivers.trycloudflare.com";

// _qoder/ 由平台在部署前注入（数据库客户端、站点上下文、统一错误响应），
// 不要在仓库中创建该目录，也不要把数据库凭据写入本项目任何文件。
const handle = application({ db: createDatabaseClient(), BackendError });

async function forwardToSeekdb(request: Request): Promise<Response | null> {
  if (!SEEKDB_PROXY_URL) return null;
  const url = new URL(request.url);
  const apiIndex = url.pathname.indexOf("/api/");
  if (apiIndex === -1) return null;
  const suffix = url.pathname.slice(apiIndex) + url.search;
  const init: RequestInit = { method: request.method };
  if (request.method === "POST") {
    init.headers = { "Content-Type": "application/json" };
    init.body = await request.text();
  }
  const upstream = await fetch(`${SEEKDB_PROXY_URL}${suffix}`, init);
  const body = await upstream.arrayBuffer();
  return new Response(body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (request) => {
  let context;
  try {
    // 先尝试 seekdb 代理，避免平台上下文创建消费掉 POST body
    const proxied = await forwardToSeekdb(request);
    if (proxied) return proxied;
    context = createSiteContext(request);
    return await handle(context);
  } catch (error) {
    return errorResponse(error, context?.requestId);
  }
});
