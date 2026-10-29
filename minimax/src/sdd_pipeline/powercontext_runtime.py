"""In-process PowerContext runtime session.

The pipeline drives PowerContext directly through its runtime layer instead
of going over HTTP.  Two consequences matter for the competition:

* no background server, port or plugin has to be running - the pipeline is
  self contained, which is what the "runs standalone" acceptance item wants;
* the project record tables and the PowerContext memory tables live in the
  **same database engine**, so the task context can be assembled with a
  single relational query instead of two disconnected stores.

The engine is selected by ``SDD_DB_KIND``:

``seekdb``    embedded OceanBase derived engine (``pylibseekdb``)
``oceanbase`` a real OceanBase tenant over the MySQL protocol
``sqlite``    a SQLite file, used on hosts without the embedded wheel
"""

from __future__ import annotations

import asyncio
import json
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import Settings


@dataclass
class RuntimeSession:
    """Owns one PowerContext runtime and the event loop that drives it."""

    settings: Settings
    scope_id: str = ""
    loop: asyncio.AbstractEventLoop | None = None
    runtime: Any = None
    _context: Any = None
    _lock: threading.Lock = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        self._lock = threading.Lock()

    # ------------------------------------------------------------ lifecycle
    def open(self) -> "RuntimeSession":
        with self._lock:
            if self.runtime is not None:
                return self
            self.loop = asyncio.new_event_loop()
            self._context = _open_runtime(self.settings, self.loop)
            self.runtime = self.loop.run_until_complete(self._context.__aenter__())
            self.scope_id = self._ensure_scope()
            return self

    def close(self) -> None:
        with self._lock:
            if self._context is not None:
                context, self._context = self._context, None
                loop = self.loop
                if loop is not None:
                    try:
                        loop.run_until_complete(context.__aexit__(None, None, None))
                    finally:
                        loop.close()
            self.runtime = None
            self.loop = None

    def run(self, coroutine: Any) -> Any:
        """Run a coroutine on the session's event loop."""
        if self.loop is None:
            raise RuntimeError("runtime session is not open")
        return self.loop.run_until_complete(coroutine)

    # ---------------------------------------------------------------- scope
    def _ensure_scope(self) -> str:
        """Create the project scope once and remember it across restarts."""
        state_path = self.settings.records_path / "scope.json"
        remembered = ""
        if state_path.is_file():
            try:
                remembered = str(json.loads(state_path.read_text(encoding="utf-8"))
                                 .get("scope_id", ""))
            except (OSError, json.JSONDecodeError):
                remembered = ""

        if remembered:
            try:
                self.run(self.runtime.scopes.get(remembered))
                return remembered
            except Exception:  # noqa: BLE001 - the scope vanished, recreate it
                pass

        from powercontext.builtin.scope.models import ScopeDraft

        draft = ScopeDraft(
            title="MiniMax SDD Pipeline",
            summary="Specification driven development task context for the "
                    "MiniMax x OceanBase track.",
            idempotency_key=f"sdd-pipeline-{self.settings.scope_key}",
        )
        scope = self.run(self.runtime.scopes.create(draft))
        self.settings.ensure_dirs()
        state_path.write_text(
            json.dumps(
                {"scope_id": scope.scope_id, "title": "MiniMax SDD Pipeline"},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        return scope.scope_id

    # ----------------------------------------------------------------- SQL
    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
        """Run a statement on the runtime database and return the rows."""
        from sqlalchemy import text

        named = {f"p{index}": value for index, value in enumerate(params)}
        statement = text(_convert_placeholders(sql))
        rows = self.run(
            _execute(self.runtime, statement, named)
        )
        return rows

    def execute_many(self, statements: list[tuple[str, tuple[Any, ...]]]) -> None:
        for sql, params in statements:
            self.execute(sql, params)


async def _execute(runtime: Any, statement: Any, params: dict[str, Any]) -> list[dict[str, Any]]:
    database = runtime._provider.database
    async with database.transaction() as connection:
        result = await connection.execute(statement, params)
        if not result.returns_rows:
            return []
        keys = list(result.keys())
        return [dict(zip(keys, row, strict=False)) for row in result.fetchall()]


def _convert_placeholders(sql: str) -> str:
    """Translate ``?`` placeholders into SQLAlchemy named parameters."""
    out: list[str] = []
    index = 0
    in_string = False
    quote = ""
    for char in sql:
        if in_string:
            out.append(char)
            if char == quote:
                in_string = False
            continue
        if char in "'\"":
            in_string = True
            quote = char
            out.append(char)
            continue
        if char == "?":
            out.append(f":p{index}")
            index += 1
            continue
        out.append(char)
    return "".join(out)


def _open_runtime(settings: Settings, loop: asyncio.AbstractEventLoop) -> Any:
    """Build the runtime configuration for the configured database engine."""
    from powercontext.builtin.runtime import BuiltinConfig, open_builtin_runtime
    from powercontext.builtin.persistence.oceanbase import OceanBaseConfig
    from powercontext.builtin.persistence.seekdb import SeekDBConfig
    from powercontext.builtin.persistence.sqlite import SQLiteConfig

    kind = settings.database.kind
    if kind == "seekdb":
        path = settings.database.path
        path.mkdir(parents=True, exist_ok=True)
        database = SeekDBConfig(path=path)
    elif kind == "oceanbase":
        database = OceanBaseConfig(url=settings.database.dsn)
    else:
        path = settings.database.path
        path.parent.mkdir(parents=True, exist_ok=True)
        database = SQLiteConfig(url=f"sqlite+aiosqlite:///{path.as_posix()}")

    config = BuiltinConfig(database=database)
    scheduler = settings.records_path / "powercontext_scheduler.db"
    settings.ensure_dirs()
    return open_builtin_runtime(config, scheduler_path=str(scheduler))


def open_session(settings: Settings) -> RuntimeSession | None:
    """Open a runtime session, returning ``None`` when it is unavailable."""
    session = RuntimeSession(settings=settings)
    try:
        session.open()
    except Exception as error:  # noqa: BLE001 - any failure means degraded mode
        try:
            session.close()
        except Exception:  # noqa: BLE001
            pass
        session.error = f"{type(error).__name__}: {error}"  # type: ignore[attr-defined]
        return None
    return session
