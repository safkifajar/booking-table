#!/usr/bin/env bash
#
# pre-migrate.sh — jalankan file DDL yang HARUS berjalan SEBELUM `db:push`.
#
# Masalah yang dipecahkan:
#   `drizzle-kit push --force` bersifat interaktif untuk operasi yang ia anggap
#   berisiko kehilangan data — mis. menambah UNIQUE constraint pada tabel yang
#   sudah berisi baris. Ia memunculkan prompt "Do you want to truncate <table>?"
#   yang butuh TTY. Di CI (SSH non-interaktif) prompt ini MENGGANTUNG deploy.
#
# Solusi:
#   File DDL yang idempotent (ADD COLUMN IF NOT EXISTS, ADD CONSTRAINT via cek
#   pg_constraint, dll) dijalankan DULU di sini. Setelah kolom + constraint ada,
#   `db:push` melihat skema sudah sinkron → tak ada perubahan destruktif →
#   TIDAK memunculkan prompt.
#
# Konvensi:
#   File di drizzle/ yang mengandung penanda "-- pre-migrate" (di komentar mana
#   pun) akan dijalankan di sini, BERURUTAN (0055 → 0056 → ...). File tanpa
#   penanda tidak disentuh (ditangani db:push / apply-sql seperti biasa).
#
# IDEMPOTENT: aman dijalankan berulang tiap deploy. File DDL WAJIB ditulis
#   idempotent (IF NOT EXISTS / cek pg_constraint) — kalau tidak, deploy kedua
#   akan error "already exists" dan menggagalkan rilis.
#
# Dipanggil oleh deploy.sh (otomatis, sebelum db:push) atau manual:
#   DATABASE_URL="postgresql://..." ./scripts/pre-migrate.sh

set -uo pipefail   # tangani error per-file sendiri (tanpa -e).

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

echo "==> pre-migrate: cari file DDL bertanda '-- pre-migrate'"

applied=0
hard_fail=0

# Iterasi file .sql BERURUTAN (glob sudah terurut: 0055, 0056, ...).
for f in "$DRIZZLE_DIR"/*.sql; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"

  # Hanya file yang secara eksplisit menandai dirinya pre-migrate.
  if ! grep -qiE -- "-- pre-migrate" "$f"; then
    continue
  fi

  echo "    → $base"
  out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$f" 2>&1)"
  rc=$?

  if [ $rc -eq 0 ]; then
    applied=$((applied + 1))
    continue
  fi

  # File pre-migrate WAJIB idempotent — "already exists" seharusnya tak terjadi,
  # tapi kalau muncul (mis. constraint dibuat manual sebelumnya) tetap harmless.
  if echo "$out" | grep -qiE "already exists|duplicate (object|key)"; then
    echo "        (sudah ada — dilewati, aman)"
    applied=$((applied + 1))
    continue
  fi

  echo "        !! GAGAL ($base):" >&2
  echo "$out" | sed 's/^/        /' >&2
  hard_fail=$((hard_fail + 1))
done

echo "==> pre-migrate selesai: $applied diterapkan, $hard_fail gagal"

if [ "$hard_fail" -gt 0 ]; then
  echo "ERROR: ada $hard_fail file pre-migrate gagal. Cek log di atas." >&2
  exit 1
fi
