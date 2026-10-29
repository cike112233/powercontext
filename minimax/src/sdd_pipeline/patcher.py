"""Apply model produced code changes.

The model is asked to return the *complete new content* of every file it
changes rather than a unified diff.  Whole-file responses remove an entire
class of failure modes (malformed hunk headers, wrong line counts, offsets
drifting after the first hunk) and let the pipeline validate the result with
``ast.parse`` before anything touches the working tree.

The pipeline still produces a unified diff afterwards - with ``difflib`` -
so the development record can be matched against the committed changes.
"""

from __future__ import annotations

import ast
import difflib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

DIFF_FENCE = re.compile(r"```(?:diff|patch)?\s*\n(.*?)```", re.DOTALL)

ALLOWED_PREFIXES = ("billing/", "src/billing/")


@dataclass
class PatchResult:
    changed_files: list[str] = field(default_factory=list)
    diff: str = ""
    rejected: list[str] = field(default_factory=list)
    raw_response: str = ""


class PatchError(RuntimeError):
    """Raised when the model response cannot be turned into a code change."""


def extract_json(text: str) -> dict:
    """Pull the JSON document out of a model answer."""
    candidate = text.strip()
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        pass
    fenced = DIFF_FENCE.search(candidate)
    if fenced:
        try:
            return json.loads(fenced.group(1).strip())
        except json.JSONDecodeError:
            candidate = fenced.group(1).strip()
    for opener, closer in (("{", "}"),):
        start = candidate.find(opener)
        end = candidate.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(candidate[start : end + 1])
            except json.JSONDecodeError:
                continue
    raise PatchError("model answer did not contain a JSON document")


def normalise_changes(payload: dict) -> list[dict[str, str]]:
    """Accept the two response shapes the prompt may produce."""
    files = payload.get("files")
    if isinstance(files, list):
        changes: list[dict[str, str]] = []
        for item in files:
            if not isinstance(item, dict):
                continue
            path = str(item.get("path", "")).strip()
            content = item.get("content")
            if path and isinstance(content, str):
                changes.append({"path": path, "content": content})
        if changes:
            return changes

    path = str(payload.get("path", "")).strip()
    content = payload.get("content")
    if path and isinstance(content, str):
        return [{"path": path, "content": content}]
    raise PatchError("model answer did not contain any file to change")


def _is_allowed(root: Path, relative: str) -> bool:
    relative = relative.replace("\\", "/").strip()
    if relative.startswith("/") or ".." in Path(relative).parts:
        return False
    return any(relative.startswith(prefix) for prefix in ALLOWED_PREFIXES)


def apply_changes(root: Path, changes: list[dict[str, str]]) -> PatchResult:
    """Validate and write the changed files, returning the unified diff."""
    result = PatchResult()
    diff_parts: list[str] = []

    for change in changes:
        relative = change["path"].replace("\\", "/").strip()
        content = change["content"]

        if not _is_allowed(root, relative):
            result.rejected.append(relative)
            continue
        if not content.endswith("\n"):
            content += "\n"
        try:
            ast.parse(content)
        except SyntaxError as error:
            result.rejected.append(f"{relative} (语法错误: {error})")
            continue

        target = root / relative
        original = target.read_text(encoding="utf-8") if target.is_file() else ""
        if original == content:
            continue

        diff_parts.extend(
            difflib.unified_diff(
                original.splitlines(keepends=True),
                content.splitlines(keepends=True),
                fromfile=f"a/{relative}",
                tofile=f"b/{relative}",
                n=3,
            )
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        result.changed_files.append(relative)

    result.diff = "".join(diff_parts)
    return result
