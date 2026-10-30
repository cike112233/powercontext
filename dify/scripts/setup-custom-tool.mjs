// 把 dify/retrieval/openapi.yaml 注册成 Dify 的"自定义工具（OpenAPI）"供应商。
// 幂等：同名 provider 已存在时先删再加。跑法：
//   DIFY_ADMIN_EMAIL=… DIFY_ADMIN_PASSWORD=… node setup-custom-tool.mjs [--test]
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { login, get, post } from "./dify-console.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(HERE, "../retrieval/openapi.yaml");
const PROVIDER_NAME = process.env.SEEKDB_TOOL_PROVIDER || "seekdb_hybrid_search";
const TOOL_NAME = "seekdb_hybrid_search";

const schema = readFileSync(SCHEMA_PATH, "utf8");
await login();
console.log("[tool] 登录成功，schema 长度", schema.length);

const asList = (x) => (Array.isArray(x) ? x : x?.tools || x?.providers || []);

// 1) 已存在则先删，保证幂等（列表接口是 /workspaces/current/tools/api）
const listed = await get("/workspaces/current/tools/api");
const exists = asList(listed).find((p) => p.name === PROVIDER_NAME || p.provider === PROVIDER_NAME);
if (exists) {
  console.log("[tool] 已存在 provider，先删除:", exists.provider || exists.name);
  await post("/workspaces/current/tool-provider/api/delete", { provider: exists.provider || exists.name });
}

// 2) 新增（auth_type=0 表示无鉴权，本机服务不需要 key）
const added = await post("/workspaces/current/tool-provider/api/add", {
  provider: PROVIDER_NAME,
  icon: { background: "#DBEAFE", content: "🔍" },
  credentials: { auth_type: "none" },
  schema_type: "openapi",
  schema,
  privacy_policy: "",
  custom_disclaimer: "本工具直连本机 seekdb 容器（OceanBase 单机版），只在本地网络内检索自有知识库。",
  labels: [],
});
console.log("[tool] add =>", JSON.stringify(added));

// 3) 回读，拿到 DSL 里要用的 provider id / name / provider_type
const after = await get("/workspaces/current/tools/api");
const me = asList(after).find((p) => p.name === PROVIDER_NAME || p.provider === PROVIDER_NAME);
if (!me) { console.error("[tool] 注册后没找到 provider，原始返回:", JSON.stringify(after).slice(0, 800)); process.exit(1); }
console.log("[tool] provider:", JSON.stringify({ id: me?.id, name: me?.name, provider: me?.provider, schema_type_str: me?.schema_type_str, custom_disclaimer: me?.custom_disclaimer }, null, 1));
for (const t of me?.tools || []) {
  console.log("[tool]   tool:", t.name, "| label:", JSON.stringify(t.label), "| params:", (t.params || []).map((p) => `${p.name}:${p.type}${p.required ? "*" : ""}`).join(", "));
}

// 4) 可选：不落库直接试调用一次，顺便把 EXPLAIN 打出来当证据
if (process.argv.includes("--test")) {
  const query = process.env.SEEKDB_TOOL_QUERY || "MVCC 是怎么实现一致性读快照的？";
  const res = await post("/workspaces/current/tool-provider/api/test/pre", {
    tool_name: TOOL_NAME,
    provider_name: PROVIDER_NAME,
    credentials: { auth_type: "none" },
    parameters: { query, mode: "hybrid", top_k: "3", explain: "true" },
    schema_type: "openapi",
    schema,
  });
  console.log("[tool] test/pre =>", JSON.stringify(res).slice(0, 1200));
}
