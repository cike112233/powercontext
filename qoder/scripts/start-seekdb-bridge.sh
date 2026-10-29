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

# Windows: 自动把 Docker Desktop / cloudflared 的安装路径加入 PATH（不改系统配置）
if [[ "$OS" == "Windows_NT" ]] 2>/dev/null || uname -s | grep -q MINGW; then
  for candidate in \
    "/c/Users/$USERNAME/AppData/Local/Programs/DockerDesktop/resources/bin" \
    "/c/Program Files/Docker/Docker/resources/bin" \
    "/c/Program Files/cloudflared/bin" \
    "/c/Users/$USERNAME/AppData/Local/cloudflared" \
    "/d"; do
    if [[ -d "$candidate" ]]; then
      export PATH="$candidate:$PATH"
    fi
  done
  # 兼容用户把 cloudflared-windows-amd64.exe 直接放在某目录里的情况
  if ! command -v cloudflared >/dev/null 2>&1; then
    for cand in /d/cloudflared-windows-amd64.exe "/c/Users/$USERNAME/Downloads/cloudflared-windows-amd64.exe"; do
      if [[ -x "$cand" ]]; then
        mkdir -p /tmp/bin
        cp "$cand" /tmp/bin/cloudflared.exe
        export PATH="/tmp/bin:$PATH"
        break
      fi
    done
  fi
fi

echo "=========================================="
echo " 智能科研助手 · seekdb 桥接启动"
echo "=========================================="

# 1. 检查 Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "❌ 未找到 docker 命令。请确认 Docker Desktop 已安装（当前 shell 已尝试自动加入常见安装路径）。"
  echo "   下载：https://www.docker.com/products/docker-desktop/"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "❌ Docker Desktop 未启动或引擎未就绪。请打开 Docker Desktop，等右下角鲸鱼图标显示绿色 'Engine running'。"
  exit 1
fi

# 2. 启动 seekdb 容器
# 兼容国内镜像源：用户可能把镜像拉成了 `docker.1ms.run/oceanbase/seekdb:latest` 等带前缀的 tag，
# 自动 retag 到规范名 oceanbase/seekdb:latest。
if ! docker image inspect oceanbase/seekdb:latest >/dev/null 2>&1; then
  mirror_tag=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '(^|/)seekdb:latest$' | head -1 || true)
  if [[ -n "$mirror_tag" ]]; then
    echo "🔁 发现镜像 $mirror_tag，retag 为 oceanbase/seekdb:latest"
    docker tag "$mirror_tag" oceanbase/seekdb:latest
  fi
fi
if ! docker image inspect oceanbase/seekdb:latest >/dev/null 2>&1; then
  echo "❌ 本机没有 oceanbase/seekdb 镜像。请先手动执行："
  echo "   docker pull docker.1ms.run/oceanbase/seekdb:latest"
  echo "   （国内可直连的镜像源；不要用裸 docker pull，Docker Hub 常被封）"
  exit 1
fi

if docker ps --format '{{.Names}}' | grep -q '^seekdb$'; then
  echo "✅ seekdb 容器已在运行"
elif docker ps -a --format '{{.Names}}' | grep -q '^seekdb$'; then
  echo "🚀 启动已存在的 seekdb 容器..."
  docker start seekdb >/dev/null
else
  echo "🚀 首次启动 seekdb 容器..."
  docker run -d --name seekdb -p 127.0.0.1:2881:2881 oceanbase/seekdb
fi

# 等待 seekdb 就绪（用 docker exec 检查端口，比 nc 更可移植）
echo "⏳ 等待 seekdb 就绪（约 15-30s，首次启动了引擎要初始化）..."
for i in {1..60}; do
  if docker exec seekdb bash -c 'timeout 1 bash -c "</dev/tcp/127.0.0.1/2881"' >/dev/null 2>&1; then
    echo "✅ seekdb 已就绪"
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "❌ 等待 60 秒后 seekdb 端口仍未就绪，可能镜像在慢速拉取或首次启动初始化中。"
    echo "   手动检查：docker logs seekdb"
    exit 1
  fi
  sleep 2
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
echo "   3. 运行 npm run build"
echo "   4. 让 Qoder 重新发布站点（同 siteId / projectId 不变）"
echo "   5. 保持本终端窗口打开，评审期间不能关"
echo "=========================================="
echo ""

cloudflared tunnel --url http://127.0.0.1:3001 --no-autoupdate
