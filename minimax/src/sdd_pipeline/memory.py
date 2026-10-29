"""Memory substrate adapter.

PowerContext keeps the memory entries; the pipeline only decides what goes
in and how it is read back.  Three transports are supported, in order of
preference:

1. **in-process runtime** - the PowerContext runtime is opened inside the
   pipeline process, so no background server, port or plugin is required;
2. **HTTP server** - an already running PowerContext server is used through
   its HTTP client;
3. **local mirror** - a degraded mode that keeps the pipeline runnable.  The
   run report always names the degradation, it is never silent.

Every write carries an explicit scope id.  That is the difference between a
project scoped memory and the shared default scope, where unrelated
projects would contaminate each other's context.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .config import Settings


@dataclass(frozen=True)
class MemoryEntry:
    title: str
    content: str
    category: str = "project"
    source: str = ""
    entry_id: str = ""


@dataclass
class MemoryStore:
    """Common surface of every memory transport."""

    kind: str = "none"
    degraded: bool = True
    detail: str = ""
    scope_id: str = ""

    def write(self, entries: list[MemoryEntry]) -> list[str]:
        raise NotImplementedError

    def search(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        raise NotImplementedError

    def describe(self) -> str:
        suffix = " (degraded)" if self.degraded else ""
        return f"{self.kind}{suffix}: {self.detail}"


class LocalMirrorStore(MemoryStore):
    """SQLite backed mirror used when PowerContext is unavailable."""

    kind = "local-mirror"

    def __init__(self, path: Path, scope_id: str) -> None:
        super().__init__(degraded=True, detail=f"sqlite mirror at {path}",
                         scope_id=scope_id)
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(str(path)) as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS memory_entries (
                    entry_id VARCHAR(64) PRIMARY KEY,
                    scope_id VARCHAR(128) NOT NULL,
                    title VARCHAR(255) NOT NULL,
                    content TEXT NOT NULL,
                    category VARCHAR(64) NOT NULL,
                    source VARCHAR(255) NOT NULL,
                    created_at VARCHAR(40) NOT NULL
                )
                """
            )

    def write(self, entries: list[MemoryEntry]) -> list[str]:
        written: list[str] = []
        with sqlite3.connect(str(self.path)) as connection:
            for entry in entries:
                entry_id = entry.entry_id or f"mem_{int(time.time() * 1000)}_{len(written)}"
                connection.execute(
                    "INSERT OR REPLACE INTO memory_entries "
                    "(entry_id, scope_id, title, content, category, source, created_at)"
                    " VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (
                        entry_id,
                        self.scope_id,
                        entry.title,
                        entry.content,
                        entry.category,
                        entry.source,
                        time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    ),
                )
                written.append(entry_id)
        return written

    def search(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        tokens = [token for token in query.lower().split() if token]
        with sqlite3.connect(str(self.path)) as connection:
            connection.row_factory = sqlite3.Row
            rows = connection.execute(
                "SELECT entry_id, title, content, category, source FROM memory_entries "
                "WHERE scope_id = ? ORDER BY created_at DESC",
                (self.scope_id,),
            ).fetchall()
        results: list[dict[str, Any]] = []
        for row in rows:
            haystack = f"{row['title']} {row['content']}".lower()
            score = sum(1 for token in tokens if token in haystack)
            results.append({**dict(row), "score": score})
        results.sort(key=lambda item: (-item["score"], item["entry_id"]))
        return results[:limit]


class PowerContextStore(MemoryStore):
    """Memory transport backed by the PowerContext runtime."""

    kind = "powercontext"

    def __init__(self, session: Any, scope_id: str, detail: str = "") -> None:
        super().__init__(
            kind="powercontext",
            degraded=False,
            detail=detail or scope_id,
            scope_id=scope_id,
        )
        self.session = session

    def write(self, entries: list[MemoryEntry]) -> list[str]:
        from powercontext.builtin.artifacts.memory.models import MemoryEntryInput
        from powercontext.builtin.runtime import RememberMemoryRequest

        if not entries:
            return []
        inputs = tuple(
            MemoryEntryInput(
                kind=entry.category or "project",
                text=_as_memory_text(entry),
                reason=entry.source or None,
            )
            for entry in entries
        )
        request = RememberMemoryRequest(entries=inputs)
        result = self.session.run(
            self.session.runtime.memory.for_scope(self.scope_id).remember(request)
        )
        # PowerContext stores a batch as one Memory revision and reports the
        # last changed entry; one id is returned per submitted entry so the
        # caller can count what was actually persisted.
        entry = getattr(result, "entry", None)
        last_id = getattr(entry, "entry_id", "") if entry is not None else ""
        ids = [""] * len(entries)
        if last_id:
            ids[-1] = last_id
        return ids

    def search(self, query: str, limit: int = 8) -> list[dict[str, Any]]:
        from powercontext.builtin.runtime import SearchMemoryRequest

        request = SearchMemoryRequest(query=query, limit=max(1, min(limit, 50)))
        page = self.session.run(
            self.session.runtime.memory.for_scope(self.scope_id).search(request)
        )
        results: list[dict[str, Any]] = []
        for hit in getattr(page, "hits", ()) or ():
            results.append(
                {
                    "id": getattr(hit, "entry_id", ""),
                    "title": getattr(hit, "kind", "memory"),
                    "content": getattr(hit, "text", ""),
                    "score": float(getattr(hit, "score", 0.0) or 0.0),
                }
            )
        return results

    def prepare_context(self, query: str, max_bytes: int = 8000) -> str:
        """Ask PowerContext to assemble a bounded context pack."""
        from powercontext.builtin.runtime import PrepareContextRequest

        request = PrepareContextRequest(
            query=query, max_bytes=max(512, min(max_bytes, 32768))
        )
        pack = self.session.run(
            self.session.runtime.context.for_scope(self.scope_id).prepare(request)
        )
        return getattr(pack, "content", "") or ""


def _as_memory_text(entry: MemoryEntry) -> str:
    """Render one memory entry.

    The ASCII keyword line keeps the full text search usable: the embedded
    engine indexes whitespace separated tokens, so a Chinese-only body would
    be hard to recall with a mixed query.
    """
    keyword = entry.source or entry.title
    return f"[{keyword}]\n{entry.content}"


def build_memory_store(settings: Settings, session: Any = None) -> MemoryStore:
    """Pick the best available memory transport for this environment."""
    if session is not None:
        return PowerContextStore(session, session.scope_id)

    store = LocalMirrorStore(
        settings.records_path / "memory_mirror.db", settings.scope_id
    )
    store.detail = "PowerContext runtime unavailable, using the local mirror"
    return store
