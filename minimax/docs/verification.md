# 验证样例

本文件给出可复制的验证命令、预期输出，以及每条命令对应赛题哪一项验收要求。
一键执行：`./scripts/verify.sh`。

## 0. 环境准备

```bash
cd minimax
python -m pip install -r requirements.txt
cp .env.example .env
# 编辑 .env，至少填写 MINIMAX_API_KEY 与 MINIMAX_BASE_URL
```

## 1. 一键验收自检

```bash
./scripts/verify.sh
```

预期输出（本地实测）：

```
========================================================================
MiniMax x OceanBase - 验收自检
========================================================================
[ PASS] 1. 能独立运行：自动初始化并产出全部构件
         命令 init, context, report 全部成功；产物: context.md, report.md, devlog.jsonl
[ PASS] 2. MiniMax 实际参与：开发记录与代码差异对应
         模型调用 2 次，成功应用 1 个文件：['billing/legacy_pricing.py']；差异记录于 records/changes.diff
[ PASS] 3. 上下文正确：规格 / 代码 / 测试三类来源齐备且可追溯
         context.md 共 613 行，包含 4 类可追溯来源标注
[ PASS] 4. 数据库实际参与：工程资料与记忆同库并被关联查询
         后端 sqlite (records/sdd_pipeline.db)；规格 4 条、代码符号 8 个、
         任务记录 1 条、记忆条目 13 条；关联查询命中 52 行
[ PASS] 5. 状态恢复可用：重启后能读回任务状态与上下文
         重新打开数据库后读回 1 条任务记录（最新阶段 context），
         scope scp_... 跨重启保持一致
[ PASS] 6. 代码修改有效：修改前后行为一致且全部测试通过
         23 passed in 0.03s；行为快照与重构前基线逐项一致
------------------------------------------------------------------------
六项验收全部通过
```

> 第 2 项依赖一次真实的模型运行。需要先执行 `python -m sdd_pipeline run`
> 或使用仓库中已提交的样本记录 `samples/devlog.jsonl` 与 `samples/changes.diff`。

## 2. 逐项手工验证

### 2.1 能独立运行（赛题验收 1）

```bash
export PYTHONPATH="$PWD/src"
python -m sdd_pipeline init
python -m sdd_pipeline context
python -m sdd_pipeline report
ls records/
```

预期：`records/` 下出现 `context.md`、`report.md`、`devlog.jsonl`、`scope.json`。
全过程不依赖任何预先存在的本地文件状态——删掉整个 `records/` 再跑一次即可复现。

### 2.2 MiniMax 实际参与（赛题验收 2）

```bash
python -m sdd_pipeline run          # 需要 MINIMAX_API_KEY
cat records/devlog.jsonl | head -20
cat records/changes.diff
```

`devlog.jsonl` 是逐事件 JSONL，包含每次模型调用的模型名、token 数、响应摘要与接受/回滚结果：

```json
{"time": "...", "event": "patch_attempt", "attempt": 1, "model": "MiniMax-M3", "tokens": 1893, "preview": "{\"files\": [{\"path\": ..."}
{"time": "...", "event": "patch_applied", "changed": ["billing/legacy_pricing.py"], "attempt": 1}
```

`changes.diff` 是模型产出的实际差异，与仓库中的 `billing/legacy_pricing.py` 逐行对应。

### 2.3 上下文正确（赛题验收 3）

```bash
python -m sdd_pipeline show-context | head -60
grep -c '^> 来源:' records/context.md
grep '^> 来源:' records/context.md | sort -u
```

预期来源标注：

```
> 来源: db:project_specs#SPEC-001
> 来源: db:code_symbols#billing.legacy_pricing.tiered_discount
> 来源: db:test_results
> 来源: db-join:project_specs#SPEC-001 x pc_memory_entry_versions@scp_...
> 来源: file:docs/sdd/requirements.md
> 来源: powercontext:mem_ent_...
```

### 2.4 数据库实际参与（赛题验收 4）

```bash
python - <<'PY'
import sys; sys.path.insert(0, "src")
from sdd_pipeline.config import load_settings
from sdd_pipeline.database import Database
from sdd_pipeline.powercontext_runtime import open_session

s = load_settings()
sess = open_session(s)
db = Database(s.database, session=sess)
print("规格:", db.query("SELECT COUNT(*) AS n FROM project_specs"))
print("符号:", db.query("SELECT COUNT(*) AS n FROM code_symbols"))
print("记忆:", sess.execute(
    "SELECT COUNT(*) AS n FROM pc_memory_entry_versions WHERE scope_id = ?",
    (sess.scope_id,)))
print("关联:", sess.execute(
    "SELECT s.spec_id, m.kind, COUNT(*) AS n FROM project_specs s, "
    "pc_memory_entry_versions m WHERE m.scope_id = ? GROUP BY s.spec_id, m.kind",
    (sess.scope_id,)))
sess.close()
PY
```

预期：规格 4 条、代码符号 8 个、记忆条目若干，关联查询返回按 `spec_id × kind`
分组的计数——证明工程资料与记忆同库且可关联。

### 2.5 状态恢复可用（赛题验收 5）

```bash
python -m sdd_pipeline report
cat records/scope.json
python -m sdd_pipeline context   # 新进程重新读取
```

预期：`scope.json` 中的 `scope_id` 与新进程重新创建/加载的 Scope 一致；
`task_records` 中的阶段从 `init` → `context` → `plan` → `patch` → `verify` → `report` 推进，
新进程能读回全部记录。

### 2.6 代码修改有效（赛题验收 6）

```bash
python -m pytest -q
python -m pytest tests/test_pricing_behavior.py -v
```

预期：

```
23 passed
tests/test_pricing_behavior.py::test_behaviour_matches_committed_baseline PASSED
tests/test_pricing_behavior.py::test_snapshot_is_not_empty PASSED
```

行为快照比对的是 `tests/pricing_baseline.json`——**重构前**生成并提交到仓库的基线，
覆盖 13 个金额 × 4 个区域共 52 组折扣/运费结果，以及 6 组发票的 4 项输出。
它与 `tests/test_pricing.py` 里的旧口吻用例一起构成「相关旧口吻也全部通过」的证据。

## 3. 边界与降级

| 场景 | 行为 |
| --- | --- |
| 无 `MINIMAX_API_KEY` | `init` / `context` / `verify` / `report` 仍可运行；`plan` / `patch` 报缺少凭证 |
| Windows（无 seekdb wheel） | 自动使用 SQLite 后端，其余流程不变 |
| PowerContext runtime 不可用 | 降级为本地 SQLite 镜像，`records/report.md` 中显式标注降级 |
| 模型产出语法错误 | `ast.parse` 校验拦截，文件不落盘，记入 `rejected` |
| 模型改变了业务行为 | 行为快照闸门回滚，并把失败详情反馈给模型重试（最多 3 轮） |
