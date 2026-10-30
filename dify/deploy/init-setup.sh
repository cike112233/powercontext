#!/usr/bin/env bash
# 初始化 Dify 管理员（本地自部署专用占位凭据，不是任何真实服务的密钥）
set -e
EMAIL="${DIFY_ADMIN_EMAIL:-admin@seekdb.local}"
PASS="${DIFY_ADMIN_PASSWORD:-Seekdb2026Demo}"
NAME="${DIFY_ADMIN_NAME:-seekdb-demo}"

# 刚 docker compose up -d 完时 api/web 通常还在起，直接打过去会拿到空响应。
# 这里等到 nginx 给出任意 HTTP 状态码（401/404 也算起来了）再发 setup。
echo "[setup] 等待 Dify 服务就绪（最多 180s）…"
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://localhost/console/api/setup" || echo 000)
  # 000=还没监听，5xx（常见 502）=nginx 起了但 api 还没就绪，这两种继续等
  if [ "$code" != "000" ] && [ "${code:0:1}" != "5" ]; then echo "  ✓ 就绪（HTTP $code），用时 $((i*2))s"; break; fi
  sleep 2
  if [ "$i" = 90 ]; then echo "  ✗ 180s 还没起来：docker compose ps 看 api/web/nginx 是否 healthy，日志 docker logs docker-api-1 --tail 50"; exit 1; fi
done

curl -s -X POST "http://localhost/console/api/setup" \
  -H 'Content-Type: application/json' \
  -d "{\"language\":\"zh-Hans\",\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"name\":\"${NAME}\"}"
echo; echo "admin=${EMAIL} password=${PASS} (本地占位，请自行修改)"
