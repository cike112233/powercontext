# seekdb 混合检索 · 参考实现要点（来自 origin/2026-competition commit 158c524c）

PowerContext 主仓的 `retrieval-02-hybrid-search` 赛题已验证：seekdb 可用**一条 SQL** 同时走全文与向量两路候选。

## 结构：UNION ALL 双分支 + 外层排序

```sql
SELECT memory_artifact_id, ..., distance, _channel
FROM (
  -- 分支 1：全文候选（TEXT RETRIEVAL SCAN）
  SELECT ..., NULL AS distance, 'fts' AS _channel
  FROM heads JOIN versions ...
  WHERE MATCH(searchable_text) AGAINST(:query)
  ORDER BY MATCH(searchable_text) AGAINST(:query) DESC
  LIMIT :candidate_limit

  UNION ALL

  -- 分支 2：向量候选（VECTOR INDEX / HNSW）
  SELECT ..., l2_distance(embedding, :query_vector) AS distance, 'vector' AS _channel
  FROM vector_entries JOIN versions ...
  ORDER BY l2_distance(embedding, :query_vector) APPROXIMATE
  LIMIT :candidate_limit
) AS _hybrid
ORDER BY distance ASC LIMIT :candidate_limit
```

## 关键 SQL 原语（seekdb / OceanBase MySQL 模式）
- 全文：`MATCH (col) AGAINST (:query)`，需 `FULLTEXT KEY ... WITH PARSER ik`（中文分词）
- 向量：`l2_distance(embedding, :vec)` 或 `cosine_distance(...)`，需 `VECTOR KEY ... WITH (DISTANCE=COSINE, TYPE=HNSW, LIB=VSAG, M=16, EF_CONSTRUCTION=200, EF_SEARCH=64)`
- `APPROXIMATE` 关键字：让向量 ORDER BY 走 HNSW 索引而非全表暴力算距离（EXPLAIN 里显示 `VECTOR INDEX`）
- 验收要 EXPLAIN 同时出现 `TEXT RETRIEVAL SCAN` 和 `VECTOR INDEX`，不能全表扫描后在应用层算

## 融合（应用层）
两路各自有序候选 → RRF（Reciprocal Rank Fusion）：`score = Σ 1/(k + rank)`，k 常取 60。
PowerContext 保留 distance 原值，融合在 Python 层做；本项目同理，Node 层做 RRF。

## 本项目落地（差异）
- Task 1 的 seekdb-js collection 表已**同时**带 FULLTEXT(ik) + VECTOR(HNSW) 两个索引，无需另建表
- 用 `client.execute(sql, params)` 裸 SQL 走混合检索，绕开 SDK 的纯向量 `collection.search()`
- 向量维度 512（bge-small-zh-v1.5），与 Task 1 的 128 维哈希向量不同——需新建独立 collection 或独立表
