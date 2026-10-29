# 一页架构说明

> MiniMax × OceanBase 赛题 · 规格驱动开发上下文流水线

## 一句话

把「让 Agent 完成一次真实开发任务」做成一条可复现流水线：
**规格、代码索引、测试结果、任务状态全部落在一个 OceanBase 衍生数据库里，
历史上下文由 PowerContext 记忆承载，代码修改由 MiniMax 执行，
每一次修改都必须通过行为快照闸门。**

## 四个存储/服务边界

| 边界 | 组件 | 职责 |
| --- | --- | --- |
| **事实来源** | 数据库 `project_specs` / `code_symbols` / `test_results` / `task_records` / `context_entries` | 规格、代码索引、测试结果、任务状态、上下文切片 |
| **长期记忆** | PowerContext 记忆表 `pc_memory_entry_versions` | 跨会话、跨 Agent 的历史上下文；显式 Scope 隔离 |
| **推理与修改** | MiniMax API（Anthropic 兼容协议） | 产出修改计划与新文件内容 |
| **验收闸门** | `tests/pricing_baseline.json` + pytest | 证明「修改前后行为未变」 |

**关键设计：事实来源与长期记忆在同一个数据库引擎内。**
seekdb / OceanBase / SQLite 三种后端下，工程记录表与 PowerContext 记忆表同库，
因此任务上下文可以用**一条 JOIN 查询**装配，而不是两套互不相干的读取。

## 数据流

```
docs/sdd/requirements.md ──parse──► project_specs 表
billing/*.py          ──ast───►  code_symbols 表
                                          │
                        ┌─────────────────┴─────────────────┐
                        │  context 阶段                      │
                        │  · DB 查询取规格 / 代码 / 测试结果   │
                        │  · JOIN 关联记忆表                   │
                        │  · PowerContext 检索历史记忆         │
                        └─────────────────┬─────────────────┘
                                          ▼
                              records/context.md
                        （每段带 `> 来源:` 标注，可逐段回溯）
                                          │
                                          ▼
                    ┌─────────────────────┴─────────────────────┐
                    │  plan 阶段    MiniMax → 修改计划           │
                    │  patch 阶段   MiniMax → 新文件内容          │
                    │               ↓ ast.parse 校验 + 路径白名单 │
                    │               ↓ 应用 → 行为快照闸门         │
                    │               ↓ 不过 → 回滚 + 失败反馈重试  │
                    └─────────────────────┬─────────────────────┘
                                          ▼
                    verify 阶段  pytest → 结果写回 test_results 表
                                          + 写入 PowerContext 记忆
                                          ▼
                              report 阶段 → records/report.md
```

## 三个关键机制

### 1. Scope 显式绑定

上下文空间 ID 由流水线创建并持久化在 `records/scope.json`，
所有记忆读写都带这个 ID。不会退化到 PowerContext 的 Default Scope，
因此不同项目/任务的记忆不会互相污染——这是「上下文正确」的前提。

### 2. 行为快照闸门

`tests/pricing_baseline.json` 是**重构前**所有可观测输出的快照（13 金额 × 4 区域 + 6 组发票 = 82 组数值）。
模型每次产出改动后先跑快照比对：
不通过就回滚，把失败详情作为反馈交回模型，最多重试 3 轮。
「行为未变」因此是**被证明的事实**，不是文档里的一句声明。

### 3. 来源可追溯

`records/context.md` 每一段结尾标注来源：

```
> 来源: db:project_specs#SPEC-001
> 来源: db:code_symbols#billing.legacy_pricing.tiered_discount
> 来源: db:test_results
> 来源: db-join:project_specs#SPEC-001 x pc_memory_entry_versions@scp_...
> 来源: file:docs/sdd/requirements.md
```

评审可逐段核对「这条信息从哪来」，满足赛题「便于评审核对」的要求。

## 后端选择

| `SDD_DB_KIND` | 引擎 | 说明 |
| --- | --- | --- |
| `seekdb` | 嵌入式 seekdb（OceanBase 衍生向量库） | **评测环境默认**；wheel 为 manylinux x86_64 + cp312 |
| `oceanbase` | 真实 OceanBase 租户（MySQL 协议） | 生产/集群场景 |
| `sqlite` | SQLite 文件 | Windows 本地开发降级路径 |

三种后端共用同一套 DDL（SQLite ∩ MySQL 方言），代码零分支。

## 可移植性

- 流水线**不依赖**后台服务：PowerContext 以进程内 runtime 方式打开，
  不需要端口、不需要插件、不需要 MCP 握手。
- 数据库路径相对**项目根目录**解析，不随调用进程的工作目录漂移。
- 凭据只从环境变量 / `.env` 读取，`.env` 被 git 忽略，仓库内只有占位符。
