# 技术使用记录

本文件按赛题要求，记录 MiniMax、PowerContext、数据库三者的**实际使用方式**，
包括协议、模型、调用次数、token 消耗、数据表与 SQL。

---

## 一、MiniMax

### 接入方式

使用 **HTTP API**，走 Anthropic 兼容协议（赛题允许 SDK / HTTP API / MCP 任选其一，
本项目选 HTTP API，因为它的鉴权与端点最稳定，且无需在评审环境安装额外 SDK）。

| 项 | 值 |
| --- | --- |
| 端点 | `POST https://api.minimaxi.com/anthropic/v1/messages` |
| 鉴权 | `Authorization: Bearer <Subscription Key>`（同时兼容 `x-api-key`） |
| 模型 | `MiniMax-M3`（另验证 `MiniMax-M3.1-Flash` / `M2.7` / `M2.7-highspeed` 可用） |
| 协议 | Anthropic Messages（`model` / `max_tokens` / `messages` / `system`） |
| 区域 | 中国大陆账号 → `api.minimaxi.com`；国际账号 → `api.minimax.io` |

代码位置：`src/sdd_pipeline/minimax_client.py`，不依赖 `anthropic` SDK，
用标准库 `urllib` 实现，评审环境零额外依赖。

### 为什么选 Anthropic 协议而非 OpenAI 兼容协议

Anthropic 协议把推理过程与正文放在**不同的 content block**：

```
blocks: ['thinking', 'text']
```

解析时只需取 `type == "text"` 的块。
OpenAI 兼容端点则把 `<think>...</think>` **内联进** `content`，
需要额外剥离。代码路径因此更短、更不易出错。

### 实际调用情况（一次完整 `run`）

| 阶段 | 调用次数 | 模型 | 输出 token | 用途 |
| --- | ---: | --- | ---: | --- |
| `plan` | 1 | MiniMax-M3 | ~1 463 | 生成修改计划（改哪些文件/符号、如何抽取公共实现、如何保证行为不变） |
| `patch` | 1~3 | MiniMax-M3 | ~1 013 / 次 | 产出修改后文件的完整内容（JSON） |
| 合计 | 2（典型） | — | ~2 500 | — |

`patch` 阶段在模型产出不满足验收时会重试，最多 3 轮，每轮的请求与响应摘要都写入
`records/devlog.jsonl`。

### 提示词要点

`patch` 阶段的提示词包含四道硬约束，直接对应"行为必须不变"这一验收项：

1. 所有常量、阈值、费率**逐字保持不变**；
2. 所有公开函数返回值**逐位相同**；
3. 不得修改/删除/重命名任何公开名称；
4. 只允许抽取公共实现，不得引入第三方依赖。

并附上**目标文件的当前完整内容**，让模型在原稿上编辑而不是凭理解重写。
开发过程中这一点很关键：在没有原文约束时，模型曾把折扣档位从 5%/3%/1%
改成 15%/10%/5%，被行为快照闸门拦下并回滚；加上原文与硬约束后一次通过。

### 凭据处理

- 凭据只从 `MINIMAX_API_KEY` 环境变量或 `.env` 读取；
- `.env` 已在 `.gitignore` 中，仓库内只有 `.env.example`（占位符 `sk-cp-xxxxxxxx`）；
- `devlog.jsonl` 只记录响应摘要的前 300 字符，不记录任何凭据；
- 不使用 MiniMax Code 桌面端登录态作为唯一凭证来源（那是 `mmoat_` 开头的
  OAuth token，绑定客户端登录态，评审环境不可用）。流水线保留它作为**本地开发回退**，
  但正式通道永远是环境变量里的 Subscription Key。

---

## 二、PowerContext

### 接入方式

使用 **PowerContext 的进程内 runtime 层**（`powercontext.builtin.runtime`），
而不是 HTTP 服务端或 MCP。理由：

