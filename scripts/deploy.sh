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
# - PRODUCTION: db:push OTOMATIS, tapi DIDAHULUI backup pg_dump (jaring pengaman
#   kalau perubahan skema tak sengaja destruktif). Backup ke ~/backups/.
# - STAGING: db:push --force tanpa backup (DB test, tak masalah).
# - Kalau `npm run build` gagal, script berhenti (set -e) SEBELUM pm2 reload,
#   jadi versi lama tetap online (tidak ada downtime karena build rusak).

set -euo pipefail

ENVIRONMENT="${1:-}"

case "$ENVIRONMENT" in
  staging)
    APP_DIR="/home/booking/soho-staging"
    PM2_NAME="soho-staging"
    BRANCH="staging"
    BACKUP_BEFORE_MIGRATE="false"
    ;;
  production)
    APP_DIR="/home/booking/soho-prod"
    PM2_NAME="soho-prod"
    BRANCH="main"
    BACKUP_BEFORE_MIGRATE="true"
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

# 3. Backup DB (production saja) — jaring pengaman sebelum migrasi.
#    Baca DATABASE_URL dari .env.local, pg_dump ke ~/backups/ (timestamp),
#    lalu buang backup >14 hari. Butuh `date` — CI SSH punya. Timestamp
#    di-generate di VPS (bukan hardcode).
if [ "$BACKUP_BEFORE_MIGRATE" = "true" ]; then
  echo "==> backup DB sebelum migrasi"
  DB_URL="$(grep -E '^DATABASE_URL=' .env.local | head -n1 | cut -d= -f2-)"
  if [ -z "$DB_URL" ]; then
    echo "ERROR: DATABASE_URL tidak ditemukan di $APP_DIR/.env.local" >&2
    exit 1
  fi
  BACKUP_DIR="$HOME/backups"
  mkdir -p "$BACKUP_DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  BACKUP_FILE="$BACKUP_DIR/soho-prod-$STAMP.sql.gz"
  # pg_dump pakai connection string langsung; gzip supaya hemat disk.
  pg_dump "$DB_URL" | gzip > "$BACKUP_FILE"
  echo "    backup: $BACKUP_FILE"
  # Simpan 14 hari terakhir saja.
  find "$BACKUP_DIR" -name 'soho-prod-*.sql.gz' -mtime +14 -delete 2>/dev/null || true
fi

# 4. Migrasi DB — db:push --force (staging & production).
echo "==> db:push --force"
npm run db:push -- --force

# 5. Build production.
echo "==> npm run build"
npm run build

# 6. Reload PM2 (zero-downtime-ish). Kalau app belum pernah start, start dulu.
echo "==> pm2 reload $PM2_NAME"
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  pm2 reload "$PM2_NAME" --update-env
else
  pm2 start ecosystem.config.js --only "$PM2_NAME"
fi

pm2 save

echo "==> Deploy [$ENVIRONMENT] selesai."
