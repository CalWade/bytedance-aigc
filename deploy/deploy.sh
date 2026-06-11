#!/usr/bin/env bash
# ============================================================
# bytedance-aigc 一键部署脚本
# ============================================================
# 用法:
#   ./deploy/deploy.sh              # 完整部署
#   ./deploy/deploy.sh --sync-only  # 仅同步 + 重启（跳过本地构建）
#   ./deploy/deploy.sh --dry-run    # 仅打印将要执行的操作
#
# 前提:
#   - 本机已安装 pnpm，SSH 能连上服务器
#   - 服务器 deploy/.env 已配置（首次需手动创建）
# ============================================================
set -euo pipefail

SERVER="root@150.5.131.18"
REMOTE_DIR="/root/bytedance-aigc/app"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---- CLI flags ----
SKIP_BUILD=false
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --sync-only) SKIP_BUILD=true ;;
    --dry-run)   DRY_RUN=true ;;
    *)           echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

# ---- Phase 1: Local build ----
if ! "$SKIP_BUILD"; then
  echo "==> 1/4 Building shared package..."
  if ! "$DRY_RUN"; then
    cd "$PROJECT_ROOT" && pnpm --filter @bytedance-aigc/shared build
  fi

  echo "==> 2/4 Building web (Next.js standalone)..."
  if ! "$DRY_RUN"; then
    cd "$PROJECT_ROOT" && NEXT_PUBLIC_API_BASE_URL=https://041105.best/api pnpm --filter @bytedance-aigc/web build
  fi

  echo "==> 3/4 Copying static & public assets into standalone..."
  if ! "$DRY_RUN"; then
    SRC="$PROJECT_ROOT/apps/web/.next/static"
    DST="$PROJECT_ROOT/apps/web/.next/standalone/apps/web/.next/static"
    rm -rf "$DST"
    cp -r "$SRC" "$DST"
    echo "   $SRC → $DST"

    SRC="$PROJECT_ROOT/apps/web/public"
    DST="$PROJECT_ROOT/apps/web/.next/standalone/apps/web/public"
    rm -rf "$DST"
    cp -r "$SRC" "$DST"
    echo "   $SRC → $DST"
  fi

  green "   Build done."
else
  echo "==> 1-3/4 Skipping build (--sync-only)"
fi

# ---- Phase 2: rsync to server ----
echo "==> 4/4 Deploying to server..."

RSYNC_OPTS=(
  -az --delete
  --exclude 'node_modules'
  --exclude '.git'
  --exclude '.next/dev'
  --exclude 'coverage'
  --exclude 'test-results'
  --exclude 'e2e'
  --exclude '.claude'
  --exclude 'apps/web-consumer'
  --exclude 'apps/web-studio'
  --exclude 'apps/api/test'
  --exclude 'apps/web/.next/cache'
  --exclude 'deploy/.env'
  --exclude '.env'
)

if "$DRY_RUN"; then
  echo "[dry-run] rsync ${RSYNC_OPTS[*]} $PROJECT_ROOT/ $SERVER:$REMOTE_DIR/"
else
  rsync "${RSYNC_OPTS[@]}" "$PROJECT_ROOT/" "$SERVER:$REMOTE_DIR/"
fi
green "   Sync done."

# ---- Phase 3: Restart services on server ----
echo "   Restarting services..."

REMOTE_SCRIPT='
set -euo pipefail
cd /root/bytedance-aigc/app/deploy

if [ ! -f .env ]; then
  echo "   FATAL: deploy/.env not found. Create it from .env.example first."
  exit 1
fi

echo "   Rebuilding API Docker image..."
docker-compose build api | tail -3

echo "   Starting API..."
docker-compose up -d api

echo "   Waiting for API to be ready..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:4000/ > /dev/null 2>&1; then
    echo "   API is ready."
    break
  fi
  sleep 2
done

echo "   Running migrations..."
docker-compose exec -T api sh -c "cd apps/api && npx prisma@5 migrate deploy" \
  || echo "   (migrations skipped — may be already applied)"

echo "   Restarting web..."
systemctl restart bytedance-web
echo "   All services restarted."
'

if ! "$DRY_RUN"; then
  echo "$REMOTE_SCRIPT" | ssh "$SERVER" bash -s
fi

# ---- Verify ----
echo ""
echo "=========================================="
echo "  Deploy complete. Verifying..."
echo "=========================================="

VERIFY_SCRIPT='
WEB_CODE=$(curl -sk -o /dev/null -w "%{http_code}" https://041105.best/)
API_BODY=$(curl -sk https://041105.best/api/auth/login -X POST -H "Content-Type: application/json" \
  -d "{\"handle\":\"demo-author\",\"password\":\"demo1234\"}")
if echo "$API_BODY" | grep -q accessToken; then API_STATUS="OK"; else API_STATUS="FAIL"; fi
SERVICES=$(systemctl is-active bytedance-web nginx docker | tr "\n" " ")
echo "  Web:  HTTP $WEB_CODE"
echo "  API:  $API_STATUS"
echo "  Services: $SERVICES"
'

if ! "$DRY_RUN"; then
  echo "$VERIFY_SCRIPT" | ssh "$SERVER" bash -s
fi

echo "=========================================="
