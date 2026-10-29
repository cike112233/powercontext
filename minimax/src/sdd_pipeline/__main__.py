"""Allow ``python -m sdd_pipeline`` from the project root."""

from __future__ import annotations

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
