"""Project record storage.

The tables below hold the *project material* the task context is built
from: specification entries, code symbol indexes, test results, task run
records and the assembled context entries.

They are created inside the **same database engine that stores the
PowerContext memory**, so the context can be assembled with one relational
query over both record sets.  When the PowerContext runtime is not
available the module falls back to a plain SQLite file, and the run report
states that explicitly.

The DDL is written in the intersection of the SQLite and MySQL dialects:

* primary keys are ``VARCHAR`` (SQLite accepts the type, MySQL requires it)
* no ``AUTO_INCREMENT`` - identifiers are generated in Python
* timestamps are ISO-8601 strings, not ``TIMESTAMP`` columns
* booleans are ``INTEGER`` 0/1
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from .config import DatabaseSettings

SCHEMA_STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS project_specs (
        spec_id VARCHAR(64) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        detail TEXT NOT NULL,
        category VARCHAR(64) NOT NULL,
        target_symbol VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS code_symbols (
        symbol_id VARCHAR(64) PRIMARY KEY,
        file_path VARCHAR(512) NOT NULL,
        symbol_name VARCHAR(255) NOT NULL,
        kind VARCHAR(32) NOT NULL,
        signature TEXT NOT NULL,
        body TEXT NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        updated_at VARCHAR(40) NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS test_results (
        result_id VARCHAR(64) PRIMARY KEY,
        task_id VARCHAR(64) NOT NULL,
        test_name VARCHAR(255) NOT NULL,
        status VARCHAR(32) NOT NULL,
        duration_ms INTEGER NOT NULL,
        detail TEXT NOT NULL,
        recorded_at VARCHAR(40) NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS task_records (
        task_id VARCHAR(64) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        phase VARCHAR(32) NOT NULL,
        payload TEXT NOT NULL,
        scope_id VARCHAR(128) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS context_entries (
        entry_id VARCHAR(64) PRIMARY KEY,
        task_id VARCHAR(64) NOT NULL,
        source VARCHAR(64) NOT NULL,
        source_ref VARCHAR(512) NOT NULL,
        content TEXT NOT NULL,
        created_at VARCHAR(40) NOT NULL
    )
    """,
)

INDEX_STATEMENTS: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS idx_specs_category ON project_specs (category)",
    "CREATE INDEX IF NOT EXISTS idx_symbols_file ON code_symbols (file_path)",
    "CREATE INDEX IF NOT EXISTS idx_tests_task ON test_results (task_id)",
    "CREATE INDEX IF NOT EXISTS idx_context_task ON context_entries (task_id)",
)


class Database:
    """Storage for the project records.

    Two backends are supported:

    * ``runtime`` - the engine owned by the PowerContext runtime session, so
      the project tables sit next to the memory tables;
    * ``sqlite`` - a standalone SQLite file used when the runtime is not
      available.
    """

    def __init__(
        self,
        settings: DatabaseSettings,
        session: Any = None,
    ) -> None:
        self.settings = settings
        self.session = session
        self._connection: Any = None

    # ------------------------------------------------------------ lifecycle
    @property
    def is_runtime(self) -> bool:
        return self.session is not None

    def connect(self) -> None:
        if self.is_runtime:
            return
        if self._connection is not None:
            return
        if self.settings.kind != "sqlite":
            raise RuntimeError(
                f"the {self.settings.kind} engine requires the PowerContext "
                "runtime session; it was not available"
            )
        self.settings.path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(self.settings.path))
        self._connection.row_factory = sqlite3.Row

    def close(self) -> None:
        if self._connection is not None:
            self._connection.close()
            self._connection = None

    def __enter__(self) -> "Database":
        self.connect()
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    # ------------------------------------------------------------ execution
    def execute(self, sql: str, params: Sequence[Any] = ()) -> None:
        if self.is_runtime:
            self.session.execute(sql, tuple(params))
            return
        self.connect()
        assert self._connection is not None
        cursor = self._connection.cursor()
        try:
            cursor.execute(sql, tuple(params))
            self._connection.commit()
        finally:
            cursor.close()

    def query(self, sql: str, params: Sequence[Any] = ()) -> list[dict[str, Any]]:
        if self.is_runtime:
            return self.session.execute(sql, tuple(params))
        self.connect()
        assert self._connection is not None
        cursor = self._connection.cursor()
        try:
            cursor.execute(sql, tuple(params))
            rows = cursor.fetchall()
            columns = [column[0] for column in cursor.description or ()]
        finally:
            cursor.close()
        return [dict(zip(columns, row, strict=False)) for row in rows]

    # -------------------------------------------------------------- schema
    def initialize_schema(self) -> None:
        self.connect()
        for statement in SCHEMA_STATEMENTS:
            self.execute(statement)
        for statement in INDEX_STATEMENTS:
            try:
                self.execute(statement)
            except Exception:  # noqa: BLE001 - index creation is best effort
                pass

    def is_empty(self) -> bool:
        rows = self.query("SELECT COUNT(*) AS n FROM project_specs")
        return int(rows[0]["n"]) == 0 if rows else True

    # -------------------------------------------------------------- writes
    def upsert(self, table: str, row: dict[str, Any]) -> None:
        """Insert or replace a row using the dialect of the active backend."""
        columns = list(row)
        placeholders = ", ".join(["?"] * len(columns))
        column_list = ", ".join(columns)
        if self.settings.kind == "sqlite":
            statement = (
                f"INSERT OR REPLACE INTO {table} ({column_list}) "
                f"VALUES ({placeholders})"
            )
        else:
            statement = (
                f"REPLACE INTO {table} ({column_list}) VALUES ({placeholders})"
            )
        self.execute(statement, [row[column] for column in columns])

    def upsert_many(self, table: str, rows: Iterable[dict[str, Any]]) -> int:
        count = 0
        for row in rows:
            self.upsert(table, row)
            count += 1
        return count

    def delete_by(self, table: str, column: str, value: str) -> int:
        self.execute(f"DELETE FROM {table} WHERE {column} = ?", [value])
        return 1

    def backend_name(self) -> str:
        """Human readable backend description, used in the run report."""
        if self.settings.kind == "sqlite":
            return f"sqlite ({self.settings.path})"
        return (
            f"{self.settings.kind} ({self.settings.host}:{self.settings.port}"
            f"/{self.settings.database})"
        )
