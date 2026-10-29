# MiniMax × OceanBase：规格驱动开发上下文流水线

> 赛题：MiniMax × OceanBase（`minimax/` 赛题，20 分，六项必做全过才得分）
>
> 一句话：把"让 Agent 完成一次真实开发任务"做成一条**可复现、可验收、可跨会话恢复**的流水线——
> 规格来自数据库，代码索引来自数据库，测试结果写回数据库，
> 历史上下文由 PowerContext 记忆承载，代码修改由 MiniMax 执行。

---

## 1. 它解决什么问题

AI 代理写代码时，规格、代码现状、测试基线这三样东西通常散落在聊天记录里：

- 换个会话，规格就丢了；
- 改完代码，没人能证明**行为没变**；
- 任务状态随进程一起消失。

本项目把这三件事变成数据库里的一等公民：

| 产物 | 存放位置 | 作用 |
| --- | --- | --- |
| 规格条目 | `project_specs` 表 | 任务要求的唯一事实来源 |
| 代码符号索引 | `code_symbols` 表 | 按符号检索待改代码，而非整仓塞给模型 |
| 测试结果 | `test_results` 表 | 每轮修改的验收证据 |
| 任务状态 | `task_records` 表 | 跨重启恢复 |
| 上下文片段 | `context_entries` 表 | 上下文包的可追溯切片 |
| **历史上下文** | **PowerContext 记忆表** | **跨会话、跨 Agent 的长期记忆** |

工程记录表与 PowerContext 记忆表**位于同一个数据库引擎**（嵌入式 seekdb / OceanBase / SQLite），
因此任务上下文可以用**一条 JOIN 查询**装配出来，而不是两套互不相干的读取。

## 2. 架构

```
              ┌──────────────────────────────────────────────┐
   规格文档    │  docs/sdd/requirements.md                    │
   (docs/sdd)  └───────────────┬──────────────────────────────┘
                              │ 解析
                              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  sdd_pipeline.init          建表 / 导入规格 / 索引代码符号      │
   ├──────────────────────────────────────────────────────────────┤
   │  sdd_pipeline.context       DB 查询 + PowerContext 记忆检索    │
   │                            → records/context.md（逐段标注来源）│
   ├──────────────────────────────────────────────────────────────┤
   │  sdd_pipeline.plan          MiniMax 生成修改计划               │
   ├──────────────────────────────────────────────────────────────┤
   │  sdd_pipeline.patch         MiniMax 产出新文件内容 → 校验 → 应用│
   │                            → 行为快照不通过则回滚并带着失败原因 │
   │                              反馈给模型重试（最多 3 轮）        │
   ├──────────────────────────────────────────────────────────────┤
   │  sdd_pipeline.verify        pytest 执行 → 结果写回 DB + 记忆    │
   ├──────────────────────────────────────────────────────────────┤
   │  sdd_pipeline.report        records/report.md                 │
   └──────────────────────────────────────────────────────────────┘
        │                    │                     │
        ▼                    ▼                     ▼
   seekdb / OceanBase   PowerContext 记忆       MiniMax API
   （工程记录表）        （历史上下文）          （代码修改）
```

详细说明见 [`docs/architecture.md`](docs/architecture.md)。

## 3. 快速开始

### 3.1 环境要求

- Linux x86_64（评测环境）�� macOS / Windows 亦可，数据库后端自动降级
- Python 3.11+（评测环境为 3.12）
- `uv`（可选，推荐）或 `pip`

### 3.2 安装依赖

```bash
cd minimax
python -m pip install -r requirements.txt
# 或者
uv venv --python 3.12 .venv && uv pip install -r requirements.txt
```

### 3.3 配置

```bash
cp .env.example .env
```

编辑 `.env`，**至少**填写两项：

```ini
# MiniMax Token Plan 的 Subscription Key（占位符，请替换为真实值）
MINIMAX_API_KEY=sk-cp-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic

# 数据库后端：seekdb（默认）/ oceanbase / sqlite
SDD_DB_KIND=seekdb
```

