#!/usr/bin/env bash
#
# deploy.sh — deploy booking-table ke satu environment di VPS.
#
# Dipanggil oleh GitHub Actions (SSH) atau manual di VPS:
#   ./scripts/deploy.sh staging
#   ./scripts/deploy.sh production
#
# Langkah: sync ke remote branch → npm ci → (staging) db:push → build →
# pm2 reload/start → pm2 save. Idempotent & aman diulang.
#
# Catatan:
# - `.env.local` (secret) & folder uploads ada DI LUAR working tree, jadi
#   `git reset --hard` tidak menyentuhnya.
# - PRODUCTION sengaja TIDAK menjalankan db:push (skema bisa destruktif).
#   Migrasi prod dijalankan manual: `npm run db:push` (review prompt) lalu
#   `pm2 reload soho-prod`. Lihat docs/DEPLOYMENT.md.
# - Kalau `npm run build` gagal, script berhenti (set -e) SEBELUM pm2 reload,
#   jadi versi lama tetap online (tidak ada downtime karena build rusak).

set -euo pipefail

ENVIRONMENT="${1:-}"

case "$ENVIRONMENT" in
  staging)
    APP_DIR="/home/booking/soho-staging"
    PM2_NAME="soho-staging"
    BRANCH="staging"
    RUN_MIGRATE="true"
    ;;
  production)
    APP_DIR="/home/booking/soho-prod"
    PM2_NAME="soho-prod"
    BRANCH="main"
    RUN_MIGRATE="false"
    ;;
  *)
    echo "Usage: $0 {staging|production}" >&2
    exit 1
    ;;
esac

echo "==> Deploy [$ENVIRONMENT] dari branch '$BRANCH' ke $APP_DIR"

cd "$APP_DIR"

# 1. Sync persis ke remote branch (deterministik; buang perubahan lokal tak
#    sengaja di working tree, KECUALI file untracked seperti .env.local).
echo "==> git fetch + reset --hard origin/$BRANCH"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"

# 2. Install dependencies persis lockfile.
echo "==> npm ci"
npm ci

# 3. Migrasi DB — staging saja (otomatis). Production: manual (lihat docs).
if [ "$RUN_MIGRATE" = "true" ]; then
  echo "==> db:push --force (staging)"
  npm run db:push -- --force
else
  echo "==> skip db:push (production — jalankan manual saat perlu)"
fi

# 4. Build production.
echo "==> npm run build"
npm run build

# 5. Reload PM2 (zero-downtime-ish). Kalau app belum pernah start, start dulu.
echo "==> pm2 reload $PM2_NAME"
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 reload "$PM2_NAME" --update-env
else
  pm2 start ecosystem.config.js --only "$PM2_NAME"
fi

pm2 save

echo "==> Deploy [$ENVIRONMENT] selesai."