- 不需要后台服务、端口、插件或 MCP 握手 → 满足"能独立运行"；
- 进程内 runtime 与服务端是同一套代码，行为一致；
- runtime 直接持有数据库句柄，可以让工程记录表与记忆表落在**同一个引擎**里。

```python
from powercontext.builtin.runtime import (
    BuiltinConfig, open_builtin_runtime, RememberMemoryRequest, SearchMemoryRequest,
)
from powercontext.builtin.artifacts.memory.models import MemoryEntryInput
from powercontext.builtin.persistence.seekdb import SeekDBConfig

async with open_builtin_runtime(BuiltinConfig(database=SeekDBConfig(path=...))) as runtime:
    scope = await runtime.scopes.create(ScopeDraft(title=..., summary=..., idempotency_key=...))
    await runtime.memory.for_scope(scope.scope_id).remember(
        RememberMemoryRequest(entries=(MemoryEntryInput(kind="specification", text=...),))
    )
    page = await runtime.memory.for_scope(scope.scope_id).search(
        SearchMemoryRequest(query="阶梯折扣", limit=8)
    )
```

代码位置：`src/sdd_pipeline/powercontext_runtime.py`、`src/sdd_pipeline/memory.py`。

### Scope 绑定

- Scope ID 由流水线创建，形如 `scp_2a4axtmbn4vb9gx7m5ycb5rjnr`（`scp_` + 26 位 Crockford base32）；
- 创建使用固定的 `idempotency_key`（`sdd-pipeline-<scope_key>`），重复运行不会产生重复 Scope；
- 创建后持久化到 `records/scope.json`，**重启后复用同一个 Scope**，
  保证"重启恢复后能读回"以及"新会话用最新内容"；
- 所有记忆读写都显式传入 `scope_id`，不会落到 Default Scope，避免跨项目记忆串味。

### 记忆写入与检索

| 时机 | 写入内容 | kind |
| --- | --- | --- |
| `init` | 规格条目全文 | `specification` |
| `init` | 代码符号源码 | `code` |
| `verify` | 每条测试结果（名称/状态/耗时） | `test-result` |

检索在 `context` 阶段执行：`SearchMemoryRequest(query=..., limit=8)`，
命中内容作为"历史上下文"段落进入 `records/context.md`。

> 记忆正文前会加一行 ASCII 关键字前缀（如 `[docs/sdd/requirements.md#SPEC-001]`）。
> 嵌入式引擎的全文检索按空白分词，纯中文正文不容易被混合查询召回，
> 加前缀后中英文混合查询都能稳定命中。

### 状态写入与使用记录

- `records/scope.json`：Scope 身份，跨重启保持；
- `records/devlog.jsonl`：逐事件 JSONL，含 `init` / `context` / `plan` /
  `patch_attempt` / `patch_applied` / `patch_rejected` / `verify` / `report`；
- `records/report.md`：人读版运行报告，标注数据库后端、Scope、记忆载体、测试统计。

### 降级策略

若 PowerContext runtime 无法打开（例如缺少依赖），流水线降级为本地 SQLite 镜像
（`records/memory_mirror.db`），并在 `records/report.md` 与验收自检输出中
**显式标注降级**，绝不静默。

---

## 三、数据库（seekdb / OceanBase）

### 选型

| 后端 | 场景 | 连接方式 |
| --- | --- | --- |
| `seekdb` | **评测环境默认**，嵌入式、免运维 | `pylibseekdb` wheel（manylinux x86_64 + cp312），PowerContext 通过 `SeekDBConfig(path=...)` 打开 |
| `oceanbase` | 真实 OceanBase 租户 | MySQL 协议，PowerContext 通过 `OceanBaseConfig(url="mysql+aoceanbase://...")` 打开 |
| `sqlite` | Windows 本地开发降级 | `sqlite+aiosqlite:///<绝对路径>` |

### 关键点：工程记录表与记忆表同库

