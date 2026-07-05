#!/usr/bin/env bash
#
# setup-production.sh — setup AWAL environment production di VPS (sekali jalan).
#
# Beda dari deploy.sh: deploy.sh meng-UPDATE app yg sudah ada. Skrip ini
# menyiapkan production dari NOL: clone, DB + user, .env.local, migrasi penuh
# (tabel + RPC), build, PM2 start. Setelahnya cukup pakai deploy.sh / CI-CD.
#
# IDEMPOTENT sebisa mungkin: aman diulang. Langkah yg sudah ada di-skip.
#
# JALANKAN DI VPS sebagai user 'booking' (yg punya folder app):
#   bash setup-production.sh
#
# Yang skrip ini TIDAK lakukan (sengaja, butuh root / manual sekali):
#   - Buat OS user, install Node/PostgreSQL/nginx, konfig nginx server block,
#     certbot HTTPS. Itu di panduan Word (langkah root, sekali seumur hidup VPS).
#
# ============================================================================

set -euo pipefail

# --- Konfigurasi (samakan dgn staging supaya konsisten) ---
APP_DIR="/home/booking/soho-prod"
REPO_URL="${REPO_URL:-}"           # opsional: kalau folder belum ada, clone dari sini
BRANCH="main"
DB_NAME="soho_prod"
DB_USER="soho_prod"                 # user DB khusus prod (bukan superuser postgres)
PM2_NAME="soho-prod"
DOMAIN="ratssocial.com"
UPLOADS_DIR="/var/lib/booking-table/uploads-prod"

echo "======================================================"
echo "  SETUP PRODUCTION — $DOMAIN"
echo "  App dir : $APP_DIR"
echo "  DB      : $DB_NAME (user $DB_USER)"
echo "======================================================"
echo ""

# ============================================================================
# 1. FOLDER APP — clone kalau belum ada
# ============================================================================
if [ ! -d "$APP_DIR/.git" ]; then
  if [ -z "$REPO_URL" ]; then
    echo "ERROR: $APP_DIR belum ada & REPO_URL tak di-set." >&2
    echo "       Jalankan: REPO_URL=git@github.com:USER/REPO.git bash setup-production.sh" >&2
    exit 1
  fi
  echo "==> [1] Clone repo ke $APP_DIR (branch $BRANCH)"
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
else
  echo "==> [1] Folder app sudah ada — sync ke origin/$BRANCH"
  git -C "$APP_DIR" fetch --prune origin "$BRANCH"
  git -C "$APP_DIR" checkout "$BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$BRANCH"
fi
cd "$APP_DIR"

# ============================================================================
# 2. DATABASE — buat DB + user (idempotent)
# ============================================================================
# Butuh akses psql sbg superuser (postgres). Skrip pakai `sudo -u postgres psql`.
# Password DB di-generate acak (hex, TANPA karakter '#' yg bikin .env.local rusak).
echo ""
echo "==> [2] Setup database $DB_NAME + user $DB_USER"

# Cek apakah user DB sudah ada
USER_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" || true)"
if [ "$USER_EXISTS" = "1" ]; then
  echo "    user '$DB_USER' sudah ada — pakai password existing dari .env.local (kalau ada)."
  DB_PASS=""   # jangan reset password kalau user sudah ada (hindari putus koneksi)
else
  DB_PASS="$(openssl rand -hex 24)"   # hex = huruf+angka saja, aman utk .env.local
  sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';"
  echo "    user '$DB_USER' dibuat."
fi

# Cek apakah DB sudah ada
DB_EXISTS="$(sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" || true)"
if [ "$DB_EXISTS" = "1" ]; then
  echo "    database '$DB_NAME' sudah ada."
else
  sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
  echo "    database '$DB_NAME' dibuat (owner $DB_USER)."
fi
# Pastikan privileges (aman diulang)
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;" >/dev/null

# ============================================================================
# 3. .env.local — buat kalau belum ada (JANGAN timpa yg sudah ada)
# ============================================================================
echo ""
echo "==> [3] Siapkan .env.local production"
if [ -f "$APP_DIR/.env.local" ]; then
  echo "    .env.local SUDAH ADA — tidak ditimpa (jaga secret existing)."
  echo "    Kalau perlu ubah, edit manual: nano $APP_DIR/.env.local"
