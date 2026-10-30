// 配置 Dify 的模型：本地 embedding（OpenAI-API-compatible → dify/embedding）+ DeepSeek LLM。
//
// 凭据纪律：DeepSeek Key 只从环境变量 DEEPSEEK_API_KEY 读取，脚本、仓库、日志里都不出现明文；
// 不传该变量就跳过 LLM 配置（可以在 Dify 后台"集成 → 模型供应商 → DeepSeek"里手工填一次）。
// embedding 用的是本机服务，不需要真实密钥，api_key 填占位串即可（服务端不校验）。
//
// 用法：
//   DIFY_ADMIN_EMAIL=… DIFY_ADMIN_PASSWORD=… node scripts/setup-models.mjs
//   DEEPSEEK_API_KEY=sk-xxx node scripts/setup-models.mjs   # 顺带把 LLM 也配好
import { login, post, get } from "./dify-console.mjs";

const EMBEDDING_BASE = process.env.EMBEDDING_BASE_URL || "http://host.docker.internal:8100/v1";
const OAC = "langgenius/openai_api_compatible/openai_api_compatible";
const DEEPSEEK = "langgenius/deepseek/deepseek";
const EMBED_MODEL = process.env.EMBEDDING_MODEL || "Xenova/bge-small-zh-v1.5";
const LLM_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-flash";

await login();

// 1) embedding：OpenAI-API-compatible 指向本地 bge 服务
const emb = await post(`/workspaces/current/model-providers/${encodeURIComponent(OAC)}/models/credentials`, {
  provider: OAC,
  model_type: "text-embedding",
  model: EMBED_MODEL,
  credentials: {
    endpoint_url: EMBEDDING_BASE,
    api_key: process.env.EMBEDDING_API_KEY || "local-no-key",
    encoding_format: "float",
    context_size: "8192",
    max_chunks: "10",
  },
  load_balancing_enabled: false,
});
console.log(`[models] embedding ${EMBED_MODEL} ← ${EMBEDDING_BASE} 结果=${emb.result}`);

// 2) 把 embedding 设为系统默认，知识库创建时才会用它
const d1 = await post("/workspaces/current/default-model", {
  model_settings: [{ model_type: "text-embedding", provider: OAC, model: EMBED_MODEL }],
});
console.log("[models] 默认 embedding:", d1.result);

// 3) DeepSeek LLM（需要用户自己的 Key）
const key = process.env.DEEPSEEK_API_KEY;
if (!key) {
  console.log("[models] 未提供 DEEPSEEK_API_KEY，跳过 LLM 配置（请在 Dify 后台手工填入，Key 不要进 git）");
  process.exit(0);
}
const llm = await post(`/workspaces/current/model-providers/${encodeURIComponent(DEEPSEEK)}/models/credentials`, {
  provider: DEEPSEEK,
  model_type: "llm",
  model: LLM_MODEL,
  credentials: { api_key: key },
  load_balancing_enabled: false,
});
console.log(`[models] LLM ${LLM_MODEL} 配置结果=${llm.result}`);
const d2 = await post("/workspaces/current/default-model", {
  model_settings: [
    { model_type: "llm", provider: DEEPSEEK, model: LLM_MODEL },
    { model_type: "rerank", provider: DEEPSEEK, model: LLM_MODEL },
  ],
});
console.log("[models] 默认 LLM:", d2.result);

const providers = await get("/workspaces/current/model-providers");
const on = (providers.providers || []).filter((p) => p.custom_configuration?.configured).map((p) => p.provider);
console.log("[models] 已配置供应商:", on.join(", "));
