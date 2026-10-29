"""Command line entry point.

    python -m sdd_pipeline init
    python -m sdd_pipeline context
    python -m sdd_pipeline run
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .config import load_settings
from .runner import Pipeline


def _print_results(results: list) -> int:
    failed = False
    for result in results:
        status = "OK  " if result.ok else "FAIL"
        print(f"[{status}] {result.name:<8} {result.message}")
        if result.detail:
            print("        " + json.dumps(result.detail, ensure_ascii=False))
        failed = failed or not result.ok
    return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sdd_pipeline",
        description="Specification driven development pipeline backed by "
                    "PowerContext and an OceanBase-derived database.",
    )
    parser.add_argument(
        "--root", type=Path, default=None, help="project root (default: package root)"
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name, help_text in (
        ("init", "prepare the database, import specs and index the code"),
        ("context", "rebuild the task context pack"),
        ("plan", "ask MiniMax for the change plan"),
        ("patch", "ask MiniMax for the new file contents and apply them"),
        ("verify", "run the test suite and persist the results"),
        ("report", "write the run report"),
        ("show-context", "print the current context pack"),
        ("run", "run the whole pipeline"),
    ):
        sub.add_parser(name, help=help_text)
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    settings = load_settings(args.root)
    pipeline = Pipeline(settings)
    try:
        if args.command == "init":
            return _print_results([pipeline.init()])
        if args.command == "context":
            return _print_results([pipeline.build_context()])
        if args.command == "plan":
            return _print_results([pipeline.plan()])
        if args.command == "patch":
            return _print_results([pipeline.patch()])
        if args.command == "verify":
            return _print_results([pipeline.verify()])
        if args.command == "report":
            return _print_results([pipeline.report()])
        if args.command == "show-context":
            path = settings.context_path
            if not path.is_file():
                print(f"context pack not found: {path}", file=sys.stderr)
                return 1
            print(path.read_text(encoding="utf-8"))
            return 0
        if args.command == "run":
            return _print_results(pipeline.run_all())
    finally:
        pipeline.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
