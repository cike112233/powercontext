/**
 * Function 业务路由本地自检（真实路由代码 + 内存数据库，无云端凭据）
 *
 *   node dev/function-test.mjs
 */

import { handle, db } from "./function-local.mjs";

const BASE = "http://127.0.0.1:8000/functions/v1/app";
let passed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

async function call(path, init) {
  const response = await handle(new Request(`${BASE}${path}`, init));
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const post = (path, payload, headers) =>
  call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });

console.log("[function-test] 健康检查与状态");
const health = await call("/api/health");
check("GET /api/health -> 200 ok", health.status === 200 && health.body?.ok === true, JSON.stringify(health));

const status = await call("/api/status");
check("GET /api/status -> connected", status.status === 200 && status.body?.connected === true, JSON.stringify(status.body));
check("GET /api/status -> count 8", status.body?.count === 8, `count=${status.body?.count}`);

console.log("[function-test] 知识库列表");
const list = await call("/api/list");
check("GET /api/list -> 8 条", list.status === 200 && list.body?.entries?.length === 8, `n=${list.body?.entries?.length}`);
check("GET /api/list -> tags 为数组", Array.isArray(list.body?.entries?.[0]?.tags));
const filtered = await call("/api/list?category=paper");
check("GET /api/list?category=paper -> 2 条", filtered.body?.entries?.length === 2, `n=${filtered.body?.entries?.length}`);
check(
  "GET /api/list?category=paper -> 全部为 paper",
  filtered.body?.entries?.every((entry) => entry.category === "paper"),
);
const badCategory = await call("/api/list?category=nope");
check("GET /api/list?category=nope -> 400", badCategory.status === 400, `status=${badCategory.status}`);

console.log("[function-test] 向量语义检索");
const zh = await post("/api/search", { query: "seekdb 的 HNSW 向量索引怎么调优", topK: 5 });
check("POST /api/search -> 200", zh.status === 200, JSON.stringify(zh.body));
check(
  "中文查询命中 seekdb 调优笔记",
  zh.body?.results?.[0]?.title?.includes("seekdb 向量检索性能调优"),
  `top=${zh.body?.results?.[0]?.title}`,
);
check("相似度在 0-1 之间", zh.body?.results?.[0]?.score > 0 && zh.body.results[0].score <= 1, `score=${zh.body?.results?.[0]?.score}`);
check("返回条数 <= topK", zh.body?.results?.length <= 5);
check("检索已落库", zh.body?.logged === true, JSON.stringify(zh.body));

const en = await post("/api/search", { query: "Transformer self attention mechanism" });
check(
  "英文查询命中 Transformer 条目",
  en.body?.results?.[0]?.title?.includes("Transformer"),
  `top=${en.body?.results?.[0]?.title}`,
);

const scoped = await post("/api/search", { query: "向量数据库", category: "experiment" });
check(
  "分类过滤生效",
  scoped.body?.results?.every((item) => item.category === "experiment"),
  JSON.stringify(scoped.body?.results?.map((item) => item.category)),
);

const emptyQuery = await post("/api/search", { query: "   " });
check("空查询 -> 400", emptyQuery.status === 400, `status=${emptyQuery.status}`);
const wrongMethod = await call("/api/search");
check("GET /api/search -> 404", wrongMethod.status === 404, `status=${wrongMethod.status}`);

console.log("[function-test] 检索记录（使用痕迹）");
const logs = await call("/api/logs");
check("GET /api/logs -> 有记录", logs.status === 200 && logs.body?.logs?.length >= 3, `n=${logs.body?.logs?.length}`);
check(
  "记录包含查询词/命中数/相似度",
  logs.body?.logs?.[0]?.query && typeof logs.body.logs[0].result_count === "number" && logs.body.logs[0].top_score >= 0,
  JSON.stringify(logs.body?.logs?.[0]),
);
check("最新记录在前", logs.body?.logs?.[0]?.query === "向量数据库", `first=${logs.body?.logs?.[0]?.query}`);

console.log("[function-test] 知识入库");
const added = await post("/api/add", {
  title: "OceanBase 向量检索能力调研",
  content: "seekdb 兼容 MySQL 协议，支持向量列与 HNSW 索引，可直接用 SQL 完成向量检索。",
  category: "reference",
  tags: ["OceanBase", "seekdb"],
  source: "本地调研",
});
check("POST /api/add -> 201", added.status === 201 && added.body?.success === true, JSON.stringify(added.body));
const afterAdd = await call("/api/status");
check("入库后 count 变为 9", afterAdd.body?.count === 9, `count=${afterAdd.body?.count}`);
const listAfter = await call("/api/list");
check(
  "列表包含新条目",
  listAfter.body?.entries?.some((entry) => entry.title === "OceanBase 向量检索能力调研"),
);
const newEntrySearch = await post("/api/search", { query: "seekdb 兼容 MySQL 协议 向量列" });
check(
  "新入库条目可被检索到",
  newEntrySearch.body?.results?.some((item) => item.title === "OceanBase 向量检索能力调研"),
  JSON.stringify(newEntrySearch.body?.results?.map((item) => item.title)),
);

const invalidAdd = await post("/api/add", { title: "缺内容", category: "note" });
check("缺少 content -> 400", invalidAdd.status === 400, `status=${invalidAdd.status}`);
const badCategoryAdd = await post("/api/add", { title: "x", content: "y", category: "unknown" });
check("非法分类 -> 400", badCategoryAdd.status === 400, `status=${badCategoryAdd.status}`);

console.log("[function-test] 未知路由");
const unknown = await call("/api/nope");
check("未知路径 -> 404", unknown.status === 404, `status=${unknown.status}`);

console.log(`\n[function-test] 通过 ${passed} 项，失败 ${failures.length} 项`);
console.log(`[function-test] 内存表状态：knowledge_entries=${db.tables.knowledge_entries.length}, search_logs=${db.tables.search_logs.length}`);
if (failures.length > 0) {
  console.error(`[function-test] 失败项：${failures.join(", ")}`);
  process.exit(1);
}
