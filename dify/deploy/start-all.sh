#!/usr/bin/env bash
# 一键起「seekdb 面试陪练官」的全部本地依赖（embedding 服务 + seekdb 混合检索工具服务）。
#
# 只做两件事：
#   1) 前台检查 Dify/seekdb 容器是否在跑（不在就提示该跑的命令，脚本不替你动 docker compose）
#   2) 后台拉起两个 Node 服务，并等它们健康
# 之后的知识库导入、模型配置、工具注册、DSL 导入仍然要按 docs/运行与部署说明.md 逐条跑
# （那几步会往你的 Dify 里写数据，脚本不擅自替你写）。
#
# 用法：  bash dify/deploy/start-all.sh
#         bash dify/deploy/start-all.sh stop     # 关掉两个后台服务
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIFY_DIR="$(dirname "$HERE")"
RUN_DIR="$DIFY_DIR/tmp"
mkdir -p "$RUN_DIR"

EMBED_PORT="${EMBED_PORT:-8100}"
RETRIEVAL_PORT="${RETRIEVAL_PORT:-3012}"

if [ "${1:-}" = "stop" ]; then
  for f in "$RUN_DIR/embedding.pid" "$RUN_DIR/retrieval.pid"; do
    if [ -f "$f" ]; then
      pid="$(cat "$f")"
      kill "$pid" 2>/dev/null && echo "[stop] killed $pid ($f)" || true
      rm -f "$f"
    fi
  done
  exit 0
fi

echo "[1/4] 检查容器：seekdb + Dify"
docker ps --format '{{.Names}}' | grep -qx seekdb || {
  echo "  ✗ 没有名为 seekdb 的容器。先在 dify 仓库的 docker 目录里起 seekdb profile："
  echo "    cd <dify源码>/docker && COMPOSE_PROFILES=seekdb docker compose up -d seekdb"
  echo "    （本项目用的是 docker compose 里的 seekdb profile，详见 docs/运行与部署说明.md）"
  exit 1
}
docker ps --format '{{.Names}}' | grep -q docker-api-1 || {
  echo "  ✗ Dify 没在跑：cd <dify源码>/docker && docker compose up -d"
  exit 1
}
echo "  ✓ seekdb / docker-api-1 都在"

echo "[2/4] 起本地 embedding 服务（:$EMBED_PORT，bge-small-zh-v1.5 / 512 维）"
if curl -s -m 2 "http://127.0.0.1:$EMBED_PORT/health" >/dev/null; then
  echo "  ✓ 已在运行，跳过"
else
  [ -d "$DIFY_DIR/embedding/node_modules" ] || (cd "$DIFY_DIR/embedding" && npm install --no-audit --no-fund)
  [ -d "$DIFY_DIR/embedding/models/Xenova" ] || node "$DIFY_DIR/embedding/scripts/fetch-model.mjs"
  EMBEDDING_PORT="$EMBED_PORT" nohup node "$DIFY_DIR/embedding/server.mjs" >"$RUN_DIR/embedding.log" 2>&1 &
  echo $! > "$RUN_DIR/embedding.pid"
  for i in $(seq 1 60); do
    curl -s -m 2 "http://127.0.0.1:$EMBED_PORT/health" >/dev/null && break
    sleep 1
  done
  curl -s -m 2 "http://127.0.0.1:$EMBED_PORT/health" >/dev/null || { echo "  ✗ 起不来，看 $RUN_DIR/embedding.log"; exit 1; }
  echo "  ✓ ok"
fi

echo "[3/4] 起 seekdb 混合检索工具服务（:$RETRIEVAL_PORT）"
if curl -s -m 2 "http://127.0.0.1:$RETRIEVAL_PORT/health" >/dev/null; then
  echo "  ✓ 已在运行，跳过"
else
  [ -d "$DIFY_DIR/retrieval/node_modules" ] || (cd "$DIFY_DIR/retrieval" && npm install --no-audit --no-fund)
  nohup node "$DIFY_DIR/retrieval/server.mjs" >"$RUN_DIR/retrieval.log" 2>&1 &
  echo $! > "$RUN_DIR/retrieval.pid"
  sleep 2
  curl -s -m 2 "http://127.0.0.1:$RETRIEVAL_PORT/health" >/dev/null || { echo "  ✗ 起不来，看 $RUN_DIR/retrieval.log"; exit 1; }
  echo "  ✓ $(curl -s http://127.0.0.1:$RETRIEVAL_PORT/health)"
fi

echo "[4/4] 下一步（逐条执行，凭据全部用占位值，见 docs/运行与部署说明.md 第 3-7 节）"
cat <<'EOF'
  cd dify/scripts
  export DIFY_ADMIN_EMAIL=admin@seekdb.local DIFY_ADMIN_PASSWORD=Seekdb2026Demo

  node setup-models.mjs                       # 注册本地 embedding + DeepSeek（Key 只走环境变量）
  node import-kb.mjs                          # 导入 dify/kb 语料，向量真实写入 seekdb
  node set-dataset-hybrid.mjs                 # 把该知识库检索方式设为 hybrid_search
  node setup-custom-tool.mjs --test           # 注册 seekdb 混合检索自定义工具并试调
  node import-dsl.mjs ../dsl/interview-coach.yml --publish --export ../dsl/interview-coach.exported.yml
  node make-app-key.mjs                         # 需 DIFY_APP_ID=<上一步返回的 app_id>，Key 明文只出现一次
  DIFY_APP_KEY=app-xxx node run-app.mjs "InnoDB 的 MVCC 是怎么保证一致性读的？"
EOF
