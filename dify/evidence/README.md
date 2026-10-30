# 调用证据索引

这里的每个文件都能用一条命令重跑出来。所有证据都指向同一个真实运行的 seekdb（容器 `seekdb`，`oceanbase/seekdb:latest`，宿主机 `127.0.0.1:2881`，库 `test`，表 `vector_index_93bbd4ee_a5f2_48e4_aefc_f5215989f38a_node`）。

## A. seekdb 侧：索引真的建在 seekdb 里

| 文件 | 证明什么 | 复现命令 |
| ---- | -------- | -------- |
| [`seekdb-table-ddl.txt`](seekdb-table-ddl.txt) | Dify 知识库建表产生的真实 DDL：`VECTOR(512)` + `VECTOR KEY vector_index …TYPE=HNSW` + `FULLTEXT KEY fulltext_index_for_col_text … WITH PARSER ik` + metadata 函数索引 | `docker exec seekdb sh -c "mysql -h127.0.0.1 -P2881 -uroot -pdifyai123456 -Dtest -e 'SHOW CREATE TABLE vector_index_<dataset_id>_node\\G'"` |
| [`seekdb-native-proof.txt`](seekdb-native-proof.txt) | 库里只有这一张向量表、162 行；`SHOW INDEX` 同时列出 `VECTOR` 与 `FULLTEXT` 两种 Index_type；只用全文条件也能召回正确题目（`MATCH(text) AGAINST('ReadView')` Top1 = MVCC 那道题，fts_score 7.431） | 同文件内每条命令已原样抄录，可直接粘贴执行 |

## B. 检索侧：两条索引都被真实用到

| 文件 | 证明什么 | 复现命令 |
| ---- | -------- | -------- |
| [`seekdb-search-raw.json`](seekdb-search-raw.json) | 自研工具一次完整请求的入参与出参：`sql`（UNION ALL 双通道原文）、`explain`（算子树）、每条命中的 `channels`（在两路各自的名次）、`fts_score`、`vec_distance`、`rrf`。示例：Top1 `fts:1,vec:3 / fts=20.64 / vec_distance=0.851` | `curl -s -X POST http://127.0.0.1:3012/search -H 'Content-Type: application/json' -d '{"query":"讲讲 MVCC 的实现，ReadView 怎么配合","mode":"hybrid","top_k":3,"explain":"true","show_sql":"true"}'` |
| [`retrieval-ablation.md`](retrieval-ablation.md) / [`.json`](retrieval-ablation.json) | 14 条标注查询 × hybrid/vector/fts 消融：hybrid Top1 12/14、Top5 内 14/14、MRR 0.929；vector 11/14、0.857；fts 12/14、0.895。逐条给出位次、耗时与命中标题；脚本先跑 1 遍预热再连测 3 遍，命中质量各遍完全一致，耗时列给中位数并把每遍数值都列出来 | `cd dify/scripts && node ablation.mjs`（遍数可用 `ABLATION_ROUNDS=5` 调） |

## C. 应用侧：一次对话里节点是怎么跑的

每个 `run-*.json` 都是应用**自己的 Service API**（`POST /v1/chat-messages`，streaming）拉回来的 SSE 全量追踪：7 个节点的 `status / elapsed_time / inputs / outputs / error`、LLM 的 `model_name + usage`、`workflow_run_id`、完整回答文本，以及脚本汇总的 `summary`（两路命中数、Top1 score、`took_ms`、是否含执行计划）。

| 文件 | 演示点 | 关键数据 |
| ---- | ------ | -------- |
| [`run-hybrid-demo.json`](run-hybrid-demo.json) | 默认混合模式：以知识库通道为主出题 | 7 节点全 `succeeded`；知识库 5 条命中（Top1 score 15.253，命中文件分布在 11/06/01）；工具 4 条 / `took_ms=170`（`embed_ms=5`，两路名次如 `fts:2,vec:5`）；LLM `deepseek-flash` 3.18s，prompt 4244 / completion 336 token，首 token 0.68s |
| [`run-mode-vector.json`](run-mode-vector.json) | 句首 `纯向量：` → 只走 HNSW | 工具 `mode=vector, took_ms=55`，命中 `channels` 全是 `vec:n`（确实没打全文路）；回答末尾自动追加的那行小结里模式写作「纯向量(HNSW)」，由代码节点生成，不是模型措辞 |
| [`run-mode-fts.json`](run-mode-fts.json) | 句首 `全文：` → 只走 ik 倒排 | 工具 `mode=fts, took_ms=28`（三种模式里最快，省掉 ANN 扫描），命中 `channels` 全是 `fts:n`（该模式下确实没走向量路，`vec_distance` 恒为 0），ik 把 `maxLifetime / wait_timeout` 这类参数名直接撞中，知识库 Top1 score 21.557 |
| [`run-explain-evidence.json`](run-explain-evidence.json) | 句首 `证据：` → 把 seekdb 的 EXPLAIN 算子树贴进回答 | `mode=hybrid / explain=true`，「证据：」被从检索句子里剥掉（`clean_query=哪些写法会导致索引失效？`）；回答含 `TEXT RETRIEVAL SCAN …(fulltext_index_for_col_text)` 与 `VECTOR INDEX SCAN …(vector_index)` 并各自解释；`took_ms=22`，LLM 6.29s |
| [`run-two-turns.json`](run-two-turns.json) | 多轮：第 2 轮给出**错误答案**，应用按素材评分标尺判分并追问 | 两轮各 7 节点全 `succeeded`；第 2 轮判为「不及格」，逐条对照标尺（RR 下 ReadView 被答成"每条 SELECT 重新生成"= RC 行为、"能看到别的事务最新提交"恰好说反），并给出素材里的补救链路与追问；第 2 轮知识库 Top1 换成 MVCC 那道题（score 47.141 vs 第 1 轮 11.928）；prompt 5154 / completion 1017 token，首 token 0.75s，思考内容没有漏进正文（`reasoning_format: separated`） |
| [`mode-routing-selftest.txt`](mode-routing-selftest.txt) | 检索开关不误触发的回归表 | 直接从 DSL 里抽出「模式路由」节点源码执行，10 条话术 10 PASS：句首开关生效、`向量数据库怎么选型` / `全文索引和倒排的关系是什么` 保持混合、`证据：` 前缀被剥离 |
| [`cleanroom-import-run.json`](cleanroom-import-run.json) | **导出=运行版**：把 `dsl/interview-coach.exported.yml` 当陌生 YAML 导入成一个全新应用后直接跑 | 新应用 `71cbc537…`（导入返回 `status=completed / error=""`），未做任何手工改动，7 节点全 `succeeded`；知识库 5 块（Top1 score 11.928）、工具 4 块（`mode=hybrid, took_ms=303, embed_ms=8`）、小结行由代码节点生成。校验完这个一次性应用已删除，正式应用 `a7e416be…` 不受影响 |

