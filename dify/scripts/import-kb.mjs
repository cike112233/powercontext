// 建知识库 + 把 dify/kb/*.md 语料导入 Dify（向量真实写入 seekdb）
//
// 分块策略与语料格式配套：kb 里每个 "### Q:" 小节自成一体且内部无空行，
// 所以用自定义规则按 "###" 切分，max_chunk_size=1600 token 足够装下一整道题
// （题干+考察点+参考答案要点+追问+评分标尺+常见误区），保证"一道题 = 一个检索块"。
//
// 用法：
//   DIFY_ADMIN_EMAIL=… DIFY_ADMIN_PASSWORD=… node scripts/import-kb.mjs
// 已存在同名知识库时脚本会复用它并跳过重复导入（按文档名判断）。
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { login, post, get, call } from "./dify-console.mjs";

const BASE = process.env.DIFY_BASE_URL || "http://localhost";
const KB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../kb");
const KB_NAME = process.env.DIFY_KB_NAME || "面试陪练知识库";
const KB_DESC =
  process.env.DIFY_KB_DESC ||
  "求职技术面试题库（数据库/OS/网络/分布式/算法/项目/行为面），底层向量库为真实 seekdb，开启 ik 全文 + HNSW 向量混合检索。";

const files = readdirSync(KB_DIR).filter((f) => f.endsWith(".md") && f !== "CORPUS-SPEC.md").sort();
if (!files.length) throw new Error(`kb 目录没有语料：${KB_DIR}`);

await login();

// 1) 找/建知识库
const listed = await get("/datasets?page=1&limit=50");
let dataset = (listed.data || []).find((d) => d.name === KB_NAME);
if (!dataset) {
  dataset = await post("/datasets", {
    name: KB_NAME,
    description: KB_DESC,
    indexing_technique: "high_quality",
    permission: "only_me",
    provider: "vendor",
  });
  console.log(`[kb] 已创建知识库 ${dataset.name} id=${dataset.id}`);
} else {
  console.log(`[kb] 复用已有知识库 ${dataset.name} id=${dataset.id}`);
}
const datasetId = dataset.id;

// 2) 知识库 API Key（只用于本机脚本调用，不落仓库）
const keys = await post(`/datasets/${datasetId}/api-keys`, {});
const apiKey = keys.token || keys.api_key || keys.data?.token;
if (!apiKey) throw new Error(`拿不到知识库 API Key: ${JSON.stringify(keys).slice(0, 200)}`);

// 3) 逐个导入（跳过同名文档，可重复执行；--reindex 会先删同名文档再重建索引）
const REINDEX = process.argv.includes("--reindex");
const existing = await get(`/datasets/${datasetId}/documents?page=1&limit=200`);
const byName = new Map((existing.data || []).map((d) => [d.name, d.id]));
const batches = [];
for (const file of files) {
  const name = file.replace(/\.md$/, "");
  if (byName.has(name)) {
    if (!REINDEX) {
      console.log(`[kb] 跳过（已存在）${name}`);
      continue;
    }
    await call(`/datasets/${datasetId}/documents/${byName.get(name)}`, { method: "DELETE" });
    console.log(`[kb] --reindex：已删除旧文档 ${name}，重新导入`);
  }
  const raw = readFileSync(path.join(KB_DIR, file), "utf8");
  // 语料以 "## 小节" 开头、以 "### Q:" 为块边界；按 "###" 切分时第一片只剩小节标题，
  // 它会变成一个几十字的碎片块并在全文通道里拿高分（实测污染 Top1），所以先把首个 "### " 之前的内容丢掉。
  const firstQ = raw.indexOf("### ");
  const text = firstQ > 0 ? raw.slice(firstQ) : raw;
  const r = await fetch(`${BASE}/v1/datasets/${datasetId}/document/create-by-text`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      text,
      doc_form: "text_model",
      doc_language: "Chinese",
      indexing_technique: "high_quality",
      process_rule: {
        mode: "custom",
        rules: {
          pre_processing_rules: [
            { id: "remove_extra_spaces", enabled: true },
            { id: "remove_urls_emails", enabled: false },
          ],
          segmentation: { separator: "###", max_tokens: 1600 },
        },
      },
    }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`导入 ${file} 失败 ${r.status}: ${body.slice(0, 300)}`);
  const j = JSON.parse(body);
  batches.push({ name, batch: j.batch, documentId: j.document?.id });
  console.log(`[kb] 提交 ${name} → batch=${j.batch}`);
}

// 4) 等待索引完成（Dify worker 会调用本地 embedding 服务，再把向量写进 seekdb）
for (const b of batches) {
  const deadline = Date.now() + 10 * 60 * 1000;
  let status = "waiting";
  while (Date.now() < deadline) {
    const r = await fetch(`${BASE}/v1/datasets/${datasetId}/documents/${b.batch}/indexing-status`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const j = await r.json();
    const items = j.data || [];
    status = items.map((x) => x.indexing_status).join(",") || status;
    if (items.some((x) => x.completed_segments > 0) && items.every((x) => ["completed", "error"].includes(x.indexing_status))) {
      console.log(`[kb] ${b.name} 完成：segments=${items[0]?.completed_segments} tokens=${items[0]?.total_tokens} status=${items[0]?.indexing_status}`);
      break;
    }
    await new Promise((res) => setTimeout(res, 4000));
  }
  console.log(`[kb] ${b.name} 最终状态: ${status}`);
}

const after = await get(`/datasets/${datasetId}/documents?page=1&limit=200`);
console.log(`[kb] 知识库现有文档 ${after.data?.length} 个：` + (after.data || []).map((d) => `${d.name}(${d.segments_count ?? "?"}段)`).join("、"));
console.log(`[kb] dataset_id=${datasetId}`);
console.log(`[kb] 本次使用的知识库 API Key（本机临时，请勿提交）：${apiKey.slice(0, 12)}…`);
