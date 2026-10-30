// 把知识库的检索方式设为 hybrid_search（Dify 里知识库节点的检索模式取自数据集自身的 retrieval_model），
// 这是让 Dify 原生检索走 seekdb "全文+向量" 混合通道的前提。跑法：
//   DIFY_ADMIN_EMAIL=… DIFY_ADMIN_PASSWORD=… DIFY_DATASET_ID=… node set-dataset-hybrid.mjs
import { login, get, call } from "./dify-console.mjs";

const DATASET_ID = process.env.DIFY_DATASET_ID;
if (!DATASET_ID) throw new Error("需要 DIFY_DATASET_ID");

await login();

const before = await get(`/datasets/${DATASET_ID}`);
console.log("[kb] 当前 retrieval_model:", JSON.stringify(before.retrieval_model));

const retrieval_model = {
  search_method: "hybrid_search",
  reranking_enable: false,
  reranking_model: { reranking_provider_name: "", reranking_model_name: "" },
  weights: null,
  top_k: Number(process.env.DIFY_TOP_K || 5),
  score_threshold_enabled: false,
  score_threshold: null,
};

await call(`/datasets/${DATASET_ID}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ retrieval_model }),
});

const after = await get(`/datasets/${DATASET_ID}`);
console.log("[kb] 设置后 retrieval_model:", JSON.stringify(after.retrieval_model));
console.log("[kb] embedding:", after.embedding_model, "| provider:", after.embedding_model_provider, "| docs:", after.document_count, "| technique:", after.indexing_technique);