复现（把 `<app_key>` 换成你本机 `make-app-key.mjs` 生成的 Key）：

```bash
cd dify/scripts
DIFY_APP_KEY=<app_key> node run-app.mjs "帮我从数据库方向开始模拟一面，先问一道中级题" --out ../evidence/run-hybrid-demo.json
DIFY_APP_KEY=<app_key> node run-app.mjs "证据：哪些写法会导致索引失效？" --out ../evidence/run-explain-evidence.json
DIFY_APP_KEY=<app_key> node run-app.mjs "纯向量：TIME_WAIT 为什么要等 2MSL" --out ../evidence/run-mode-vector.json
DIFY_APP_KEY=<app_key> node run-app.mjs "全文：连接池 maxLifetime 和哪个服务端参数有关系" --out ../evidence/run-mode-fts.json
DIFY_APP_KEY=<app_key> node run-app.mjs "InnoDB 的 MVCC 是怎么保证一致性读的？" "我答：RR 下事务一开始生成 ReadView，之后每条 SELECT 都重新生成一个，所以能看到别的事务最新提交的修改。请打分并追问。" --turns 2 --out ../evidence/run-two-turns.json
python3 routing-selftest.py --save
```

洁净室复现（证明导出的 DSL 本身就是运行版；`import-dsl.mjs` 不带 `--app-id` 时会新建一个应用，跑完可以在后台把它删掉）：

```bash
cd dify/scripts
node import-dsl.mjs ../dsl/interview-coach.exported.yml      # 记下返回的新 app_id
DIFY_APP_ID=<新app_id> node make-app-key.mjs
DIFY_APP_KEY=<新app_key> node run-app.mjs "InnoDB 的 MVCC 是怎么保证一致性读的？" --out ../evidence/cleanroom-import-run.json
```

## D. 怎么快速核验"这不是假数据"

1. **看 DDL 与索引**：A 组两个文件里的表名带的是知识库 `dataset_id`，索引名 `vector_index` / `fulltext_index_for_col_text` 是 Dify 的 OceanBase provider 固定命名，不是手写脚本能凑出来的样子。
2. **看执行计划**：`run-explain-evidence.json` 的算子树是评委自己在对话框里打「证据：哪些写法会导致索引失效？」就能拿到的，不是截图；`EST.ROWS` 两路分别 155（全文）/ 508（向量），是 seekdb 优化器自己的估算值。
3. **看分数是否自洽**：`seekdb-search-raw.json` 里同一素材的 `fts_score` 与 `vec_distance` 同时非零且名次不同（`fts:1,vec:3`），只有两条 SQL 都真的跑过才会出现。
4. **看命中数与回答是否一致**：回答末尾那行「检索小结｜…」是 DSL 里「检索小结（确定性）」代码节点从 seekdb 返回值拼出来的（模型不参与写数字）；取证脚本 `run-app.mjs` 又会从 SSE 的节点输出**独立**再算一遍写进 `summary`。两份数字对得上（例如 `run-hybrid-demo.json`：知识库 5 块 / 工具 4 块 / `took_ms=170`），就说明回答里的量化结论不是模型编的。
5. **看开关会不会误触发**：`mode-routing-selftest.txt` 是对 DSL 里那段路由源码直接跑的话术回归，`向量数据库怎么选型`、`全文索引和倒排的关系是什么` 必须仍是混合检索。
6. **自己重跑一遍**：C 组任意一条命令跑完，`workflow_run_id` 可以在 Dify 后台「日志」里找到同一次运行，节点耗时逐一对得上。
7. **看仓库里的 DSL 是不是运行版**：`cleanroom-import-run.json` 不是从正式应用跑出来的，而是把 `dsl/interview-coach.exported.yml` 当一份陌生 YAML 重新导入成**新应用**后的第一跑——没有进后台补任何字段，7 个节点直接 `succeeded`。评委 clone 仓库后照同一段命令做一次，就能自己复核这条。

## E. 数据脱敏说明

证据文件里保留了 `dataset_id`、`document_id`、`workflow_run_id`、表名与耗时（这些是复现所必需，且均为本地自部署生成的随机 UUID）。**不含**任何真实密钥：应用 API Key 只在 `make-app-key.mjs` 输出一次且不入库；DeepSeek Key 不出现在任何文件或日志中；Dify 管理员账号与 seekdb 口令都是 `dify/deploy/init-setup.sh` / `seekdb.env` 里的本地占位默认值。
