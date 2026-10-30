// Dify console API 小客户端：登录拿 cookie，之后 GET/POST 都带上 Cookie + X-CSRF-Token。
// 凭据只从环境变量读（DIFY_ADMIN_EMAIL / DIFY_ADMIN_PASSWORD），脚本本身不含任何真实密钥。
const BASE = process.env.DIFY_BASE_URL || "http://localhost";
let cookie = null, csrf = null;

export async function login() {
  const res = await fetch(`${BASE}/console/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.DIFY_ADMIN_EMAIL,
      password: Buffer.from(process.env.DIFY_ADMIN_PASSWORD, "utf8").toString("base64"),
      remember_me: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`登录失败 ${res.status}: ${text.slice(0, 200)}`);
  cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
  csrf = /(?:^|;\s*)csrf_token=([^;]+)/.exec(cookie)?.[1];
  return { ok: true };
}

export async function call(pathname, init = {}) {
  if (!cookie) await login();
  const headers = { Cookie: cookie, "X-CSRF-Token": csrf, ...(init.headers || {}) };
  const res = await fetch(`${BASE}/console/api${pathname}`, { ...init, headers });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${pathname}: ${text.slice(0, 400)}`);
  return body;
}

export const get = (p) => call(p);
export const post = (p, obj) => call(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });
