#!/usr/bin/env bash
# 智能科研助手 · seekdb 桥接启动脚本
#
# 一条命令同时启动：
#   1. Docker seekdb 容器（本机 127.0.0.1:2881，MySQL 协议）
#   2. Node API 服务器（本机 127.0.0.1:3001，seekdb-js SDK 桥接）
#   3. Cloudflare quick tunnel（生成 https://xxx.trycloudflare.com 公网 URL）
#
# 拿到 URL 后：把它填到 qoder/functions/index.ts 的 SEEKDB_PROXY_URL 常量，
# 重新构建 + 发布，站点就会真实调用本地 seekdb。
#
# 用法：
#   bash scripts/start-seekdb-bridge.sh
#
# 依赖：
#   - Docker Desktop（运行中）
#   - Node 22+
#   - cloudflared（https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/）

set -euo pipefail

cd "$(dirname "$0")/.."
PROJECT_ROOT="$(pwd)"

echo "=========================================="
echo " 智能科研助手 · seekdb 桥接启动"
echo "=========================================="

# 1. 检查 Docker
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker 未运行，请先启动 Docker Desktop。"
  exit 1
fi

# 2. 启动 seekdb 容器
if docker ps --format '{{.Names}}' | grep -q '^seekdb$'; then
  echo "✅ seekdb 容器已在运行"
elif docker ps -a --format '{{.Names}}' | grep -q '^seekdb$'; then
  echo "🚀 启动已存在的 seekdb 容器..."
  docker start seekdb >/dev/null
else
  echo "🚀 首次运行，拉取并启动 seekdb 镜像..."
  docker run -d --name seekdb -p 127.0.0.1:2881:2881 oceanbase/seekdb
fi

# 等待 seekdb 就绪
echo "⏳ 等待 seekdb 就绪（约 15s）..."
for i in {1..30}; do
  if docker exec seekdb obclient -h127.0.0.1 -P2881 -uroot -e "SELECT 1" >/dev/null 2>&1 \
     || nc -z 127.0.0.1 2881 2>/dev/null; then
    echo "✅ seekdb 已就绪"
    break
  fi
  sleep 1
done

# 3. 检查 cloudflared
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "❌ cloudflared 未安装"
  echo "   Windows: winget install --id Cloudflare.cloudflared"
  echo "   或下载：https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
  exit 1
fi

# 4. 启动 Node API 服务器（后台）
echo "🚀 启动 seekdb API 服务器 (http://127.0.0.1:3001)..."
node server/index.mjs &
API_PID=$!

cleanup() {
  echo ""
  echo "🧹 关闭 API 服务器 (PID $API_PID)..."
  kill "$API_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 等待 API 就绪
for i in {1..15}; do
  if curl -s http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
    echo "✅ API 服务器就绪：$(curl -s http://127.0.0.1:3001/api/health)"
    break
  fi
  sleep 1
done

# 5. 启动 cloudflared 隧道（前台）
echo ""
echo "🚀 启动 Cloudflare quick tunnel..."
echo "   等待隧道 URL 出现在下面输出中，格式类似："
echo "   https://xxxx-yyyy-zzzz.trycloudflare.com"
echo ""
echo "拿到 URL 后的操作："
echo "   1. 打开 qoder/functions/index.ts"
echo "   2. 把常量 SEEKDB_PROXY_URL 改成刚才的 https URL"
echo "   3. 运行 pnpm run build"
echo "   4. 让 Qoder 重新发布站点（同 siteId / projectId 不变）"
echo "   5. 保持本终端窗口打开，评审期间不能关"
echo "=========================================="
echo ""

cloudflared tunnel --url http://127.0.0.1:3001 --no-autoupdate
