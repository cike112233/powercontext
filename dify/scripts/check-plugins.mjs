const BASE = process.env.DIFY_BASE_URL || "http://localhost";
const res = await fetch(`${BASE}/console/api/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: process.env.DIFY_ADMIN_EMAIL, password: Buffer.from(process.env.DIFY_ADMIN_PASSWORD, "utf8").toString("base64"), remember_me: true }) });
const cookie = (res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0]).join("; ");
const csrf = /(?:^|;\s*)csrf_token=([^;]+)/.exec(cookie)?.[1];
const taskId = process.argv[2];
async function get(p) { const r = await fetch(`${BASE}/console/api${p}`, { headers: { Cookie: cookie, "X-CSRF-Token": csrf } }); return r.json(); }
if (taskId) { const t = await get(`/workspaces/current/plugin/tasks/${taskId}`); console.log("task:", JSON.stringify(t).slice(0, 700)); }
const list = await get("/workspaces/current/plugin/list?page=1&limit=20");
console.log("installed:", JSON.stringify((list.plugins || []).map((x) => `${x.author}/${x.name}:${x.plugin_version} learning=${x.installation_status ?? ""}`), null, 1));
