#!/usr/bin/env bash
#
# apply-sql.sh — jalankan file SQL "berfungsi" yang db:push TIDAK tangani.
#
# Masalah yang dipecahkan:
#   `drizzle-kit push` cuma sinkronkan SKEMA TABEL (dari schema/*.ts). File SQL
#   bernomor di drizzle/ yang isinya FUNCTION / TRIGGER / EXCLUDE constraint /
#   EXTENSION (RPC admin, anti double-booking, dll) TIDAK ikut dijalankan.
#   Tanpa ini: admin panel 500 (RPC hilang), race double-booking lolos, dsb.
#
# Solusi: skrip ini menjalankan SEMUA file SQL yang mengandung konstruksi
#   tersebut, BERURUTAN (0015 → 0052 → dst), langsung ke DATABASE_URL.
#
# IDEMPOTENT: aman dijalankan berulang tiap deploy.
#   - FUNCTION pakai CREATE OR REPLACE (+ DROP IF EXISTS) → aman diulang.
#   - EXTENSION pakai IF NOT EXISTS → aman.
#   - EXCLUDE/ADD CONSTRAINT tak punya guard → kalau sudah ada, PostgreSQL
#     error "already exists". Itu HARMLESS (objek sudah ada) → skrip lanjut,
#     tidak menggagalkan deploy. Error LAIN (syntax, dll) tetap ditampilkan.
#
# Nambah fitur + SQL baru (mis. 0053)? Cukup taruh file .sql di drizzle/ yg
#   mengandung FUNCTION/TRIGGER/EXCLUDE → otomatis ke-apply saat deploy
#   berikutnya. TIDAK perlu jalankan manual lagi.
#
# Dipanggil oleh deploy.sh (otomatis) atau manual:
#   DATABASE_URL="postgresql://..." ./scripts/apply-sql.sh
#   # atau, dari folder app yg punya .env.local:
#   ./scripts/apply-sql.sh          # baca DATABASE_URL dari ./.env.local

set -uo pipefail   # NB: sengaja TANPA -e — kita tangani error per-file sendiri.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRIZZLE_DIR="$SCRIPT_DIR/../drizzle"

# --- Resolusi DATABASE_URL: dari env, atau dari .env.local di cwd ---
DB_URL="${DATABASE_URL:-}"
if [ -z "$DB_URL" ] && [ -f ".env.local" ]; then
  DB_URL="$(grep -E '^DATABASE_URL=' .env.local | head -n1 | cut -d= -f2- | tr -d '"')"
fi
if [ -z "$DB_URL" ]; then
  echo "ERROR: DATABASE_URL tidak di-set (env) dan .env.local tak ditemukan." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql tidak terpasang. Install: apt-get install -y postgresql-client" >&2
  exit 1
fi

echo "==> apply-sql: cari file SQL berfungsi (FUNCTION/TRIGGER/EXCLUDE/EXTENSION)"

applied=0
skipped_harmless=0
hard_fail=0

# Iterasi file .sql BERURUTAN (glob sudah terurut: 0015, 0016, ...).
for f in "$DRIZZLE_DIR"/*.sql; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"

  # Hanya file yg mengandung konstruksi yg db:push LEWATI. File yg cuma
  # ALTER TABLE / ADD COLUMN sudah ditangani db:push → SKIP (hindari duplikasi).
  if ! grep -qiE "CREATE (OR REPLACE )?FUNCTION|CREATE TRIGGER|EXCLUDE USING|CREATE EXTENSION" "$f"; then
    continue
  fi

  echo "    → $base"
  # ON_ERROR_STOP=1: hentikan file di error pertama (jgn jalankan statement
  # rusak berikutnya). Tangkap output utk deteksi error "harmless".
  out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"
  rc=$?

  if [ $rc -eq 0 ]; then
    applied=$((applied + 1))
    continue
  fi

  # Error idempotency yang AMAN diabaikan (objek sudah ada dari deploy sebelumnya).
  if echo "$out" | grep -qiE "already exists|duplicate (object|key)"; then
    echo "        (sudah ada — dilewati, aman)"
    skipped_harmless=$((skipped_harmless + 1))
    continue
  fi

  # Error sungguhan → tampilkan, tandai gagal.
  echo "        !! GAGAL ($base):" >&2
  echo "$out" | sed 's/^/        /' >&2
  hard_fail=$((hard_fail + 1))
done

echo "==> apply-sql selesai: $applied diterapkan, $skipped_harmless sudah-ada, $hard_fail gagal"

if [ "$hard_fail" -gt 0 ]; then
  echo "ERROR: ada $hard_fail file SQL gagal (bukan 'already exists'). Cek log di atas." >&2
  exit 1
fi
