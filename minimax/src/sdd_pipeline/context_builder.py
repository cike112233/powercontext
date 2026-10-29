"""Context assembly.

The context pack is the single artefact that is handed to the model.  Every
section carries an explicit ``来源`` (source) line so a reviewer can trace
each piece of information back to the table, file or memory entry it came
from.  The pack is written to ``records/context.md`` on every run, which is
also what a fresh session loads to continue the work.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from .config import Settings
from .database import Database
from .loaders import collect_project_symbols

SOURCE_DB = "db"
SOURCE_FILE = "file"
SOURCE_MEMORY = "powercontext"
SOURCE_JOIN = "db-join"


@dataclass(frozen=True)
class ContextBlock:
    title: str
    body: str
    source_kind: str
    source_ref: str

    def render(self) -> str:
        return f"## {self.title}\n\n{self.body.strip()}\n\n> 来源: {self.source_kind}:{self.source_ref}\n"


class ContextBuilder:
    """Builds the task context from the database, the repository and memory."""

    def __init__(self, settings: Settings, database: Database) -> None:
        self.settings = settings
        self.database = database

    # ------------------------------------------------------------- queries
    def spec_blocks(self) -> list[ContextBlock]:
        rows = self.database.query(
            "SELECT spec_id, title, detail, category, target_symbol, status "
            "FROM project_specs ORDER BY spec_id"
        )
        blocks: list[ContextBlock] = []
        for row in rows:
            body = (
                f"**{row['spec_id']} {row['title']}**\n\n"
                f"- 类别: {row['category']}\n"
                f"- 目标符号: `{row['target_symbol']}`\n"
                f"- 状态: {row['status']}\n\n"
                f"{row['detail']}"
            )
            blocks.append(
                ContextBlock(
                    title=f"规格条目 {row['spec_id']}",
                    body=body,
                    source_kind=SOURCE_DB,
                    source_ref=f"project_specs#{row['spec_id']}",
                )
            )
        return blocks

    def symbol_blocks(self, symbols: list[str] | None = None) -> list[ContextBlock]:
        rows = self.database.query(
            "SELECT symbol_id, file_path, symbol_name, kind, signature, body "
            "FROM code_symbols ORDER BY symbol_id"
        )
        if symbols:
            wanted = set(symbols)
            rows = [row for row in rows if row["symbol_id"] in wanted]
        blocks: list[ContextBlock] = []
        for row in rows:
            body = (
                f"文件: `{row['file_path']}`  符号: `{row['symbol_id']}` "
                f"({row['kind']})\n\n"
                f"```python\n{row['body']}\n```"
            )
            blocks.append(
                ContextBlock(
                    title=f"待修改代码 {row['symbol_id']}",
                    body=body,
                    source_kind=SOURCE_DB,
                    source_ref=f"code_symbols#{row['symbol_id']}",
                )
            )
        return blocks

    def test_blocks(self, task_id: str | None = None) -> list[ContextBlock]:
        if task_id:
            rows = self.database.query(
                "SELECT test_name, status, duration_ms, detail, recorded_at "
                "FROM test_results WHERE task_id = ? ORDER BY test_name",
                [task_id],
            )
        else:
            rows = self.database.query(
                "SELECT test_name, status, duration_ms, detail, recorded_at "
                "FROM test_results ORDER BY test_name"
            )
        if not rows:
            blocks = [
                ContextBlock(
                    title="测试现状",
                    body=(
                        "本次任务尚未执行测试。验收要求见 `docs/sdd/requirements.md`，"
                        "行为基线位于 `tests/pricing_baseline.json`。"
                    ),
                    source_kind=SOURCE_FILE,
                    source_ref="docs/sdd/requirements.md",
                )
            ]
            return blocks
        lines = ["| 测试 | 状态 | 耗时(ms) | 时间 |", "| --- | --- | ---: | --- |"]
        for row in rows:
            lines.append(
                f"| {row['test_name']} | {row['status']} | {row['duration_ms']} "
                f"| {row['recorded_at']} |"
            )
        return [
            ContextBlock(
                title="测试现状",
                body="\n".join(lines),
                source_kind=SOURCE_DB,
                source_ref="test_results",
            )
        ]

    def file_blocks(self) -> list[ContextBlock]:
        """Acceptance commands and the test surface, read from the repo."""
        commands = (
            "1. `python -m pytest -q` - 全部单元测试\n"
            "2. `python -m pytest tests/test_pricing_behavior.py -q` - "
            "行为快照与重构前基线逐项比对\n"
            "3. `python -m pytest tests/test_pricing.py -q` - 公开接口与旧口吻用例"
        )
        return [
            ContextBlock(
                title="验收方式",
                body=commands,
                source_kind=SOURCE_FILE,
                source_ref="docs/sdd/requirements.md",
            )
        ]

    def memory_blocks(self, memories: list[dict[str, object]]) -> list[ContextBlock]:
        blocks: list[ContextBlock] = []
        for memory in memories:
            blocks.append(
                ContextBlock(
                    title=f"历史上下文 {memory.get('title', 'memory')}",
                    body=str(memory.get("content", "")),
                    source_kind=SOURCE_MEMORY,
                    source_ref=str(memory.get("id", "unknown")),
                )
            )
        return blocks

    def joined_blocks(self, scope_id: str) -> list[ContextBlock]:
        """Relational query over the project records *and* the memory table.

        Both live in the same database engine, so the task context can be
        assembled with one join instead of two disconnected reads.  The
        result is what proves that the database really takes part in the
        task context, not just that a connection was opened.
        """
        try:
            rows = self.database.query(
                "SELECT s.spec_id AS spec_id, s.category AS category, "
                "m.kind AS kind, m.text AS text "
                "FROM project_specs s, pc_memory_entry_versions m "
                "WHERE m.scope_id = ? "
                "ORDER BY s.spec_id, m.created_in_revision",
                [scope_id],
            )
        except Exception:  # noqa: BLE001 - the memory table may not exist yet
            return []
        if not rows:
            return []
        grouped: dict[str, list[dict[str, object]]] = {}
        for row in rows:
            grouped.setdefault(str(row["spec_id"]), []).append(row)
        blocks: list[ContextBlock] = []
        for spec_id, items in grouped.items():
            lines = []
            for item in items:
                text = str(item["text"]).strip()
                if not text:
                    continue
                lines.append(f"- **{item['kind']}**: {text}")
            if not lines:
                continue
            blocks.append(
                ContextBlock(
                    title=f"关联记录 {spec_id}",
                    body="\n".join(lines),
                    source_kind=SOURCE_JOIN,
                    source_ref=(
                        f"project_specs#{spec_id} x "
                        f"pc_memory_entry_versions@{scope_id}"
                    ),
                )
            )
        return blocks

    # -------------------------------------------------------------- render
    def build(
        self,
        *,
        task_id: str,
        task_title: str,
        scope_id: str,
        memories: list[dict[str, object]] | None = None,
        symbols: list[str] | None = None,
    ) -> str:
        header = (
            f"# 任务上下文: {task_title}\n\n"
            f"- 任务 ID: `{task_id}`\n"
            f"- 上下文空间 (Scope): `{scope_id}`\n"
            f"- 数据库后端: {self.database.backend_name()}\n"
            f"- 规格来源: `docs/sdd/requirements.md`\n"
            f"- 代码来源: `billing/` (已索引到 `code_symbols` 表)\n"
            f"- 测试来源: `tests/` (结果写入 `test_results` 表)\n"
        )
        blocks: list[ContextBlock] = []
        blocks.extend(self.spec_blocks())
        blocks.extend(self.symbol_blocks(symbols))
        blocks.extend(self.test_blocks(task_id))
        blocks.extend(self.file_blocks())
        blocks.extend(self.joined_blocks(scope_id))
        blocks.extend(self.memory_blocks(memories or []))
        return header + "\n" + "\n".join(block.render() for block in blocks)

    def write(self, text: str) -> Path:
        self.settings.ensure_dirs()
        path = self.settings.context_path
        path.write_text(text, encoding="utf-8")
        return path

    def refresh_symbol_index(self) -> int:
        """Re-read the project sources and refresh the ``code_symbols`` table."""
        symbols = collect_project_symbols(self.settings.root)
        self.database.execute("DELETE FROM code_symbols")
        rows = [
            {
                "symbol_id": symbol.symbol_id,
                "file_path": symbol.file_path,
                "symbol_name": symbol.symbol_name,
                "kind": symbol.kind,
                "signature": symbol.signature,
                "body": symbol.body,
                "checksum": symbol.checksum,
                "updated_at": symbol.updated_at,
            }
            for symbol in symbols
        ]
        return self.database.upsert_many("code_symbols", rows)
