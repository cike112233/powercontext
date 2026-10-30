// 给应用建一个 Service API Key（本地调试用，别提交进 git）。
//   DIFY_ADMIN_EMAIL=… DIFY_ADMIN_PASSWORD=… DIFY_APP_ID=… node make-app-key.mjs
import { login, get, post } from "./dify-console.mjs";

const APP_ID = process.env.DIFY_APP_ID;
if (!APP_ID) throw new Error("需要 DIFY_APP_ID");

await login();
const list = await get(`/apps/${APP_ID}/api-keys`);
const existing = (list.data || [])[0];
if (existing) {
  console.log("[key] 已有 API Key（列表里通常是打码的，如需明文请重建）:", existing.id, existing.label || "");
}
const key = await post(`/apps/${APP_ID}/api-keys`, {});
console.log("[key] 明文 token（只出现这一次，请自行保管，勿提交）:", key.token);
console.log("[key] 用法: DIFY_APP_KEY=<token> node run-app.mjs \"…\"");
