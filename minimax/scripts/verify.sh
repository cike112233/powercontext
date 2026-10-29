#!/usr/bin/env bash
# Acceptance self-check for the MiniMax x OceanBase track.
#
#   ./scripts/verify.sh          # verify everything, including the artifacts
#                                 # produced by a model driven run
#
# The script never leaks credentials and works from a clean checkout.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python

export PYTHONPATH="$ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONIOENCODING=utf-8

echo "==> 准备依赖"
if [ -f "requirements.txt" ] && [ -z "${SDD_SKIP_INSTALL:-}" ]; then
  "$PYTHON" -m pip install -q -r requirements.txt || {
    echo "依赖安装失败，可设置 SDD_SKIP_INSTALL=1 跳过" >&2
  }
fi

echo "==> 生成行为基线（仅在缺失时）"
[ -f tests/pricing_baseline.json ] || "$PYTHON" scripts/generate_baseline.py

echo "==> 运行验收自检"
"$PYTHON" scripts/verify.py "$@"
STATUS=$?

echo
if [ $STATUS -eq 0 ]; then
  echo "验收自检通过。"
else
  echo "验收自检未通过，请查看上面的逐项结果。" >&2
fi
exit $STATUS
