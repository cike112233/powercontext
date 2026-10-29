// 端侧混合检索质量评测：读取浏览器导出的每查询 top-K 命中，计算 Recall@K / NDCG@K
// 用法： node scripts/compute-metrics.mjs <runs.json>
// runs.json 形如： [{ config:"webgpu/q8", label:"混合检索", perQuery:[{id,relevant,k,ranked:[docId,...]}] }, ...]
import fs from "node:fs";

const file = process.argv[2];
if (!file) { console.error("用法: node scripts/compute-metrics.mjs <runs.json>"); process.exit(1); }
const runs = JSON.parse(fs.readFileSync(file, "utf8"));

function recallAtK(ranked, relevant, k) {
  const top = ranked.slice(0, k);
  const hit = relevant.filter((r) => top.includes(r)).length;
  return relevant.length ? hit / relevant.length : 0;
}
function dcg(ranked, relevant, k) {
  let s = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) if (relevant.includes(ranked[i])) s += 1 / Math.log2(i + 2);
  return s;
}
function idcg(relevant, k) {
  let s = 0;
  for (let i = 0; i < Math.min(k, relevant.length); i++) s += 1 / Math.log2(i + 2);
  return s;
}
function ndcgAtK(ranked, relevant, k) {
  const ideal = idcg(relevant, k);
  return ideal ? dcg(ranked, relevant, k) / ideal : 0;
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

for (const run of runs) {
  const recs = [], ndcgs = [], mrr = [];
  for (const q of run.perQuery) {
    const k = q.k || 5;
    recs.push(recallAtK(q.ranked, q.relevant, k));
    ndcgs.push(ndcgAtK(q.ranked, q.relevant, k));
    const pos = q.ranked.findIndex((id) => q.relevant.includes(id));
    mrr.push(pos >= 0 ? 1 / (pos + 1) : 0);
  }
  const line = { config: run.config, label: run.label, n: run.perQuery.length,
    "Recall@5": +mean(recs).toFixed(4), "NDCG@5": +mean(ndcgs).toFixed(4), MRR: +mean(mrr).toFixed(4),
    "完全命中@5": recs.filter((x) => x === 1).length + "/" + recs.length,
    "Top1命中": mrr.map((x) => x === 1 ? 1 : 0).reduce((a, b) => a + b, 0) + "/" + mrr.length };
  console.log(JSON.stringify(line, null, 2));
  if (run.detail) {
    console.log("  逐查询（排名位置，-1=未命中）:");
    for (const q of run.perQuery) {
      const pos = q.ranked.findIndex((id) => q.relevant.includes(id));
      console.log(`    ${q.id} 期望 ${q.relevant.join(",")} → ${pos >= 0 ? "rank " + (pos + 1) : "MISS"}  [${q.ranked.join(" ")}]`);
    }
  }
  if (run.perf) console.log("  性能: " + JSON.stringify(run.perf));
}
