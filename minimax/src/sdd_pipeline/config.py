"""Runtime configuration for the SDD pipeline.

Every externally supplied value (MiniMax key, database DSN, PowerContext
endpoint) is read from the environment or from a local ``.env`` file.  The
``.env`` file is git-ignored and must never be committed: the competition
rules explicitly forbid shipping real credentials.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path

# minimax/ -> src/sdd_pipeline/config.py -> src/sdd_pipeline -> src -> minimax
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _load_dotenv(path: Path) -> dict[str, str]:
    """Read a minimal ``KEY=VALUE`` dotenv file without extra dependencies."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


@dataclass(frozen=True)
class DatabaseSettings:
    """Which storage engine backs the project record tables.

    ``seekdb`` is the embedded OceanBase-derived engine used by PowerContext
    and is the preferred target on the Linux evaluation host.  ``oceanbase``
    talks to a real OceanBase tenant over the MySQL protocol.  ``sqlite`` is
    a zero-dependency fallback used for local development on platforms where
    the embedded seekdb wheel is unavailable.
    """

    kind: str
    path: Path
    host: str = "127.0.0.1"
    port: int = 2881
    user: str = "root@"
    password: str = ""
    database: str = "sdd_pipeline"

    @property
    def dsn(self) -> str:
        return (
            f"mysql://{self.user}:{self.password}@{self.host}:{self.port}/{self.database}"
        )


@dataclass(frozen=True)
class PowerContextSettings:
    """Connection details for the PowerContext memory substrate."""

    base_url: str
    token: str = ""
    scope_id: str = "scp_minimax_sdd_pipeline"
    enabled: bool = True
    timeout: float = 30.0


@dataclass(frozen=True)
class MinimaxSettings:
    """Credentials and routing for the MiniMax chat completion API."""

    api_key: str
    base_url: str
    model: str = "MiniMax-M3"
    max_tokens: int = 8192
    timeout: float = 180.0
    temperature: float = 0.2


@dataclass(frozen=True)
class Settings:
    root: Path
    database: DatabaseSettings
    powercontext: PowerContextSettings
    minimax: MinimaxSettings
    scope_id: str = "scp_minimax_sdd_pipeline"
    scope_key: str = "minimax-sdd-pipeline"
    records_dir: Path = field(default=Path("records"))

    # ---------------------------------------------------------------- paths
    @property
    def specs_dir(self) -> Path:
        return self.root / "docs" / "sdd"

    @property
    def billing_dir(self) -> Path:
        return self.root / "billing"

    @property
    def tests_dir(self) -> Path:
        return self.root / "tests"

    @property
    def records_path(self) -> Path:
        return self.root / self.records_dir

    @property
    def context_path(self) -> Path:
        return self.records_path / "context.md"

    @property
    def devlog_path(self) -> Path:
        return self.records_path / "devlog.jsonl"

    def ensure_dirs(self) -> None:
        self.records_path.mkdir(parents=True, exist_ok=True)


def _mcode_fallback_credentials() -> tuple[str, str]:
    """Return the local MiniMax Code login credentials, if they exist.

    The desktop client stores an OAuth access token that is only valid
    against the ``agent.minimax.cn`` gateway.  It is used as a *local
    development fallback only*; the evaluation host authenticates with the
    competition Subscription Key through ``MINIMAX_API_KEY``.
    """
    base = Path.home() / ".minimax" / "auth"
    if not base.is_dir():
        return "", ""
    for path in base.rglob("auth.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        records = payload.get("records") or {}
        for record in records.values():
            token = record.get("accessToken")
            if token:
                return token, "https://agent.minimax.cn/mavis/api/v1/llm/v1"
    return "", ""


def load_settings(root: Path | None = None) -> Settings:
    """Build the effective settings from the environment and ``.env``."""
    root = Path(root or PROJECT_ROOT)
    env = {**_load_dotenv(root / ".env"), **os.environ}

    database_kind = (env.get("SDD_DB_KIND") or "").strip().lower()
    if not database_kind:
        database_kind = "seekdb" if os.name != "nt" else "sqlite"

    db_path = Path(env.get("SDD_DB_PATH") or (root / "records" / "sdd_pipeline.db"))
    if not db_path.is_absolute():
        # a relative path must resolve against the project root, never
        # against the current working directory of the calling process
        db_path = root / db_path
    database = DatabaseSettings(
        kind=database_kind,
        path=db_path,
        host=env.get("SDD_DB_HOST", "127.0.0.1"),
        port=int(env.get("SDD_DB_PORT", "2881")),
        user=env.get("SDD_DB_USER", "root@"),
        password=env.get("SDD_DB_PASSWORD", ""),
        database=env.get("SDD_DB_NAME", "sdd_pipeline"),
    )

    api_key = env.get("MINIMAX_API_KEY", "").strip()
    base_url = env.get("MINIMAX_BASE_URL", "").strip()
    if not api_key or not base_url:
        fallback_key, fallback_url = _mcode_fallback_credentials()
        api_key = api_key or fallback_key
        base_url = base_url or fallback_url

    powercontext = PowerContextSettings(
        base_url=env.get("POWERCONTEXT_URL", "http://127.0.0.1:8000").rstrip("/"),
        token=env.get("POWERCONTEXT_TOKEN", ""),
        scope_id=env.get("POWERCONTEXT_SCOPE_ID", "scp_minimax_sdd_pipeline"),
        enabled=(env.get("POWERCONTEXT_ENABLED", "1").strip().lower()
                 not in {"0", "false", "no", "off"}),
        timeout=float(env.get("POWERCONTEXT_TIMEOUT", "30")),
    )

    minimax = MinimaxSettings(
        api_key=api_key,
        base_url=base_url.rstrip("/"),
        model=env.get("MINIMAX_MODEL", "MiniMax-M3"),
        max_tokens=int(env.get("MINIMAX_MAX_TOKENS", "8192")),
        timeout=float(env.get("MINIMAX_TIMEOUT", "180")),
    )

    return Settings(
        root=root,
        database=database,
        powercontext=powercontext,
        minimax=minimax,
        scope_id=powercontext.scope_id,
    )
