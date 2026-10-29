"""Loaders that turn repository files into database rows.

Two kinds of project material are imported:

* **specification entries** parsed from ``docs/sdd/requirements.md``
* **code symbols** extracted from the Python sources under ``billing/``

Both loaders are deterministic and dependency free so that ``init`` can be
replayed from a clean checkout and always produce the same rows.
"""

from __future__ import annotations

import ast
import hashlib
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SPEC_HEADING = re.compile(r"^###\s+(SPEC-[A-Za-z0-9\-_]+)\s*(.*)$")
FIELD = re.compile(r"^-\s*([a-z_]+)\s*:\s*(.*)$")
DETAIL_START = re.compile(r"^-\s*detail\s*:\s*\|\s*$")


def utc_now() -> str:
    """Timestamp format shared by every table."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass(frozen=True)
class SpecEntry:
    spec_id: str
    title: str
    detail: str
    category: str
    target_symbol: str
    status: str = "pending"
    created_at: str = ""
    updated_at: str = ""


def parse_specs(path: Path) -> list[SpecEntry]:
    """Parse specification entries out of a markdown requirements file."""
    if not path.is_file():
        return []
    lines = path.read_text(encoding="utf-8").splitlines()
    entries: list[SpecEntry] = []
    current_id: str | None = None
    current_title = ""
    fields: dict[str, str] = {}
    detail_lines: list[str] = []
    in_detail = False

    def flush() -> None:
        nonlocal current_id, current_title, fields, detail_lines, in_detail
        if current_id is None:
            return
        detail = "\n".join(detail_lines).strip()
        if not detail:
            detail = fields.pop("detail", "").strip()
        entries.append(
            SpecEntry(
                spec_id=current_id,
                title=current_title.strip(),
                detail=detail,
                category=fields.get("category", "general").strip(),
                target_symbol=fields.get("target_symbol", "").strip(),
                status=fields.get("status", "pending").strip(),
                created_at=utc_now(),
                updated_at=utc_now(),
            )
        )
        current_id = None
        current_title = ""
        fields = {}
        detail_lines = []
        in_detail = False

    for raw in lines:
        heading = SPEC_HEADING.match(raw)
        if heading:
            flush()
            current_id = heading.group(1)
            current_title = heading.group(2)
            continue
        if current_id is None:
            continue
        if DETAIL_START.match(raw):
            in_detail = True
            fields.pop("detail", None)
            continue
        if in_detail:
            if raw.startswith("  ") or raw.startswith("\t") or not raw.strip():
                detail_lines.append(raw.strip())
                continue
            in_detail = False
        field = FIELD.match(raw)
        if field:
            fields[field.group(1)] = field.group(2).strip()
            continue
        if raw.startswith("###") or raw.startswith("##"):
            flush()
    flush()
    return entries


@dataclass(frozen=True)
class CodeSymbol:
    symbol_id: str
    file_path: str
    symbol_name: str
    kind: str
    signature: str
    body: str
    checksum: str
    updated_at: str


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def extract_symbols(file_path: Path, root: Path) -> list[CodeSymbol]:
    """Extract top level functions and classes with their source text."""
    source = file_path.read_text(encoding="utf-8")
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    relative = file_path.relative_to(root).as_posix()
    module = file_path.stem
    symbols: list[CodeSymbol] = []

    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            name = node.name
            kind = "function"
            signature = f"{name}{ast.unparse(node.args)}"
        elif isinstance(node, ast.ClassDef):
            name = node.name
            kind = "class"
            signature = f"class {name}"
        else:
            continue
        body = ast.get_source_segment(source, node) or ""
        symbols.append(
            CodeSymbol(
                symbol_id=f"{module}.{name}",
                file_path=relative,
                symbol_name=name,
                kind=kind,
                signature=signature,
                body=body,
                checksum=_digest(body),
                updated_at=utc_now(),
            )
        )
    return symbols


def collect_project_symbols(root: Path, package_dir: str = "billing") -> list[CodeSymbol]:
    """Index every module in the sample project package."""
    symbols: list[CodeSymbol] = []
    package_root = root / package_dir
    if not package_root.is_dir():
        return symbols
    for path in sorted(package_root.rglob("*.py")):
        if path.name.startswith("__"):
            continue
        symbols.extend(extract_symbols(path, root))
    return symbols
