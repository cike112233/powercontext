"""The development pipeline.

Six phases, each of them individually runnable and recorded:

``init``    prepare the database, import the specification, index the code
``context`` rebuild the task context from the database and from memory
``plan``    ask MiniMax for a change plan
``patch``   ask MiniMax for the new file contents and apply them
``verify``  run the test suite and persist the results
``report``  write the run report and the development record

The pipeline is deliberately re-entrant: every phase can be replayed from a
clean checkout, which is what the "runs standalone" acceptance item asks
for.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any

from .config import Settings, load_settings
from .context_builder import ContextBuilder
from .database import Database
from .loaders import collect_project_symbols, parse_specs, utc_now
from .memory import MemoryEntry, build_memory_store
from .minimax_client import MinimaxClient
from .patcher import PatchError, apply_changes, extract_json, normalise_changes
from .powercontext_runtime import open_session

DEFAULT_TASK_ID = "TASK-PRICING-REFACTOR"
DEFAULT_TASK_TITLE = "订单计费模块阶梯折扣与运费逻辑重构（纯重构，行为不变）"

TEST_STATUS = re.compile(
    r"^(?P<name>[^\s]+(?:::[^\s]+)*)\s+(?P<status>PASSED|FAILED|ERROR|SKIPPED)\b",
    re.MULTILINE,
)


@dataclass
class PhaseResult:
    name: str
    ok: bool
    detail: dict[str, Any] = field(default_factory=dict)
    message: str = ""


class Pipeline:
    """Orchestrates the six phases of one development task."""

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or load_settings()
        self.settings.ensure_dirs()
        self.session = open_session(self.settings)
        self.database = Database(self.settings.database, session=self.session)
        self.memory = build_memory_store(self.settings, self.session)
        self.task_id = DEFAULT_TASK_ID
        self.task_title = DEFAULT_TASK_TITLE
        if self.session is not None and self.session.scope_id:
            self.settings = replace(self.settings, scope_id=self.session.scope_id)
            self.memory.scope_id = self.session.scope_id
        self.context_builder = ContextBuilder(self.settings, self.database)

    # ------------------------------------------------------------- helpers
    def _log(self, event: str, **payload: Any) -> None:
        record = {"time": utc_now(), "event": event, **payload}
        with self.settings.devlog_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    def _save_task(self, phase: str, payload: dict[str, Any]) -> None:
        self.database.upsert(
            "task_records",
            {
                "task_id": self.task_id,
                "title": self.task_title,
                "phase": phase,
                "payload": json.dumps(payload, ensure_ascii=False),
                "scope_id": self.settings.scope_id,
                "created_at": utc_now(),
                "updated_at": utc_now(),
            },
        )

    # --------------------------------------------------------------- phase 1
    def init(self) -> PhaseResult:
        """Create the schema, import the specification and index the code."""
        self.database.initialize_schema()
        specs = parse_specs(self.settings.specs_dir / "requirements.md")
        spec_rows = [
            {
                "spec_id": spec.spec_id,
                "title": spec.title,
                "detail": spec.detail,
                "category": spec.category,
                "target_symbol": spec.target_symbol,
                "status": spec.status,
                "created_at": spec.created_at,
                "updated_at": spec.updated_at,
            }
            for spec in specs
        ]
        self.database.execute("DELETE FROM project_specs")
        self.database.upsert_many("project_specs", spec_rows)
        symbols = self.context_builder.refresh_symbol_index()

        self._save_task(
            "init",
            {"specs": len(spec_rows), "symbols": symbols, "backend": self.database.backend_name()},
        )
        self._log("init", specs=len(spec_rows), symbols=symbols)

        # remember the specification in the memory substrate
        entries = [
            MemoryEntry(
                title=f"规格 {spec.spec_id} {spec.title}",
                content=f"{spec.detail}\n目标符号: {spec.target_symbol}",
                category="specification",
                source=f"docs/sdd/requirements.md#{spec.spec_id}",
            )
            for spec in specs
        ]
        entries.extend(
            MemoryEntry(
                title=f"代码符号 {symbol.symbol_id}",
                content=symbol.body,
                category="code",
                source=f"{symbol.file_path}#{symbol.symbol_name}",
            )
            for symbol in collect_project_symbols(self.settings.root)
        )
        written = self.memory.write(entries)

        return PhaseResult(
            name="init",
            ok=bool(spec_rows) and symbols > 0,
            detail={
                "specs": len(spec_rows),
                "symbols": symbols,
                "memory_entries": len(written),
                "memory_transport": self.memory.describe(),
                "backend": self.database.backend_name(),
            },
            message=f"导入 {len(spec_rows)} 条规格，索引 {symbols} 个代码符号",
        )

    # --------------------------------------------------------------- phase 2
    def build_context(self) -> PhaseResult:
        """Rebuild the context pack from the database and from memory."""
        memories = self.memory.search(
            f"{self.task_id} 规格 阶梯折扣 运费 重构", limit=8
        )
        context = self.context_builder.build(
            task_id=self.task_id,
            task_title=self.task_title,
            scope_id=self.settings.scope_id,
            memories=memories,
        )
        path = self.context_builder.write(context)

        self.database.execute("DELETE FROM context_entries")
        rows = []
        for index, block in enumerate(self._split_blocks(context)):
            rows.append(
                {
                    "entry_id": f"{self.task_id}-ctx-{index:03d}",
                    "task_id": self.task_id,
                    "source": block[0],
                    "source_ref": block[1],
                    "content": block[2][:4000],
                    "created_at": utc_now(),
                }
            )
        self.database.upsert_many("context_entries", rows)
        self._save_task("context", {"path": str(path), "entries": len(rows)})
        self._log("context", path=str(path), entries=len(rows), memories=len(memories))
        return PhaseResult(
            name="context",
            ok=path.is_file(),
            detail={"path": str(path), "entries": len(rows), "memories": len(memories)},
            message=f"上下文已生成: {path.name} ({len(rows)} 个片段)",
        )

    @staticmethod
    def _split_blocks(context: str) -> list[tuple[str, str, str]]:
        blocks: list[tuple[str, str, str]] = []
        current_title = ""
        body: list[str] = []
        source_kind = "unknown"
        source_ref = ""
        for line in context.splitlines():
            if line.startswith("## "):
                if current_title:
                    blocks.append((source_kind, source_ref, "\n".join(body)))
                current_title = line[3:].strip()
                body = []
                source_kind, source_ref = "unknown", ""
            elif line.startswith("> 来源: "):
                raw = line[len("> 来源: ") :].strip()
                kind, _, ref = raw.partition(":")
                source_kind, source_ref = kind, ref
            else:
                body.append(line)
        if current_title:
            blocks.append((source_kind, source_ref, "\n".join(body)))
        return blocks

    # --------------------------------------------------------------- phase 3
    def plan(self) -> PhaseResult:
        """Ask MiniMax for the change plan."""
        context = self.settings.context_path.read_text(encoding="utf-8")
        prompt = (
            "你是一名资深 Python 工程师。下面是本次开发任务的完整上下文。\n"
            "请给出精确的修改计划，不要写代码。\n\n"
            "要求：\n"
            "1. 说明你会修改哪些文件、哪些函数；\n"
            "2. 说明如何抽取公共实现；\n"
            "3. 说明如何保证行为完全不变（重构类任务）；\n"
            "4. 列出验收方式。\n\n"
            "上下文：\n"
            f"{context}"
        )
        client = MinimaxClient(self.settings.minimax)
        result = client.chat(prompt, system="你是负责规格驱动开发的资深工程师。")
        self._log("plan", model=result.model, tokens=result.output_tokens,
                  preview=result.text[:500])
        plan_path = self.settings.records_path / "plan.md"
        plan_path.write_text(result.text, encoding="utf-8")
        self._save_task("plan", {"model": result.model, "tokens": result.output_tokens})
        return PhaseResult(
            name="plan",
            ok=bool(result.text.strip()),
            detail={"model": result.model, "tokens": result.output_tokens,
                    "path": str(plan_path)},
            message=f"修改计划已生成 ({result.model})",
        )

    # --------------------------------------------------------------- phase 4
    def patch(self, max_attempts: int = 3) -> PhaseResult:
        """Ask MiniMax for the new file contents, apply them and verify.

        The phase runs as a closed loop: the model proposes a change, the
        behaviour snapshot decides whether the change is acceptable, and a
        rejected change is rolled back and returned to the model together
        with the concrete failure.  That is what turns "a single guess" into
        a verifiable development attempt.
        """
        context = self.settings.context_path.read_text(encoding="utf-8")
        targets = self._target_files()
        originals = self._read_targets(targets)
        feedback = ""
        attempts: list[dict[str, Any]] = []

        for attempt in range(1, max_attempts + 1):
            prompt = self._patch_prompt(context, originals, feedback)
            client = MinimaxClient(self.settings.minimax)
            result = client.chat(prompt, system="你只输出 JSON，不要输出解释。")
            self._log(
                "patch_attempt",
                attempt=attempt,
                model=result.model,
                tokens=result.output_tokens,
                preview=result.text[:300],
            )

            try:
                payload = extract_json(result.text)
                changes = normalise_changes(payload)
            except PatchError as error:
                feedback = f"上一轮回复无法解析为 JSON（{error}）。请严格按格式输出。"
                attempts.append({"attempt": attempt, "ok": False, "reason": str(error)})
                continue

            applied = apply_changes(self.settings.root, changes)
            if not applied.changed_files:
                passed, failure_detail = self._check_behaviour()
                if passed:
                    # The model reproduced the current implementation: the
                    # specification is already satisfied, so there is nothing
                    # to change and nothing to roll back.
                    diff_path = self.settings.records_path / "changes.diff"
                    diff_path.write_text("", encoding="utf-8")
                    self._save_task(
                        "patch",
                        {"changed": [], "attempts": attempts, "model": result.model,
                         "note": "no change required"},
                    )
                    self._log("patch_noop", attempt=attempt)
                    return PhaseResult(
                        name="patch",
                        ok=True,
                        detail={"changed": [], "attempts": attempts,
                                "model": result.model},
                        message="模型输出与当前实现一致，规格已满足，无需修改",
                    )
                reason = "没有产生任何有效修改" + (
                    f"（被拒绝的文件: {applied.rejected}）" if applied.rejected else ""
                )
                feedback = f"上一轮{reason}。请重新输出。"
                attempts.append({"attempt": attempt, "ok": False, "reason": reason})
                continue

            passed, failure_detail = self._check_behaviour()
            attempts.append(
                {
                    "attempt": attempt,
                    "ok": passed,
                    "changed": applied.changed_files,
                    "rejected": applied.rejected,
                    "behaviour_ok": passed,
                }
            )
            if passed:
                diff_path = self.settings.records_path / "changes.diff"
                diff_path.write_text(applied.diff, encoding="utf-8")
                self._save_task(
                    "patch",
                    {"changed": applied.changed_files, "attempts": attempts,
                     "model": result.model},
                )
                self._log("patch_applied", changed=applied.changed_files, attempt=attempt)
                return PhaseResult(
                    name="patch",
                    ok=True,
                    detail={
                        "changed": applied.changed_files,
                        "attempts": attempts,
                        "diff": str(diff_path),
                        "model": result.model,
                    },
                    message=(
                        f"已修改 {len(applied.changed_files)} 个文件: "
                        f"{', '.join(applied.changed_files)}（第 {attempt} 轮通过行为校验）"
                    ),
                )

            # behaviour changed: roll the change back and tell the model why
            self._restore(originals)
            feedback = (
                "上一轮的修改改变了既有行为，验收未通过，已被回滚。\n"
                f"失败详情：\n{failure_detail}\n\n"
                "本任务是**纯重构**：只允许抽取公共实现、调整代码结构，"
                "不得修改任何常量、阈值、费率、返回值的计算方式或舍入位数。"
                "请在保持全部数值完全不变的前提下重新输出。"
            )
            self._log("patch_rejected", attempt=attempt, detail=failure_detail[:500])

        self._restore(originals)
        self._save_task("patch", {"attempts": attempts, "ok": False})
        return PhaseResult(
            name="patch",
            ok=False,
            detail={"attempts": attempts},
            message=f"{max_attempts} 轮修改均未通过行为校验，已回滚",
        )

    # ------------------------------------------------------------- helpers
    def _target_files(self) -> list[str]:
        """Files that the specification points at."""
        rows = self.database.query(
            "SELECT DISTINCT file_path FROM code_symbols WHERE file_path LIKE 'billing/%' "
            "ORDER BY file_path"
        )
        paths = [str(row["file_path"]) for row in rows]
        return paths or ["billing/legacy_pricing.py"]

    def _read_targets(self, paths: list[str]) -> dict[str, str]:
        contents: dict[str, str] = {}
        for relative in paths:
            path = self.settings.root / relative
            if path.is_file():
                contents[relative] = path.read_text(encoding="utf-8")
        return contents

    def _restore(self, originals: dict[str, str]) -> None:
        for relative, content in originals.items():
            path = self.settings.root / relative
            if path.is_file():
                path.write_text(content, encoding="utf-8")

    def _patch_prompt(
        self, context: str, originals: dict[str, str], feedback: str
    ) -> str:
        sections = []
        for relative, content in originals.items():
            sections.append(f"### 文件 `{relative}` 的当前完整内容\n\n```python\n{content}\n```")
        feedback_block = f"\n\n【上一轮的失败反馈】\n{feedback}\n" if feedback else ""
        return (
            "你是一名资深 Python 工程师。请根据任务上下文完成一次**纯重构**。\n\n"
            "## 硬性约束（违反即判定失败）\n"
            "1. 所有常量、阈值、费率、字典取值必须**逐字保持不变**；\n"
            "2. 所有公开函数的返回值必须与修改前完全一致（逐位相同）；\n"
            "3. 不得修改、删除、重命名任何公开名称；\n"
            "4. 只允许做一件事：把重复实现抽取为公共函数，并让各处复用；\n"
            "5. 不得引入任何第三方依赖。\n\n"
            "## 输出格式\n"
            "只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释：\n"
            '{"files": [{"path": "<相对路径>", "content": "<修改后该文件的完整内容>"}]}\n\n'
            "`content` 必须是该文件的**完整新内容**（不是片段、不是 diff），"
            "并且必须保留上面给出的原始常量数值。\n\n"
            "## 当前代码\n\n"
            + "\n\n".join(sections)
            + "\n\n## 任务上下文\n\n"
            + context
            + feedback_block
        )

    def _check_behaviour(self) -> tuple[bool, str]:
        """Run the behaviour snapshot only; this is the acceptance gate."""
        command = [
            sys.executable, "-m", "pytest",
            "tests/test_pricing_behavior.py", "-v", "--tb=short",
            "-p", "no:cacheprovider",
        ]
        completed = subprocess.run(
            command,
            cwd=str(self.settings.root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        output = completed.stdout + completed.stderr
        (self.settings.records_path / "behaviour_check.log").write_text(
            output, encoding="utf-8"
        )
        return completed.returncode == 0, output[-4000:]


    # --------------------------------------------------------------- phase 5
    def verify(self) -> PhaseResult:
        """Run the test suite and persist every result."""
        passed, failed, results = self._run_tests()
        self.database.execute("DELETE FROM test_results")
        rows = []
        for name, status, duration, detail in results:
            rows.append(
                {
                    "result_id": f"{self.task_id}-{uuid.uuid4().hex[:8]}",
                    "task_id": self.task_id,
                    "test_name": name,
                    "status": status,
                    "duration_ms": duration,
                    "detail": detail,
                    "recorded_at": utc_now(),
                }
            )
        self.database.upsert_many("test_results", rows)

        memory_entries = [
            MemoryEntry(
                title=f"测试结果 {name}",
                content=f"状态: {status}\n耗时: {duration} ms\n{detail}",
                category="test-result",
                source=f"task:{self.task_id}",
            )
            for name, status, duration, detail in results
        ]
        self.memory.write(memory_entries)

        self._save_task("verify", {"passed": passed, "failed": failed})
        self._log("verify", passed=passed, failed=failed)
        return PhaseResult(
            name="verify",
            ok=failed == 0 and passed > 0,
            detail={"passed": passed, "failed": failed, "total": len(results)},
            message=f"测试通过 {passed} 项，失败 {failed} 项",
        )

    def _run_tests(self) -> tuple[int, int, list[tuple[str, str, int, str]]]:
        command = [
            sys.executable, "-m", "pytest", "-v", "--tb=line", "-p", "no:cacheprovider",
        ]
        completed = subprocess.run(
            command,
            cwd=str(self.settings.root),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            check=False,
        )
        output = completed.stdout + completed.stderr
        results: list[tuple[str, str, int, str]] = []
        for match in TEST_STATUS.finditer(output):
            results.append(
                (match.group("name"), match.group("status"), 0, "")
            )
        passed = sum(1 for item in results if item[1] == "PASSED")
        failed = sum(1 for item in results if item[1] in {"FAILED", "ERROR"})
        if not results:
            summary = output.strip().splitlines()[-5:]
            results.append(("pytest", "FAILED" if completed.returncode else "PASSED", 0,
                            "\n".join(summary)))
            passed = 0 if completed.returncode else 1
            failed = 1 if completed.returncode else 0
        (self.settings.records_path / "pytest.log").write_text(
            output, encoding="utf-8"
        )
        return passed, failed, results

    # --------------------------------------------------------------- phase 6
    def report(self) -> PhaseResult:
        """Write the human readable run report."""
        specs = self.database.query(
            "SELECT spec_id, title, status FROM project_specs ORDER BY spec_id"
        )
        tests = self.database.query(
            "SELECT test_name, status FROM test_results ORDER BY test_name"
        )
        task = self.database.query(
            "SELECT task_id, phase, updated_at FROM task_records WHERE task_id = ?",
            [self.task_id],
        )
        passed = sum(1 for row in tests if row["status"] == "PASSED")
        failed = sum(1 for row in tests if row["status"] in {"FAILED", "ERROR"})

        lines = [
            f"# 运行报告: {self.task_title}",
            "",
            f"- 任务 ID: `{self.task_id}`",
            f"- 上下文空间: `{self.settings.scope_id}`",
            f"- 数据库后端: {self.database.backend_name()}",
            f"- 记忆载体: {self.memory.describe()}",
            f"- 生成时间: {utc_now()}",
            "",
            "## 规格条目",
            "",
        ]
        for spec in specs:
            lines.append(f"- `{spec['spec_id']}` {spec['title']} - {spec['status']}")
        lines.extend(["", "## 测试结果", "", f"- 通过: {passed}", f"- 失败: {failed}", ""])
        for row in tests:
            lines.append(f"- {row['status']}: `{row['test_name']}`")
        lines.extend(
            [
                "",
                "## 产物",
                "",
                "- 上下文: `records/context.md`",
                "- 修改计划: `records/plan.md`",
                "- 代码差异: `records/changes.diff`",
                "- 测试日志: `records/pytest.log`",
                "- 开发记录: `records/devlog.jsonl`",
                "",
            ]
        )
        path = self.settings.records_path / "report.md"
        path.write_text("\n".join(lines), encoding="utf-8")
        self._log("report", path=str(path))
        return PhaseResult(
            name="report",
            ok=path.is_file(),
            detail={"path": str(path), "passed": passed, "failed": failed},
            message=f"运行报告已生成: {path.name}",
        )

    # ------------------------------------------------------------- full run
    def run_all(self, *, apply_changes_enabled: bool = True) -> list[PhaseResult]:
        results = [self.init(), self.build_context()]
        if apply_changes_enabled:
            results.append(self.plan())
            results.append(self.patch())
            results.append(self.verify())
            # rebuild the context so that it also carries the test results
            # of this run - the pack is what a follow-up session loads
            results.append(self.build_context())
        results.append(self.report())
        return results

    def close(self) -> None:
        self.database.close()
        if self.session is not None:
            self.session.close()


def main(argv: list[str] | None = None) -> int:
    from .cli import main as cli_main

    return cli_main(argv)


if __name__ == "__main__":
    raise SystemExit(main())
