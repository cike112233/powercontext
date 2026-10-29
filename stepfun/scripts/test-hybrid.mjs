import { initSchema, upsertDoc, hybridSearch, explainHybrid, count, close, EMBED_DIM } from "../server/seekdb.mjs";

function randVec(seed) {
  let s = seed;
  const v = Array.from({ length: EMBED_DIM }, () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s / 0x7fffffff) - 0.5; });
  let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

const docs = [
  { id: "t1", title: "HNSW 原理", document: "HNSW 是一种基于多层图结构的近似最近邻索引，通过贪心搜索在高层定位候选再逐层下降，查询复杂度接近对数级。" },
  { id: "t2", title: "IVF 量化", document: "IVF 倒排文件索引先用聚类把向量分桶，检索时只扫描最近的若干桶，配合 PQ 乘积量化压缩存储。" },
  { id: "t3", title: "全文检索分词", document: "中文全文检索依赖分词器，ik 分词器支持智能切分与细粒度切分，MATCH AGAINST 计算相关性得分。" },
  { id: "t4", title: "OceanBase 架构", document: "OceanBase 是原生分布式关系数据库，采用 LSM 树存储引擎，Paxos 协议保证多副本强一致。" },
];

await initSchema();
for (let i = 0; i < docs.length; i++) {
  const d = docs[i];
  await upsertDoc({ ...d, embedding: randVec(i + 1), meta: { topic: d.title } });
}
console.log("count =", await count());

const q = "近似最近邻图索引怎么加速查询";
const results = await hybridSearch({ queryText: q, queryVector: randVec(1), limit: 3 });
console.log("\n=== 混合检索结果 (RRF) ===");
for (const r of results) console.log(`${r.id} [${r.title}] rrf=${r.rrf.toFixed(4)} fts=${r.fts.toFixed(3)} vec=${r.vec.toFixed(3)}`);

console.log("\n=== EXPLAIN 计划 ===");
const plan = await explainHybrid(q, randVec(1));
for (const row of plan) {
  const line = row.OPERATOR || row.operator || JSON.stringify(row);
  console.log(line);
}
const flat = JSON.stringify(plan);
console.log("\n命中 TEXT RETRIEVAL SCAN:", /TEXT RETRIEVAL/i.test(flat));
console.log("命中 VECTOR INDEX:", /VECTOR/i.test(flat));

await close();
