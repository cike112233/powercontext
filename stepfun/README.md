# stepfun × seekdb · 端侧混合检索知识库

阶跃星辰(StepFun) × OceanBase seekdb 赛题作品。核心：文档在**浏览器端**用 transformers.js + `bge-small-zh-v1.5` 就地量化向量化（WebGPU 优先，自动降级 WASM），写入 **seekdb**；查询同样端侧向量化后，走一条 **向量(HNSW cosine) + 全文(ik `MATCH…AGAINST`) 的 `UNION ALL` SQL**，应用层 **RRF** 融合排序。数据不出本机。

评测结论见 [REPORT.md](./REPORT.md)：混合检索 NDCG@5 **0.934** / Recall@5 **0.975** / Top1 **18/20**，优于仅向量与仅全文；端侧 WebGPU/fp16 单条向量 17ms、WASM/q8 降级 39ms 且量化零质量损失。

## 目录结构

```
stepfun/
  server/        Node 后端（连 seekdb，暴露 /api/* ；:3011）
    seekdb.mjs     建表(向量+全文双索引) / upsert / hybridSearch(mode=hybrid|vector|fts) / explainHybrid
    index.mjs      http 服务
  app/           Vite 前端（浏览器端侧推理 + UI；:5210，代理 /api→:3011）
    src/embedder.js  transformers.js 封装（本地模型 /models/，wasm /ort-wasm/）
    src/api.js       后端调用
    index.html, src/main.js  导入→向量化→写入→混合检索→导出
  scripts/       评测与工具
    fetch-assets.mjs     下载模型 + 复制 wasm（大文件不进 git）
    test-hybrid.mjs      混合检索 + EXPLAIN 自检
    compute-metrics.mjs  Recall@K / NDCG@K / MRR
    eval-*.json          端侧向量检索的逐查询 top-5 命中数据
  spike/         早期可行性验证（WebGPU 推理跑通），spike/public 亦为前端静态资源目录
  REPORT.md      性能对比表 + 质量消融报告
```

## 快速开始

前置：Node ≥ 22、Docker。连接配置均为本地占位（`root` / 空密码 / `127.0.0.1:2881`），不含任何真实凭据。

```sh
# 1) 起 seekdb（OceanBase 单机版）
docker run -d --name stepfun-seekdb -p 2881:2881 oceanbase/seekdb:latest

# 2) 装依赖 + 准备端侧模型/wasm（首次约 200MB，走 hf-mirror 国内镜像）
cd stepfun
npm install                       # 后端：seekdb + mysql2
npm install --prefix app          # 前端：@huggingface/transformers + vite
node scripts/fetch-assets.mjs     # 下载 bge-small-zh-v1.5 + 复制 onnxruntime wasm

# 3) 起后端 + 前端
node server/index.mjs                          # API  http://127.0.0.1:3011
npm --prefix app run build && app 目录内 preview  # 前端 http://127.0.0.1:5210（vite.config 已配 /api 代理）
```

打开 <http://127.0.0.1:5210>：加载模型（选 dtype 与后端）→ 导入评测语料(40篇) → 输入查询检索，勾选 **EXPLAIN** 即可看到 `TEXT RETRIEVAL SCAN(idx_fts)` 与 `VECTOR INDEX SCAN(idx_vec)` 双索引证据。

自检与指标：

```sh
node scripts/test-hybrid.mjs                              # 混合检索 + EXPLAIN
node scripts/compute-metrics.mjs scripts/eval-ablation.json  # 混合 vs 仅向量 vs 仅全文
```

## 说明

- 模型权重(183MB)与 onnxruntime wasm(100MB)刻意不进仓库，`fetch-assets.mjs` 从 hf-mirror 拉取，`node_modules/onnxruntime-web/dist` 复制运行时。
- 前端静态资源目录复用 `spike/public`（见 `app/vite.config.js` 的 `publicDir`），避免重复存放。
- `hybridSearch` 的 `mode` 参数用于消融对比；默认 `hybrid`。
