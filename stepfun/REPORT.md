# stepfun × seekdb 端侧混合检索知识库 · 评测报告

> 竞赛：阶跃星辰(StepFun) × OceanBase seekdb —— 浏览器端本地向量化 + 量化 + seekdb 向量/全文混合检索
> 日期：2026-10-29 ｜ 全部向量由浏览器端侧推理产生，未使用任何云端 embedding API

## 1. 系统形态

一句话：文档在浏览器里用 **transformers.js + bge-small-zh-v1.5** 就地算成 512 维向量，写入本地 **seekdb**；查询同样端侧向量化后，走一条 **向量(HNSW cosine) + 全文(ik 分词 MATCH…AGAINST) 的 UNION ALL SQL**，应用层用 **RRF** 融合排序。数据不出本机，云端只可选桥接。

- 端侧推理：@huggingface/transformers 4.3.2 + onnxruntime-web（WebGPU 优先，自动降级 WASM）
- 向量后端：seekdb（OceanBase 单机版，Docker，MySQL 协议 :2881）
- 索引：
  - `VECTOR KEY idx_vec (embedding) WITH (DISTANCE=COSINE, TYPE=HNSW, LIB=VSAG, M=16, EF_CONSTRUCTION=200, EF_SEARCH=64)`
  - `FULLTEXT KEY idx_fts (document) WITH PARSER ik`
- 语料/查询：stepfun 生成的中文评测集（40 篇文档 d01–d40 + 20 条标注查询 q01–q20，`D:/zh-retrieval-eval.json`），指标 Recall@K / NDCG@K。

## 2. 双索引真实命中（EXPLAIN 证据）

一次混合查询的执行计划，全文分支与向量分支各自走自己的索引，互不回表为全表扫描：

```
|0 |SUBPLAN SCAN           |t               |75 |
|1 |└─UNION ALL            |                |75 |
|2 |  ├─TEXT RETRIEVAL SCAN|kb_docs(idx_fts)|7  |   ← 全文：命中 FULLTEXT(ik) 索引
|3 |  └─VECTOR INDEX SCAN  |kb_docs(idx_vec)|68 |   ← 向量：命中 HNSW 索引
      match_expr(MATCH(kb_docs.document) AGAINST('两阶段提交里协调者宕机会怎样'))
```

## 3. 端侧推理性能对比（bge-small-zh-v1.5，512 维，单条查询向量）

本机 Intel 核显，浏览器实测；「加载」含首次 fetch + 建 session，「推理」为连续 20 条查询向量的**中位数**。

| 后端 | 精度 dtype | 模型体积 | 加载耗时 | 单条推理(中位) |
|---|---|---|---|---|
| WebGPU | fp16 | ≈47 MB | 2421 ms | **17 ms** |
| WebGPU | fp32 | ≈95 MB | 5751 ms | 22 ms |
| WebGPU | q8(INT8) | ≈24 MB | 284 ms | 123 ms |
| WASM(CPU) | q8(INT8) | ≈24 MB | **215 ms** | 39 ms |
| WASM(CPU) | fp16 | ≈47 MB | 551 ms | 77 ms |
| WASM(CPU) | fp32 | ≈95 MB | 455 ms | 82 ms |

观察：
- **WebGPU 上 fp16 最快**（17 ms/条），是端侧实时检索的理想配置；fp32 接近。
- **WebGPU 上 q8 反而慢**（123 ms）：onnxruntime-web 的 INT8 在 GPU 上缺少原生算子、走反量化回退，GPU 场景不建议用 q8。
- **WASM 上 q8 最优**（39 ms，且加载仅 215 ms、体积最小 24 MB）：CPU 整型运算天然加速，是无 WebGPU 设备（老机型）的推荐降级档。
- 量化对**质量无损**：WASM/q8 与 WebGPU/q8 的向量逐位一致，20 条查询的 top-5 命中完全相同。

## 4. 检索质量对比（消融：混合 vs 仅向量 vs 仅全文，K=5）

| 检索方式 | Recall@5 | NDCG@5 | MRR | 完全命中@5 | Top1 命中 |
|---|---|---|---|---|---|
| **混合（全文+向量 RRF）** | **0.975** | **0.934** | **0.938** | **19/20** | **18/20** |
| 仅向量（HNSW cosine） | 0.875 | 0.826 | 0.817 | 17/20 | 15/20 |
| 仅全文（ik MATCH…AGAINST） | 0.975 | 0.919 | 0.917 | 19/20 | 17/20 |

结论：**混合检索在排序质量（NDCG/MRR/Top1）上全面优于任一单通道**。
- 仅向量漏召两条：`q07「ReAct 范式」`、`q20「知识图谱缓解幻觉」`——查询词与目标文档字面重叠高但语义向量排序把它们挤出了 top-5；全文通道把它们补了回来。
- 仅全文 Top1 少于混合：个别查询靠语义而非字面时（如近义表述），向量通道贡献了正确排序。
- RRF 融合让两者互补，几乎消除了单通道的漏检。

逐查询命中排名（混合）：18/20 命中第 1 位，q12 第 2 位、q20 第 4 位，全部在 top-5 内。

## 5. 复现实验

```sh
# 1) 起 seekdb 容器（:2881）——见 scripts/，或复用 Task1 的桥接脚本
# 2) 起后端 API（:3011）
node stepfun/server/index.mjs
# 3) 起前端（:5210，代理 /api→3011；静态资源复用 spike/public 的模型与 wasm）
cd stepfun/app && npm install && npm run build && npm run preview
# 浏览器打开 http://127.0.0.1:5210 → 加载模型 → 导入40篇 → 检索（勾选 EXPLAIN 看双索引）
# 4) 质量指标
node stepfun/scripts/compute-metrics.mjs stepfun/scripts/eval-ablation.json
```

评测数据（每查询 top-5 命中，端侧向量 + 真实 seekdb 检索）见 `stepfun/scripts/eval-*.json`；指标口径为二元相关（relevant 记 1），Recall@K = 命中相关数/相关总数，NDCG@K 按 1/log2(rank+1) 折扣、以理想排序归一。
