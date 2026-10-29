# 一次真实运行的产物样本

本目录是流水线**实际运行一次**留下的原始产物，用于离线核对赛题要求
（「MiniMax 开发记录」「PowerContext 状态写入与使用记录」「代码差异」）。
运行产物本身在 `records/`（已被 `.gitignore` 忽略），这里保存一份可提交、可审阅的快照。

| 文件 | 对应赛题要求 | 内容 |
| --- | --- | --- |
| `devlog.jsonl` | MiniMax 开发记录 | 逐事件 JSONL：每个阶段的模型名、token 数、响应摘要、接受/回滚结果 |
| `changes.diff` | 代码差异 | 模型产出导致的实际改动，与仓库中的 `billing/legacy_pricing.py` 逐行对应 |
| `context.md` | 上下文正确 | 任务上下文包，每段带 `> 来源:` 标注 |
| `plan.md` | 修改计划 | MiniMax 生成的修改计划 |
| `report.md` | 运行报告 | 数据库后端、Scope、记忆载体、测试统计 |
| `pytest.log` | 测试执行 | pytest 逐条用例输出 |
| `scope.json` | PowerContext 状态 | 上下文空间 ID，跨重启保持一致 |

## 怎么读 devlog.jsonl

每行一个 JSON 事件，典型字段：

```json
{"time": "2026-10-29T06:19:21+00:00", "event": "plan", "model": "MiniMax-M3", "tokens": 1463, "preview": "## 修改计划 ..."}
{"time": "2026-10-29T06:19:26+00:00", "event": "patch_attempt", "attempt": 1, "model": "MiniMax-M3", "tokens": 1013, "preview": "{\"files\":[{\"path\":\"billing/legacy_pricing.py\"..."}
{"time": "2026-10-29T06:19:26+00:00", "event": "patch_applied", "changed": ["billing/legacy_pricing.py"], "attempt": 1}
{"time": "2026-10-29T06:19:27+00:00", "event": "verify", "passed": 23, "failed": 0}
```

事件类型：`init` / `context` / `plan` / `patch_attempt` / `patch_applied` /
`patch_rejected` / `patch_noop` / `verify` / `report`。

## 一次被闸门拦下的失败

记录中保留了早期的一次失败（事件 `verify` 显示 `passed: 0, failed: 16`）：
模型在缺少"保持常量不变"约束与原文的情况下，把折扣档位从 5%/3%/1%
改成 15%/10%/5%、免运费阈值从 300 改成 500、运费表改成
`domestic: 10 / international: 30`。行为快照闸门判定失败并回滚该改动。

补上硬约束提示词与目标文件原文后，同一模型在第 1 轮即通过。

这条记录是赛题验收项「代码修改有效：同一组测试在修改前后能行为未变，
修改后全部通过」最直接的证据——它证明这套约束是被**执行**的，而不是写在文档里。
