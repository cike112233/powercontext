#!/bin/bash
# =============================================================
# 智能科研助手 - 后端一键部署脚本（在阿里云 ECS 上以 root 运行）
#
# 作用：在 ECS 上部署 seekdb（Docker）+ API 服务器（Node），
#       供 Qoder Sites 发布站点通过 Function 代理调用。
#
# 用法（在 ECS 终端执行）：
#   curl -fsSL https://raw.githubusercontent.com/cike112233/powercontext/main/deploy/setup-ecs.sh | bash
#   或：bash setup-ecs.sh
#
# 部署完成后：
#   1. 在阿里云控制台 -> ECS -> 安全组 放行 TCP 3001 端口（来源 0.0.0.0/0）
#   2. 不要放行 2881（seekdb 只监听 127.0.0.1，仅本机 API 服务器可访问）
#   3. 把 ECS 公网 IP 填入 functions/handler.ts 的 API_ORIGIN 后重新发布站点
# =============================================================
set -e

echo "==> [1/5] 安装 Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker

echo "==> [2/5] 启动 seekdb（仅监听本机 2881）"
if ! docker ps -a --format '{{.Names}}' | grep -q '^seekdb$'; then
  docker run -d --name seekdb --restart always \
    -p 127.0.0.1:2881:2881 \
    -v /var/lib/seekdb:/var/lib/oceanbase \
    oceanbase/seekdb
else
  docker start seekdb
fi

echo "==> [3/5] 安装 Node.js 22"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> [4/5] 部署 API 服务器"
mkdir -p /opt/research-api
cd /opt/research-api
curl -fsSL -o index.mjs https://raw.githubusercontent.com/cike112233/powercontext/main/server/index.mjs
if [ ! -f package.json ]; then
  npm init -y >/dev/null
fi
npm install seekdb@1.4.0 --no-audit --no-fund

cat > /etc/systemd/system/research-api.service <<'EOF'
[Unit]
Description=Research Assistant seekdb API
After=network.target docker.service
Wants=docker.service

[Service]
WorkingDirectory=/opt/research-api
ExecStart=/usr/bin/node /opt/research-api/index.mjs
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now research-api

echo "==> [5/5] 等待服务就绪并自检"
sleep 12
systemctl --no-pager --lines=20 status research-api || true
curl -s http://127.0.0.1:3001/api/status || true
echo
echo "=============================================================="
echo "部署完成。接下来："
echo "  1. 阿里云控制台安全组放行 TCP 3001"
echo "  2. 自检命令: curl http://127.0.0.1:3001/api/status"
echo "  3. 外网自检: curl http://<公网IP>:3001/api/status"
echo "  4. 将公网 IP 填入仓库 functions/handler.ts 的 API_ORIGIN 并重新发布站点"
echo "=============================================================="