> `.env` 已被 `.gitignore` 忽略，**不要提交**。仓库里只有占位符。
> 凭据的使用位置：本项目仅从环境变量或 `.env` 读取，从不硬编码、从不写入日志。

### 3.4 运行

```bash
# 完整跑一次开发任务（需要 MiniMax Key）
export PYTHONPATH="$PWD/src"
python -m sdd_pipeline run

# 只跑确定性的部分（不需要 Key）
python -m sdd_pipeline init
python -m sdd_pipeline context
python -m sdd_pipeline report
```

### 3.5 验收自检

```bash
./scripts/verify.sh        # 或 bash scripts/verify.sh
```

> 脚本在没有 MiniMax Key 时也能通过第 2 项：它会回退到仓库中已提交的
> 样本证据 `samples/devlog.jsonl` 与 `samples/changes.diff`。

输出逐项对照赛题六项必做要求：

```
[ PASS] 1. 能独立运行：自动初始化并产出全部构件
[ PASS] 2. MiniMax 实际参与：开发记录与代码差异对应
[ PASS] 3. 上下文正确：规格 / 代码 / 测试三类来源齐备且可追溯
[ PASS] 4. 数据库实际参与：工程资料与记忆同库并被关联查询
[ PASS] 5. 状态恢复可用：重启后能读回任务状态与上下文
[ PASS] 6. 代码修改有效：修改前后行为一致且全部测试通过
```

## 4. 目录结构

```
minimax/
├── README.md                  # 本文件
├── requirements.txt           # 运行依赖
├── .env.example               # 配置示例（占位符，不含真实凭据）
├── docs/
│   ├── architecture.md        # 一页架构说明
│   ├── verification.md        # 验证样例与预期输出
│   ├── technical-usage.md     # 技术使用记录（MiniMax / PowerContext / DB）
│   └── sdd/
│       ├── requirements.md    # 规格条目（任务的唯一事实来源）
│       ├── design.md          # 设计说明
│       └── tasks.md           # 任务拆分
├── billing/
│   └── legacy_pricing.py      # 被修改的业务代码（重构目标）
├── tests/
│   ├── test_pricing.py        # 功能与旧口吻用例
│   ├── test_pricing_behavior.py # 行为快照（修改前后一致性证明）
│   └── pricing_baseline.json  # 重构前的行为基线
├── scripts/
│   ├── verify.sh              # 六项验收自检入口
│   ├── verify.py              # 验收自检实现
│   ├── generate_baseline.py   # 重新生成行为基线
│   └── run_demo.sh            # 一键演示
├── src/sdd_pipeline/          # 流水线实现
│   ├── config.py              # 配置与凭据解析
│   ├── database.py            # 工程记录表（多方言 DDL）
│   ├── powercontext_runtime.py# PowerContext 进程内运行时会话
│   ├── memory.py              # 记忆读写适配层
│   ├── loaders.py             # 规格 / 代码符号解析
│   ├── context_builder.py     # 上下文装配（含 JOIN 关联查询）
│   ├── minimax_client.py      # MiniMax 客户端（Anthropic 协议）
│   ├── patcher.py             # 变更校验与应用
│   ├── runner.py              # 六阶段编排
│   └── cli.py                 # 命令行入口
├── samples/                   # 一次真实运行的产物样本（开发记录证据）
└── records/                   # 运行时产物（git 忽略）
```

