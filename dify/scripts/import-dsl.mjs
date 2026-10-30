// 用 DSL 创建/覆盖 Dify 应用：POST /apps/imports(yaml-content) -> 必要时 /apps/imports/<id>/confirm
// 跑法：
//   DIFY_ADMIN_EMAIL=… DIFY_ADMIN_PASSWORD=… DIFY_DATASET_ID=<知识库id> \
//     node import-dsl.mjs ../dsl/interview-coach.yml [--publish] [--export out.yml]
// 说明：DSL 里知识库节点的 dataset_ids 是租户内 id，脚本会在导入前把它换成本机实际的 DIFY_DATASET_ID，
// 这样评委在自己机器上导入也能直接接上他们自建的知识库。
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { login, get, post } from "./dify-console.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const isFlagValue = (i) => i > 0 && args[i - 1].startsWith("--");
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const fileArg = args.filter((a, i) => !a.startsWith("--") && !isFlagValue(i))[0] || "../dsl/interview-coach.yml";
const FILE = path.resolve(HERE, fileArg);

let yaml = readFileSync(FILE, "utf8");
await login();

// DSL 里的 dataset id 与自定义工具 provider id 都是"租户内主键"，
// 换台机器就变了。导入前按当前工作区的真实 id 重写一遍，评委导入后不用手工重新选知识库/工具。
if (process.env.DIFY_DATASET_ID) {
  yaml = yaml.replace(/(dataset_ids:\n\s*- )([0-9a-f-]{36})/m, `$1${process.env.DIFY_DATASET_ID}`);
  console.log("[dsl] dataset_id ->", process.env.DIFY_DATASET_ID);
}
const TOOL_PROVIDER_NAME = process.env.SEEKDB_TOOL_PROVIDER || "seekdb_hybrid_search";
const apiProviders = await get("/workspaces/current/tools/api");
const provider = (Array.isArray(apiProviders) ? apiProviders : apiProviders.tools || apiProviders.providers || [])
  .find((p) => p.name === TOOL_PROVIDER_NAME);
if (provider) {
  yaml = yaml.replace(/(provider_id: )([0-9a-f-]{36})(\n\s*provider_name: )/m, `$1${provider.id}$3`);
  console.log(`[dsl] 工具 provider "${TOOL_PROVIDER_NAME}" id ->`, provider.id);
} else {
  console.warn(`[dsl] 工作区里没找到自定义工具 "${TOOL_PROVIDER_NAME}"，DSL 里的 provider_id 保持原值（导入后需要在节点里重选工具）`);
}

const overwriteAppId = flag("app-id");
const res = await post("/apps/imports", {
  mode: "yaml-content",
  yaml_content: yaml,
  ...(overwriteAppId ? { app_id: overwriteAppId } : {}),
});
console.log("[dsl] import:", JSON.stringify({ id: res.id, status: res.status, app_id: res.app_id, name: res.name, error: res.error, version: res.imported_dsl_version, version_status: res.imported_dsl_version_status }));

let appId = res.app_id;
if (res.status === "pending" || (!appId && res.id)) {
  const confirmed = await post(`/apps/imports/${res.id}/confirm`, {});
  console.log("[dsl] confirm:", JSON.stringify({ status: confirmed.status, app_id: confirmed.app_id, error: confirmed.error }));
  appId = confirmed.app_id;
}
if (!appId) throw new Error("导入没有返回 app_id");
console.log("[dsl] app_id =", appId);

if (args.includes("--publish")) {
  const draft = await get(`/apps/${appId}/workflows/draft`);
  const pub = await post(`/apps/${appId}/workflows/publish`, {
    name: draft.name,
    graph: draft.graph,
    features: draft.features,
    conversation_variables: draft.conversation_variables,
  });
  console.log("[dsl] publish:", JSON.stringify({ id: pub.id, version: pub.version }).slice(0, 200));
}

if (args.includes("--export")) {
  const idx = args.indexOf("--export");
  const out = path.resolve(HERE, args[idx + 1] || "exported.yml");
  const dumped = await get(`/apps/${appId}/export?type=app&format=yaml`);
  const text = typeof dumped === "string" ? dumped : dumped.data;
  if (!text || typeof text !== "string") throw new Error(`导出返回异常: ${JSON.stringify(dumped).slice(0, 200)}`);
  writeFileSync(out, text, "utf8");
  console.log("[dsl] 已导出服务器规范 DSL ->", out, `(${text.length} 字符)`);
}
