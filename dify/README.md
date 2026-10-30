# seekdb 面试陪练官 —— Dify × 真实 seekdb 混合检索应用

2026 OceanBase 数据库大赛 · 赛题二「Dify AI Agent（Just For Fun）」参赛交付物。

> 提交位置：仓库 [powercontext](https://github.com/cike112233/powercontext)，分支 **`dify-seekdb-interview-coach`**，作品目录 `dify/`（本目录）。交付形态为代码仓库 + DSL，不依赖任何在线站点。

一句话：**一个跑在本地 Dify 上的技术面试陪练 Chatflow，它的知识库向量、全文索引和检索执行计划都来自真实运行的 seekdb 实例**，评委可以在自己的机器上从零复现，并且能在对话里直接索取 seekdb 的 `EXPLAIN` 算子树作为证据。

## 1. 三件事先说清楚

**① seekdb 是真实调用的，不是伪称。** 两条独立通路都落到同一个 seekdb 容器（`oceanbase/seekdb:latest`，宿主机 `127.0.0.1:2881`，库 `test`）：

- **通路 A —— seekdb 作为 Dify 原生向量库**（`VECTOR_STORE=seekdb`）。Dify 知识库建表时就在 seekdb 里同时创建了 HNSW 向量索引和 ik 全文索引，162 道面试题的向量与全文都由 Dify 自己的索引流程写进这张表；Chatflow 的「知识检索」节点走的是 Dify 原生 hybrid_search SQL。
- **通路 B —— 自研 seekdb 混合检索 HTTP 工具**（`dify/retrieval`，注册为 Dify 自定义工具）。一条 `UNION ALL` 同时打 `MATCH … AGAINST`（ik 倒排）和 `l2_distance … APPROXIMATE`（HNSW），应用层做 RRF 融合，支持 hybrid / vector / fts 三种模式切换和 `EXPLAIN` 返回。

两条通路的真实证据都在 [`evidence/`](evidence/README.md)：建表 DDL、`SHOW INDEX`、执行计划算子树、消融实验表、SSE 节点级追踪（含每个节点耗时与 token 用量）。

**② 评委一分钟能体验到关键差异。** 把开关写在**句子最前面**就能切换检索模式，每轮结尾那行「检索小结」由代码节点从 seekdb 返回值里直接取数，不经模型转述：

| 你输入 | 生效模式 |
| ------ | -------- |
| `讲讲 MVCC 是怎么保证一致性读的` | 混合检索（ik 全文 + HNSW 向量 + RRF） |
| `纯向量：TIME_WAIT 为什么要等 2MSL` | 只走 HNSW 向量 |
| `全文：maxLifetime 和哪个超时参数有关系` | 只走 ik 倒排 |
| `证据：哪些写法会导致索引失效` | 混合 + 把 seekdb 的 EXPLAIN 算子树贴进回答 |

开关词只认句首，所以「向量数据库怎么选型」「全文索引和倒排的关系」这类把词写在句子中间的问法仍走默认混合检索——这条边界有回归表可以直接跑：`python3 dify/scripts/routing-selftest.py`（结果见 `evidence/mode-routing-selftest.txt`，10 条话术 10 PASS）。

**③ 全部凭据用占位值。** 仓库里没有真实 API Key、密码或隧道 URL。DeepSeek Key 由使用者在自己的 Dify 界面（或环境变量 `DEEPSEEK_API_KEY` 一次性传入脚本）填入，不进 git；Dify 管理员账号 `admin@seekdb.local / Seekdb2026Demo` 与 seekdb 口令 `difyai123456` 都是本地自部署的占位默认值。

## 2. 文档与目录

| 路径 | 内容 |
| ---- | ---- |
| [`docs/技术实现说明.md`](docs/技术实现说明.md) | 架构图、两条检索通路的实现细节、DSL 节点设计、模型与凭据纪律、消融结论 |
| [`docs/运行与部署说明.md`](docs/运行与部署说明.md) | 从零复现：Dify + seekdb 容器配置、插件离线安装、知识库导入、工具注册、DSL 导入发布、常见报错 |
| [`docs/知识库构建说明.md`](docs/知识库构建说明.md) | 语料格式规范、分块策略（一道题 = 一个检索块）、混合检索开关、换成别的主题怎么做 |
| [`evidence/README.md`](evidence/README.md) | 调用证据索引，每条证据对应一条可重跑的复现命令 |
| [`dsl/interview-coach.yml`](dsl/interview-coach.yml) | 应用 DSL（导入即用；`dataset_ids` / `provider_id` 由导入脚本按你的工作区自动改写） |
| [`dsl/interview-coach.exported.yml`](dsl/interview-coach.exported.yml) | 从 Dify 服务器导出的规范 DSL，作为「线上就是这个版本」的对照 |
| [`kb/`](kb) | 面试题库语料：11 个领域 / 162 道题，每题带「考察点·参考答案要点·追问·评分标尺·常见误区」 |
| [`retrieval/`](retrieval) | 自研 seekdb 混合检索服务（:3012）+ OpenAPI schema |
| [`embedding/`](embedding) | 本地 OpenAI 兼容 embedding 服务（:8100，bge-small-zh-v1.5，512 维，端侧同款模型） |
| [`scripts/`](scripts) | 控制台 API 自动化：模型配置、知识库导入、混合开关、工具注册、DSL 导入、对话取证、消融实验，外加 `routing-selftest.py`（从 DSL 里抽出模式路由源码跑回归） |
| [`deploy/`](deploy) | `init-setup.sh` 初始化管理员；`start-all.sh` 一键拉起两个本地服务 |
| [`plugins/dist/`](plugins/dist) | 国内环境 marketplace 不可用时用的 `.difypkg` 离线包（DeepSeek、OpenAI-API-compatible） |

## 3. 最快上手路径

```bash
# 0) 前置：Dify 1.18.0 社区版 + seekdb 容器已按 docs/运行与部署说明.md 第 1-2 节配好并启动
bash dify/deploy/start-all.sh           # 拉起 embedding(:8100) 与混合检索工具(:3012)

cd dify/scripts
export DIFY_ADMIN_EMAIL=admin@seekdb.local DIFY_ADMIN_PASSWORD=Seekdb2026Demo
node setup-models.mjs                   # 注册本地 embedding（DeepSeek Key 走环境变量或后台手填）
node import-kb.mjs                      # 162 道题入库，向量真实写入 seekdb
node set-dataset-hybrid.mjs             # 知识库检索方式 -> hybrid_search
node setup-custom-tool.mjs --test       # 注册 seekdb 混合检索自定义工具
node import-dsl.mjs ../dsl/interview-coach.yml --publish
export DIFY_APP_ID=<上一步输出的 app_id>
node make-app-key.mjs                   # 明文 Key 只打印一次，不要提交
```

然后在 Dify 界面打开「seekdb 面试陪练官」，输入：

```
哪些写法会导致索引失效？给我看这轮的检索证据
```

回答里会出现 seekdb 的执行计划算子树，其中 `TEXT RETRIEVAL SCAN …(fulltext_index_for_col_text)` 与 `VECTOR INDEX SCAN …(vector_index)` 就是两条索引都被真实用到的直接证据。

命令行取证（可选）：

```bash
DIFY_APP_KEY=app-xxx node run-app.mjs "InnoDB 的 MVCC 是怎么保证一致性读的？" \
  "我答：RR 下事务一开始就生成 ReadView，之后每条 SELECT 都重新生成。请打分并追问。" --turns 2
node ablation.mjs                        # hybrid/vector/fts 消融实验（1 遍预热 + 3 遍取中位数），重写 evidence/retrieval-ablation.md
```

## 4. 效果与验证结论

- **检索质量（14 条标注查询 × 3 模式，top_k=5，见 `evidence/retrieval-ablation.md`）**：hybrid Top1 命中 12/14、Top5 内 14/14、MRR 0.929；vector 11/14 / 0.857；fts 12/14 / 0.895。混合的价值在于两路互为替补——`TIME_WAIT 为什么要等 2MSL` 纯向量把 Nagle 排在前面（正确素材退到第 2），混合拉回 Top1；`消息队列怎么保证同一条消息不被处理两遍` 纯向量压根没召回，混合排第 2。脚本先跑 1 遍预热、再连测 3 遍，三种模式的逐条命中位次每一遍完全一致（排名不受耗时抖动影响），耗时取 3 遍中位数、同为 10ms 量级（9/9/9ms），也就是混合检索在这台机器上几乎零代价，真正的耗时全在 LLM。
- **端到端稳定性**：5 个取证场景（默认混合 / 纯向量 / 纯全文 / 索取证据 / 两轮判分，合计 6 轮对话）里 42 次节点执行全部 `succeeded`，无重试失败；知识检索节点 Top1 score 在 11.9-47.1 区间（Dify 的 hybrid 分数是全文分与向量分的合并值，不是 0-1 余弦），工具节点 `took_ms` 14-170ms（其中 query embedding 5-6ms），LLM 节点 3.2-6.7s、首 token 0.68-1.63s。
- **导出=运行版**：把 `dsl/interview-coach.exported.yml` 当作一份陌生 YAML 重新导入成全新应用（`import-dsl.mjs` 不带 `--app-id`），不进后台补任何字段，第一次对话 7 节点全 `succeeded`（证据：`evidence/cleanroom-import-run.json`，跑完那个一次性应用已删除）。
- **数字不经模型转述**：结尾那行「检索小结｜seekdb 模式=…｜知识库命中=5 块｜工具命中=4 块｜工具端到端耗时=…ms」由「检索小结」代码节点从 seekdb 返回值里定位拼装、回答节点原样追加；`run-app.mjs` 还会从 SSE 的节点输出独立再算一遍（`summary` 字段）做交叉核对。温度也降到 0.25，`reasoning_format: separated` 保证思考内容不混进正文。
- **检索开关不误触发**：`python3 dify/scripts/routing-selftest.py` 直接从 DSL 里抽出「模式路由」源码跑 10 条话术回归，全部 PASS（含「向量数据库怎么选型」「全文索引和倒排的关系是什么」必须保持混合这两条反例）。
- **多轮记忆**：第 2 轮给出错误答案（把 RC 的行为安在 RR 上、并说"每次 SELECT 重新生成 ReadView"），应用按素材评分标尺判为不及格、逐条指出命中的「常见误区」，并抛出该题素材里的追问。
- **已知边界**：语料只覆盖后端校招/社招常见八股与场景题，超出题库的问题应用会明确回答"这块题库里没有，换个方向"（这是提示词规则 1 的刻意行为，不是幻觉）；本地 embedding 模型为 512 维中文小模型，检索语义能力弱于线上大模型，但换来全程零外网依赖与毫秒级向量化。

## 5. 环境要求

Windows / macOS / Linux 均可，需 Docker Desktop（或 Engine）≥ 24、Node.js ≥ 20、可用内存 ≥ 8GB（seekdb 限 2G，Dify 全家桶约 4G）。国内网络请按 `docs/运行与部署说明.md` 里的镜像与模型下载替代源操作（Docker Hub、marketplace、HuggingFace 直连均不可用，本项目已给出可用路径）。