## 5. 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MINIMAX_API_KEY` | 空 | MiniMax Token Plan 的 Subscription Key |
| `MINIMAX_BASE_URL` | 空 | 中国大陆 `https://api.minimaxi.com/anthropic`；国际 `https://api.minimax.io/anthropic` |
| `MINIMAX_MODEL` | `MiniMax-M3` | 使用的模型 |
| `SDD_DB_KIND` | `seekdb`（非 Windows）/`sqlite` | `seekdb` / `oceanbase` / `sqlite` |
| `SDD_DB_PATH` | `./records/sdd_pipeline` | seekdb 数据目录或 SQLite 文件路径 |
| `SDD_DB_HOST` / `SDD_DB_PORT` / `SDD_DB_USER` / `SDD_DB_PASSWORD` / `SDB_DB_NAME` | `127.0.0.1` / `2881` / `root@` / 空 / `sdd_pipeline` | OceanBase 连接参数 |
| `POWERCONTEXT_SCOPE_ID` | 自动创建 | 上下文空间 ID；缺省时自动创建并持久化到 `records/scope.json` |
| `POWERCONTEXT_URL` | `http://127.0.0.1:8000` | 仅在改用 HTTP 服务端模式时需要 |

## 6. 关键设计说明

### 6.1 为什么上下文包要标注来源

`records/context.md` 的每一段结尾都有 `> 来源: db:project_specs#SPEC-001` 这样的标注。
评审可以逐段回溯到"这条信息来自哪张表、哪个文件、哪条记忆"，
这既是赛题"便于评审核对"的要求，也让"上下文正确"成为可检查的事实而非声明。

### 6.2 为什么修改要过行为快照

赛题要求"同一组测试在修改前后行为未变"。本项目把这句话变成机器可验证的：

1. `tests/pricing_baseline.json` 记录**重构前**所有可观测输出（13 个金额 × 4 个区域 + 6 组发票）；
2. `tests/test_pricing_behavior.py` 在每次修改后重新计算并逐项比对；
3. 流水线在应用模型产出后**先跑行为快照**：不通过就**回滚**，把失败详情反馈给模型重试。

开发过程中模型第一次就把折扣档位从 5%/3%/1% 改成了 15%/10%/5%，
被这个机制拦下并回滚——快照不是装饰，是闸门。

### 6.3 为什么模型返回整文件而不是 diff

让模型输出整份文件内容（`{"files": [{"path": ..., "content": ...}]}`），
可以避免 diff 解析的一整类失败（hunk 头畸形、行号错位、连续 hunk 偏移累积）。
落盘前用 `ast.parse` 校验语法，用 `difflib` 生成统一 diff 供评审比对，
并限制只允许改动 `billing/` 下的文件。

### 6.4 数据库后端为什么选 seekdb

嵌入式 seekdb 是 OceanBase 衍生的向量数据库，PowerContext 原生支持
（`POWERCONTEXT_SERVER_DATABASE_KIND=seekdb`），且与记忆表同库，
一条 JOIN 就能把"规格"和"记忆"关联起来。
它的 wheel 只提供 manylinux x86_64 + Python 3.12，
因此在 Windows 本地开发时自动降级为 SQLite，评测环境仍走 seekdb。

## 7. 提交材料对照

| 赛题要求 | 本仓库位置 |
| --- | --- |
| 完整架构 | [`docs/architecture.md`](docs/architecture.md) |
| 运行说明 | 本文件 §3、[`scripts/run_demo.sh`](scripts/run_demo.sh) |
| 验证样例 | [`docs/verification.md`](docs/verification.md)、[`scripts/verify.sh`](scripts/verify.sh) |
| 代码差异 | `billing/legacy_pricing.py`、`samples/changes.diff` |
| 新增功能测试 | `tests/test_pricing_behavior.py` |
| 相关旧口吻测试 | `tests/test_pricing.py` |
| 技术使用记录 | [`docs/technical-usage.md`](docs/technical-usage.md) |
| 一页架构说明 | [`docs/architecture.md`](docs/architecture.md) |
| MiniMax 开发记录 | [`samples/devlog.jsonl`](samples/devlog.jsonl) |
| PowerContext 状态写入与使用记录 | [`samples/scope.json`](samples/scope.json)、`records/devlog.jsonl` |
| 规格 / 代码 / 测试来源 | `records/context.md`（逐段标注来源）、`docs/sdd/requirements.md` |

## 8. 许可与来源

示例业务代码（`billing/`）、规格文档与全部流水线代码均为本赛题原创。
行为基线由 `scripts/generate_baseline.py` 在重构前生成。
