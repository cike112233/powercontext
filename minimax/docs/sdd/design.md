# 设计说明

本文件说明流水线的设计取舍。规格本身见 [`requirements.md`](requirements.md)。

## 1. 目标

用最小但完整的机制，满足赛题六项必做验收：

1. 能独立运行
2. MiniMax 实际参与
3. 上下文正确
4. 数据库实际参与
5. 状态恢复可用
6. 代码修改有效

## 2. 关键决策

### 决策一：规格用 Markdown 而不是 JSON/YAML

规格是给人看、也要给机器读的。Markdown 的小节标题天然携带 ID：

```markdown
### SPEC-001 统一阶梯折扣计算
- category: refactor
- target_symbol: billing.legacy_pricing.tiered_discount
- detail: |
  ...
```

解析器（`loaders.parse_specs`）用正则提取 ID 与键值对，`detail` 支持 `|` 块。
好处是：规格可以正常在 PR 里评审、diff 友好，而入库后仍然是结构化行。

### 决策二：代码索引用 AST，不用正则

`loaders.extract_symbols` 用 `ast` 解析出顶层函数与类，
记录 `signature`（`ast.unparse(node.args)`）、`body`（源码片段）与 `checksum`。
`checksum` 让"代码是否被改动过"成为可查询的事实。

### 决策三：模型返回整文件内容，不用 unified diff

**理由**：diff 解析有一整类难以根除的失败——hunk 头畸形、上下文行数不符、
连续 hunk 的行号偏移累积。模型给出的 hunk 一旦有一处偏差，
`git apply` 失败后往往无法给出有效反馈。

**代价**：输出 token 变多（整文件 vs 片段）。实测 `billing/legacy_pricing.py`
约 130 行，输出 1 013 token，完全可接受。

**补偿**：
- 落盘前 `ast.parse` 校验语法，语法错误直接拒绝且不写文件；
- 路径白名单限制只允许改 `billing/`；
- 用 `difflib.unified_diff` 生成标准 diff 存到 `records/changes.diff`，
  评审看到的仍然是熟悉的 diff 形式。

### 决策四：行为快照当闸门，不当事后检查

如果行为一致性只是"最后跑一次测试"，那么模型一旦改坏业务规则，
我们只能拿到一个失败结果。既然要重跑模型，不如把失败变成**输入**：

```
模型产出 → 应用 → 跑行为快照 → 不过则回滚 + 携带失败详情重试
```

开发中这个机制真的拦下过一次：模型把折扣档位改成 15%/10%/5%、
免运费阈值改成 500、运费表改成 `domestic: 10 / international: 30`，
行为快照判定失败 → 回滚 → 重试。

**关键**：闸门的判定必须来自**提交在仓库里的基线文件**，而不是运行时生成，
否则"修改前"就没有锚点。

### 决策五：PowerContext 用进程内 runtime

三个选项对比：

| 方案 | 优点 | 缺点 |
| --- | --- | --- |
| HTTP 服务端 | 与生产一致 | 需要后台进程、端口、鉴权配置，评审环境不一定有 |
| MCP 工具 | 与 Agent 集成一致 | 需要 MCP 客户端栈；`prepare_context` 不在 MCP 工具列表里 |
| **进程内 runtime** | 无需服务；与记忆表同库；代码直连 | 需要 `powercontext[builtin]` 依赖 |

选进程内 runtime。代价是引入了 `powercontext[builtin]` 依赖，
但它正是官方 `competition/requirements.txt` 里锁定的那一套依赖，环境一致。

### 决策六：工程记录表与记忆表同库

如果工程记录放 SQLite、记忆放 seekdb，"关联查询"就得跨库，
在嵌入式数据库里做不了。**同库**让上下文装配变成一条 JOIN，
也让"数据库实际参与"从一句声明变成可执行的 SQL 证据。

### 决策七：数据库路径相对项目根解析

早期版本用相对路径 `./records/sdd_pipeline.db`，结果 CLI 与脚本因为
工作目录不同而连到了**两个不同的数据库文件**，一度出现"库里明明有 23 条
测试结果，上下文里却显示尚未执行测试"的诡异现象。

现在 `load_settings` 会把相对路径解析到项目根目录，
并有 `config.py` 中的注释标记这条规则。

## 3. 上下文包的格式

`records/context.md` 是 Markdown，段落之间用 `## 标题` 分隔，
每段结尾用 `> 来源: <kind>:<ref>` 标注来源：

| kind | 含义 |
| --- | --- |
| `db` | 数据库表，如 `db:project_specs#SPEC-001` |
| `db-join` | 跨表关联查询结果 |
| `file` | 仓库文件 |
| `powercontext` | PowerContext 记忆条目 |

选择 Markdown 而不是 JSON：评审可以直接阅读，同时解析器也能把它切回
`context_entries` 表（`runner._split_blocks`）。

## 4. 降级策略

任何外部依赖不可用时，流水线都**继续运行并明确标注降级**，
而不是直接失败：

| 依赖不可用 | 降级 |
| --- | --- |
| MiniMax Key | `plan`/`patch` 报错，其余阶段照常 |
| PowerContext runtime | 本地 SQLite 记忆镜像，报告里写明 |
| seekdb wheel（Windows） | SQLite 后端 |
| OceanBase 不可达 | 同上 |

降级状态会出现在 `records/report.md` 与验收自检输出中，
评审不会误以为一切都是原生路径跑出来的。

## 5. 已知边界

- `patch` 阶段只支持"整文件内容"与 JSON 文件列表两种输出形态；
  如果模型坚持输出 unified diff，需要先做一次转换（已预留 `extract_json` 的围栏解析）。
- 嵌入式 seekdb 在仅回环地址的主机上可能拒绝启动，
  官方自测脚本通过创建 dummy 网卡解决（`ip link add pcselftest0 type dummy`）。
- 本地开发的 MiniMax 通道依赖 MCode 桌面端登录态，评审环境不可用；
  正式通道必须用环境变量里的 Subscription Key。
