# seekdb 检索消融实验（hybrid / vector / fts）

- 数据：本仓库 `dify/kb` 语料 14 条标注查询 × 3 种检索模式，top_k=5；seekdb 实际表 `vector_index_93bbd4ee_a5f2_48e4_aefc_f5215989f38a_node` 共 162 个检索块（`/health` 返回）
- 通路：`dify/scripts/ablation.mjs` → `dify/retrieval/server.mjs` /search → 真实 seekdb（与 Dify 自定义工具同一条代码路径）
- 判定：每条查询预先标注"正确素材的题面子串"（见脚本 QUERIES），Top1 命中 = 第 1 条结果包含该子串；rank = 首个正确结果的位次

- 做法：先跑 1 遍预热再连跑 3 遍测量；下表取"混合耗时最接近中位数"的那一遍做逐条明细，`平均耗时` 是 3 遍的中位数，每遍数值在后面列全
- 一致性：3 遍里三种模式的逐条命中位次完全相同，说明排名只由检索方式决定，不受耗时抖动影响
- 时间：2026-10-30T02:07:29.944Z

| # | 类型 | 查询 | 期望素材 | hybrid | vector | fts |
| - | ---- | ---- | -------- | ------ | ------ | --- |
| 1 | 术语 | undo 版本链和 ReadView 怎么配合实现 MVCC | 讲讲 MVCC 的实现 | ✅ Top1（9ms） | ✅ Top1（9ms） | ✅ Top1（8ms） |
| 2 | 术语 | 哪些 SQL 写法会导致索引失效 | 哪些写法会导致索引失效 | ✅ Top1（8ms） | ✅ Top1（8ms） | ✅ Top1（11ms） |
| 3 | 参数 | 连接池 maxLifetime 和 wait_timeout 是什么关系 | 连接池有哪些关键参数 | ✅ Top1（9ms） | ✅ Top1（9ms） | ✅ Top1（12ms） |
| 4 | 术语 | redo log、undo log、binlog 为什么要两阶段提交 | 两阶段提交 | ✅ Top1（9ms） | ✅ Top1（9ms） | ✅ Top1（10ms） |
| 5 | 术语 | Buffer Pool、Change Buffer、Doublewrite 各解决什么问题 | Buffer Pool、Change Buffer | ✅ Top1（8ms） | ✅ Top1（11ms） | ✅ Top1（9ms） |
| 6 | 口语 | 给大表加索引怎么不锁生产 | 生产环境给一张两亿行的大表加索引 | ✅ Top1（9ms） | ✅ Top1（11ms） | ✅ Top1（13ms） |
| 7 | 口语 | 分页越翻越慢是怎么回事，怎么改 | limit 1000000 | ✅ Top1（10ms） | ✅ Top1（9ms） | ✅ Top1（9ms） |
| 8 | 口语 | 进程之间有哪几种传数据的方式 | 进程间通信有哪些方式 | ✅ Top1（10ms） | ✅ Top1（10ms） | ✅ Top1（10ms） |
| 9 | 口语 | 消息队列怎么保证同一条消息不被处理两遍 | 不丢、不重、有序 | ⚠️ 第2位（9ms） | ❌ 未命中（8ms） | ⚠️ 第3位（9ms） |
| 10 | 口语 | 缓存挂了会不会把数据库打崩 | 缓存穿透、击穿、雪崩 | ⚠️ 第2位（7ms） | ⚠️ 第2位（9ms） | ⚠️ 第5位（8ms） |
| 11 | 参数 | TIME_WAIT 为什么要等 2MSL | 四次挥手顺序是什么 | ✅ Top1（7ms） | ⚠️ 第2位（7ms） | ✅ Top1（8ms） |
| 12 | 术语 | TCP 为什么是三次握手，两次不行吗 | 三次握手为什么是三次 | ✅ Top1（9ms） | ✅ Top1（7ms） | ✅ Top1（7ms） |
| 13 | 术语 | epoll 比 select 好在哪，LT 和 ET 怎么选 | select、poll、epoll 的区别 | ✅ Top1（8ms） | ✅ Top1（11ms） | ✅ Top1（8ms） |
| 14 | 口语 | Raft 怎么选主，为什么强调多数派 | 讲讲 Raft 的选举和日志复制 | ✅ Top1（8ms） | ✅ Top1（8ms） | ✅ Top1（7ms） |

## 汇总

| 模式 | Top1 命中 | Top5 内命中 | MRR | 平均耗时（3 遍中位数） | 每遍平均耗时 |
| ---- | --------- | ----------- | --- | -------------------- | ------------ |
| hybrid | 12/14 | 14/14 | 0.929 | 9 ms | 9 / 16 / 8 ms |
| vector | 11/14 | 13/14 | 0.857 | 9 ms | 9 / 15 / 8 ms |
| fts | 12/14 | 14/14 | 0.895 | 9 ms | 9 / 17 / 8 ms |

## 怎么读这张表

- 三种模式跑的是同一张 seekdb 表、同一批 162 个检索块，唯一区别是 `hybridSearch` 里开哪条通道：`vector` 只走 HNSW 近邻，`fts` 只走 ik 倒排，`hybrid` 两路各取 recall=20 候选后按 RRF（K=60）融合。所以差异只来自检索方式本身，不是数据差异。

- **单通道都有盲区**：
  - 只走向量做不好的：消息队列怎么保证同一条消息不被处理两遍（未进 Top5）；缓存挂了会不会把数据库打崩（第 2 位）；TIME_WAIT 为什么要等 2MSL（第 2 位） —— 数字、参数名（2MSL 这类）在语义空间里不占优势。
  - 只做全文做不好的：消息队列怎么保证同一条消息不被处理两遍（第 3 位）；缓存挂了会不会把数据库打崩（第 5 位） —— 问法一改写，倒排里就没有对应词了。
  - 混合后仍没进 Top1 的：消息队列怎么保证同一条消息不被处理两遍（第 2 位）；缓存挂了会不会把数据库打崩（第 2 位） —— 属于题库覆盖近似，不是检索通路问题（这些题的正确素材里同时含"死信 / 热 key"这类更宽的并列词，混合会把它们一起抬上来）。

- **混合的价值体现在 MRR**：hybrid 的 Top1 命中数不低于任何单路，而 MRR（0.929）高于 vector（0.857）和 fts（0.895）——两路互为替补，正确素材被任一路召回就能被抬到前面。

- **耗时只作量级参考，不用来分优劣**：预热后三种模式都稳定在 10ms 量级（本机 Windows + Docker Desktop + 单分片 seekdb），相对 LLM 单轮 3-7s 完全不是瓶颈。hybrid 比单路多一次 query embedding 与 UNION 后的应用层融合，但这点差额很容易被机器冷启动（embedding 模型首次加载、seekdb buffer cache）淹没——实测不加预热时第一遍能比后面几遍慢 5-10 倍，所以脚本先跑一遍预热再测 3 遍，即使这样 3 遍之间仍有 1.5-2 倍浮动。这里给中位数并把每遍都列出来，评委在自己的机器上跑出不同绝对值是正常的，排名与 Top1/MRR 才是可复现的部分。

- 单条查询的执行计划可用 `explain=true` 复现，形如 `TEXT RETRIEVAL SCAN …(fulltext_index_for_col_text)` + `VECTOR INDEX SCAN …(vector_index)`，`evidence/run-explain-evidence.json` 里有评委在对话里拿到的原文。
