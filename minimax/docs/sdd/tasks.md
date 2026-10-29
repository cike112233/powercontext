# 任务拆分

流水线自身的实现任务拆分。**注意**：本文件是流水线的开发计划；
赛题要求被修改的业务任务的规格在 [`requirements.md`](requirements.md)。

## T-01 配置层

- [x] `config.py`：环境变量 + `.env` 解析
- [x] 双通道凭据：环境变量优先，MCode 登录态回退
- [x] 数据库路径相对项目根解析
- [x] `.env.example` 占位符，`.gitignore` 排除 `.env`

**验收**：`load_settings()` 在无 `.env` 时不抛异常；相对路径解析到项目根。

## T-02 数据库层

- [x] 五张工程记录表（规格 / 代码符号 / 测试结果 / 任务状态 / 上下文切片）
- [x] DDL 写在 SQLite ∩ MySQL 交集
- [x] 写入语句按方言分派（`INSERT OR REPLACE` / `REPLACE INTO`）
- [x] 通过 PowerContext runtime 的数据库句柄执行 → 与记忆表同库

**验收**：三种后端下 DDL 均可执行；`project_specs` 与 `pc_memory_entry_versions` 可 JOIN。

## T-03 PowerContext 集成

- [x] 进程内 runtime 会话（事件循环 + 生命周期管理）
- [x] Scope 创建与持久化（`records/scope.json`，幂等键固定）
- [x] 记忆写入（规格 / 代码 / 测试结果）
- [x] 记忆检索（混合中英文查询）
- [x] 降级到本地镜像并显式标注

**验收**：重启后 Scope ID 不变；`search_memory` 能召回规格条目。

## T-04 上下文装配

- [x] 规格 / 代码符号 / 测试结果三类来源段落
- [x] JOIN 关联记录段落
- [x] 每段 `> 来源:` 标注
- [x] 写入 `context_entries` 表

**验收**：`grep '^> 来源:' records/context.md` 覆盖四类来源。

## T-05 MiniMax 客户端

- [x] Anthropic Messages 协议（`urllib`，零额外依赖）
- [x] 只取 `type == "text"` 的 content block
- [x] 重试与错误信息
- [x] JSON 解析容错（围栏 / 前后缀噪声）

**验收**：一次真实调用返回可解析文本。

## T-06 变更应用与闸门

- [x] JSON 文件列表 → `ast.parse` 校验 → 路径白名单 → 落盘
- [x] `difflib` 生成统一 diff
- [x] 行为快照闸门：不通过则回滚 + 失败反馈重试（最多 3 轮）

**验收**：故意让模型改坏业务规则时能被拦下并回滚。

## T-07 流水线编排与 CLI

- [x] 六阶段：`init` / `context` / `plan` / `patch` / `verify` / `report`
- [x] 逐事件 JSONL 开发记录
- [x] `python -m sdd_pipeline <command>` 入口

**验收**：`run` 一次产出全部构件。

## T-08 验收自检

- [x] `scripts/verify.py` 六项逐条检查
- [x] `scripts/verify.sh` 一键入口
- [x] `scripts/generate_baseline.py` 基线生成
- [x] `scripts/run_demo.sh` 演示脚本

**验收**：六项全部 PASS。

## T-09 提交材料

- [x] `README.md`（架构、运行说明、配置、验收对照）
- [x] `docs/architecture.md`（一页架构说明）
- [x] `docs/verification.md`（验证样例与预期输出）
- [x] `docs/technical-usage.md`（技术使用记录）
- [x] `samples/`（一次真实运行的产物样本）

**验收**：赛题要求的六类材料全部有对应文件。