PowerContext 的记忆表（`pc_memory_entry_versions` 等）与本项目自建的工程记录表
**位于同一个数据库引擎**。因此上下文装配可以用一条 JOIN 完成：

```sql
SELECT s.spec_id, s.category, m.kind, m.text
FROM project_specs s, pc_memory_entry_versions m
WHERE m.scope_id = ?
ORDER BY s.spec_id, m.created_in_revision
```

实测返回按 `spec_id × kind` 分组的命中行（本地 SQLite 后端为 52 行），
这条查询的输出直接构成 `records/context.md` 中的"关联记录"段落。

### 本项目自建的表

| 表 | 用途 | 关键列 |
| --- | --- | --- |
| `project_specs` | 规格条目 | `spec_id`(PK), `title`, `detail`, `category`, `target_symbol`, `status` |
| `code_symbols` | 代码符号索引 | `symbol_id`(PK), `file_path`, `symbol_name`, `kind`, `signature`, `body`, `checksum` |
| `test_results` | 测试结果 | `result_id`(PK), `task_id`, `test_name`, `status`, `duration_ms` |
| `task_records` | 任务状态 | `task_id`(PK), `title`, `phase`, `payload`, `scope_id` |
| `context_entries` | 上下文切片 | `entry_id`(PK), `task_id`, `source`, `source_ref`, `content` |

DDL 写在 SQLite ∩ MySQL 的交集上：主键用 `VARCHAR`（SQLite 接受，MySQL 必需）、
不自增（标识符在 Python 侧生成）、时间戳用 ISO-8601 字符串、布尔用 `INTEGER`。
写入语句按方言分派：SQLite 用 `INSERT OR REPLACE`，MySQL 系用 `REPLACE INTO`。
这样同一份代码在三种引擎上零分支。

### 关联查询结果如何进入任务上下文

`context` 阶段：

1. 查 `project_specs` → 规格段落；
2. 查 `code_symbols` → 待改代码段落（带源码）；
3. 查 `test_results` → 测试现状段落；
4. JOIN `pc_memory_entry_versions` → 关联记录段落；
5. PowerContext 检索 → 历史上下文段落。

每段都带 `> 来源:` 标注，评审可逐段回溯。

---

## 四、测试与验收

- **行为基线**：`tests/pricing_baseline.json`，由 `scripts/generate_baseline.py`
  在**重构前**生成并提交。覆盖 13 个金额 × 4 个区域共 52 组折扣/运费结果，
  外加 6 组发票 × 4 个区域共 24 项输出。
- **行为一致性测试**：`tests/test_pricing_behavior.py` 重算并逐项比对。
- **旧口吻功能测试**：`tests/test_pricing.py`，23 条用例覆盖档位边界、
  免运费门槛、区域附加费、未知区域回退。
- **闸门**：`patch` 阶段应用模型产出后立即跑行为快照；不通过则回滚并把
  失败详情作为反馈交回模型重试。

实测记录（`records/devlog.jsonl`）保留了一次被闸门拦下的失败：
模型把折扣档位改为 15%/10%/5%、免运费阈值改为 500、运费表改为
`domestic: 10 / international: 30` —— 行为快照判定失败并回滚。
这条记录是"代码修改有效"这一验收项最直接的证据。

---

## 五、复现所需的外部依赖

| 依赖 | 用途 | 是否必需 |
| --- | --- | --- |
| MiniMax Subscription Key | 模型调用 | `plan` / `patch` 必需 |
| `powercontext[builtin]` | 进程内 runtime | 必需（缺失则降级） |
| `pylibseekdb` | 嵌入式 seekdb | Linux/macOS 必需，Windows 降级 SQLite |
| `pymysql` | OceanBase 租户 | 仅 `SDD_DB_KIND=oceanbase` 时需要 |
| `httpx` | PowerContext HTTP 客户端 | 仅使用 HTTP 服务端模式时需要 |

安装：`python -m pip install -r requirements.txt`
