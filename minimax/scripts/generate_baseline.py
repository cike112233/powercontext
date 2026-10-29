"""Regenerate the committed behaviour baseline of the pricing module.

Run this **before** the refactoring task so the repository stores the
behaviour of the original implementation:

    python scripts/generate_baseline.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))

from test_pricing_behavior import BASELINE_PATH, collect_snapshot  # noqa: E402


def main() -> int:
    snapshot = collect_snapshot()
    BASELINE_PATH.write_text(
        json.dumps(snapshot, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"baseline written to {BASELINE_PATH}")
    print(
        "amounts={} invoices={}".format(
            len(snapshot["amounts"]), len(snapshot["invoices"])
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