else
  if [ -z "${DB_PASS:-}" ]; then
    echo "ERROR: user DB sudah ada tapi .env.local belum — tak tahu password DB." >&2
    echo "       Reset password: sudo -u postgres psql -c \"ALTER USER $DB_USER WITH PASSWORD 'BARU';\"" >&2
    echo "       lalu buat .env.local manual (copy dari .env.example)." >&2
    exit 1
  fi
  AUTH_SECRET="$(openssl rand -base64 32)"
  CRON_SECRET="$(openssl rand -base64 32)"
  cat > "$APP_DIR/.env.local" <<ENVEOF
# === PRODUCTION — $DOMAIN (generated $(date +%Y-%m-%d)) ===
DATABASE_URL=postgres://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
AUTH_SECRET=$AUTH_SECRET
AUTH_URL=https://$DOMAIN
CRON_SECRET=$CRON_SECRET
STORAGE_DRIVER=local
UPLOADS_DIR=$UPLOADS_DIR
NEXT_PUBLIC_BAR_SLUG=soho-purwokerto
NEXT_PUBLIC_DEMO_MODE=false

# Gerbang "Segera Hadir" — set false saat siap buka ke user.
MAINTENANCE_MODE=true

# --- ISI MANUAL (email & web push) ---
RESEND_API_KEY=re_CHANGE_ME
RESEND_FROM=noreply@$DOMAIN
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@$DOMAIN
ENVEOF
  echo "    .env.local dibuat. DB password & secret di-generate otomatis."
  echo "    ⚠️  ISI MANUAL: RESEND_API_KEY, VAPID keys (lihat panduan Word)."
fi

# ============================================================================
# 4. FOLDER UPLOADS — persistent, di luar app dir
# ============================================================================
echo ""
echo "==> [4] Folder uploads persistent: $UPLOADS_DIR"
mkdir -p "$UPLOADS_DIR"
echo "    OK."

# ============================================================================
# 5. DEPENDENCIES
# ============================================================================
echo ""
echo "==> [5] npm ci"
npm ci

# ============================================================================
# 6. MIGRASI DB — tabel (db:push) + RPC/trigger (apply-sql)
# ============================================================================
echo ""
echo "==> [6] Migrasi skema: db:push + apply-sql (RPC/trigger/constraint)"
npm run db:push -- --force
bash "$APP_DIR/scripts/apply-sql.sh"

# ============================================================================
# 7. SEED master data (bar/menu/meja awal) — idempotent, skip kalau bar ada
# ============================================================================
echo ""
echo "==> [7] Seed master data (idempotent)"
npm run db:seed || echo "    (seed skip/gagal — cek manual kalau perlu)"

# ============================================================================
# 8. BUILD
# ============================================================================
echo ""
echo "==> [8] npm run build"
npm run build

# ============================================================================
# 9. PM2 — start (fork mode + TZ dari ecosystem.config.js)
# ============================================================================
echo ""
echo "==> [9] PM2 start $PM2_NAME"
if pm2 describe "$PM2_NAME" > /dev/null 2>&1; then
  # Restart BERSIH (delete+start) supaya env (TZ) benar-benar termuat.
  pm2 delete "$PM2_NAME"
fi
pm2 start ecosystem.config.js --only "$PM2_NAME"
pm2 save

echo ""
echo "======================================================"
echo "  ✅ SETUP PRODUCTION SELESAI"
echo "======================================================"
echo "  Verifikasi:"
echo "   - pm2 status              → $PM2_NAME online (mode fork)"
echo "   - pm2 env <id> | grep TZ  → Asia/Jakarta"
echo "   - buka https://admin.$DOMAIN → login & setup bar/menu/meja"
echo ""
echo "  MAINTENANCE_MODE=true → customer lihat 'Segera Hadir'."
echo "  Saat siap buka: set MAINTENANCE_MODE=false di .env.local,"
echo "  lalu: pm2 restart $PM2_NAME --update-env"
echo "======================================================"
