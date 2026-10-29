#!/usr/bin/env bash
# End-to-end demonstration of the pipeline.
#
#   ./scripts/run_demo.sh
#
# It installs the dependencies, prepares the environment, runs the whole
# pipeline once and finishes with the acceptance self-check.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PYTHON="${PYTHON:-python3}"
command -v "$PYTHON" >/dev/null 2>&1 || PYTHON=python

export PYTHONPATH="$ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
export PYTHONIOENCODING=utf-8

echo "==> 1/5 安装依赖"
python -m pip install -q -r requirements.txt || echo "依赖安装失败，继续使用现有环境"

echo "==> 2/5 准备配置"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "已从 .env.example 生成 .env，请填入 MINIMAX_API_KEY 后重新执行本脚本"
  exit 2
fi

echo "==> 3/5 生成行为基线（缺失时）"
[ -f tests/pricing_baseline.json ] || "$PYTHON" scripts/generate_baseline.py

echo "==> 4/5 运行完整流水线"
"$PYTHON" -m sdd_pipeline run
RUN_STATUS=$?

echo "==> 5/5 验收自检"
"$PYTHON" scripts/verify.py
VERIFY_STATUS=$?

echo
echo "产物目录: $ROOT/records"
if [ $RUN_STATUS -eq 0 ] && [ $VERIFY_STATUS -eq 0 ]; then
  echo "演示成功：流水线完成且六项验收全部通过。"
  exit 0
fi
echo "演示存在问题，请查看上面的输出。" >&2
exit 1
