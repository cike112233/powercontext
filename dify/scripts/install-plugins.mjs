// 离线安装 Dify 模型供应商插件（不依赖 marketplace.dify.ai）
//
// 背景：国内环境实测容器内访问 marketplace.dify.ai 直接失败（curl 返回 000），
//       Dify 后台的 Marketplace 安装不可用，只能走"本地 .difypkg 上传"这条 API 路径。
//       插件包由 dify/plugins/package-plugin.py 从 langgenius/dify-official-plugins 源码打包得到。
//
// 用法：
//   DIFY_BASE_URL=http://localhost \
//   DIFY_ADMIN_EMAIL=admin@seekdb.local DIFY_ADMIN_PASSWORD=Seekdb2026Demo \
//   node scripts/install-plugins.mjs ../plugins/dist/langgenius-deepseek-0.0.26.difypkg
// 可一次传多个 .difypkg。凭据只从环境变量读，不写死、不入库。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.DIFY_BASE_URL || "http://localhost";
const EMAIL = process.env.DIFY_ADMIN_EMAIL;
const PASSWORD = process.env.DIFY_ADMIN_PASSWORD;
const pkgs = process.argv.slice(2).filter((a) => a.endsWith(".difypkg"));

if (!EMAIL || !PASSWORD) {
  console.error("缺少 DIFY_ADMIN_EMAIL / DIFY_ADMIN_PASSWORD 环境变量");
  process.exit(1);
}
if (!pkgs.length) {
  console.error("用法: node install-plugins.mjs <插件1.difypkg> [插件2.difypkg ...]");
  process.exit(1);
}

async function api(pathname, init = {}, cookie) {
  const headers = { ...(init.headers || {}) };
  if (cookie) Object.assign(headers, authHeaders(cookie));
  const res = await fetch(`${BASE}/console/api${pathname}`, { ...init, headers, redirect: "manual" });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${pathname}: ${text.slice(0, 300)}`);
  return { body, res };
}

// Dify 1.18 的 /login 有两个坑，脚本这里都踩过后修好：
// 1) decrypt_password_field 装饰器要求 password 字段先 Base64（它只做 b64decode，不是真加密，
//    传输安全靠 HTTPS）。发明文会 401 {"message":"Invalid encrypted data"}。
// 2) 登录成功返回 {"result":"success","data":null}，token 不再放 body，
//    而是通过 Set-Cookie(httpOnly) 下发 access_token / refresh_token / csrf_token，
//    后续请求要带 Cookie + X-CSRF-Token。
const loginRes = await fetch(`${BASE}/console/api/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: Buffer.from(PASSWORD, "utf8").toString("base64"), remember_me: true }),
});
const loginText = await loginRes.text();
if (!loginRes.ok) throw new Error(`登录失败 ${loginRes.status}: ${loginText.slice(0, 200)}`);
const cookies = (loginRes.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]);
const cookie = cookies.join("; ");
if (!cookie.includes("access_token")) throw new Error(`登录响应里没有 access_token cookie: ${cookies.join(" | ")}`);
console.log(`[plugins] 登录成功（拿到 ${cookies.length} 个 cookie）`);

function authHeaders(cookieString) {
  const csrf = /(?:^|;\s*)csrf_token=([^;]+)/.exec(cookieString)?.[1];
  const access = /(?:^|;\s*)access_token=([^;]+)/.exec(cookieString)?.[1];
  const h = { Cookie: cookieString };
  if (access) h["X-CSRF-Token"] = csrf || access;
  return h;
}

const identifiers = [];
for (const pkg of pkgs) {
  const abs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), pkg);
  const buf = readFileSync(abs);
  const form = new FormData();
  form.append("pkg", new Blob([buf], { type: "application/octet-stream" }), path.basename(abs));
  const { body: decoded } = await api("/workspaces/current/plugin/upload/pkg", { method: "POST", body: form }, cookie);
  const list = decoded.packages || [];
  // upload/pkg 实际返回的是解包结果本身：{unique_identifier, manifest, ...}
  // （早期文档写的 packages[].plugin_unique_identifier 在 1.18 并不存在，这里两种都兼容）
  const id = decoded.unique_identifier || list[0]?.plugin_unique_identifier;
  console.log(`[plugins] 解析 ${path.basename(abs)} → ${decoded.manifest?.name || list[0]?.name || "?"} ${id || "(无 id)"}`);
  if (!id) throw new Error(`无法从 ${path.basename(abs)} 解析 plugin_unique_identifier: ${JSON.stringify(decoded).slice(0, 300)}`);
  identifiers.push(id);
}

const { body: installed } = await api(
  "/workspaces/current/plugin/install/pkg",
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plugin_unique_identifiers: identifiers }),
  },
  cookie
);
console.log("[plugins] 安装结果:", JSON.stringify(installed).slice(0, 600));
