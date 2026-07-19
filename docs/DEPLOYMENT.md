# Deployment Guide — Hostinger KVM VPS

Panduan deploy booking-table ke Hostinger KVM 2 VPS (Ubuntu 22.04 / 24.04).

Stack target:
- Node.js 24 LTS (sama dengan local dev)
- PostgreSQL 16 (apt package)
- nginx reverse proxy + Let's Encrypt SSL
- PM2 untuk process management
- ufw firewall

Asumsi: VPS sudah ada, akses SSH root.

---

## 1. Persiapan Server

### Update sistem
```bash
apt update && apt upgrade -y
apt install -y curl git build-essential ufw
```

### Buat user non-root
```bash
adduser booking
usermod -aG sudo booking
# Copy SSH key
mkdir -p /home/booking/.ssh
cp ~/.ssh/authorized_keys /home/booking/.ssh/
chown -R booking:booking /home/booking/.ssh
chmod 700 /home/booking/.ssh
chmod 600 /home/booking/.ssh/authorized_keys
```

Sisa step jalanin sebagai user `booking` (tidak perlu root).

### Firewall
```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Port 5432 (Postgres) **jangan dibuka** — akan bind ke localhost saja.

---

## 2. Install Node.js 24

```bash
# NodeSource repo
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs

# Verify
node --version  # v24.x.x
npm --version
```

### PM2
```bash
sudo npm install -g pm2
pm2 startup systemd
# Jalankan command yang diprint pm2 sebagai sudo
```

---

## 3. Install PostgreSQL 16

```bash
sudo apt install -y postgresql-16 postgresql-contrib
sudo systemctl enable --now postgresql
```

### Setup database
```bash
sudo -u postgres psql <<'EOF'
CREATE DATABASE booking_table;
CREATE USER booking_app WITH PASSWORD 'GANTI_INI_PASSWORD_KUAT_32_CHAR_RANDOM';
GRANT ALL PRIVILEGES ON DATABASE booking_table TO booking_app;
\c booking_table
GRANT ALL ON SCHEMA public TO booking_app;
EOF
```

### Tighten config
Edit `/etc/postgresql/16/main/postgresql.conf`:
```
listen_addresses = 'localhost'
max_connections = 100
```

Edit `/etc/postgresql/16/main/pg_hba.conf` — pastikan baris `local` + `host` localhost only:
```
local   all   all                  scram-sha-256
host    all   all   127.0.0.1/32   scram-sha-256
host    all   all   ::1/128        scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

---

## 4. Clone & Build App

```bash
cd /home/booking
git clone https://github.com/YOUR/booking-table.git
cd booking-table
git checkout main  # atau branch production yang dipilih

npm ci  # install exact lockfile versions
```

### Setup environment

Copy template dan isi value production:
```bash
cp .env.example .env.local
nano .env.local
```

Isi:
- `DATABASE_URL=postgres://booking_app:PASSWORD@localhost:5432/booking_table`
- `AUTH_SECRET=` — generate dengan `openssl rand -base64 32`
- `AUTH_URL=https://booking.yourdomain.com`
- `RESEND_API_KEY=re_xxx` (dari Resend dashboard)
- `RESEND_FROM=noreply@yourdomain.com` (perlu verify domain di Resend dulu)
- `NEXT_PUBLIC_DEMO_MODE=false`
- `NEXT_PUBLIC_BAR_SLUG=soho-purwokerto` (slug bar default; cocokkan dgn seed)
- **Web Push (VAPID)** — generate sekali: `npx web-push generate-vapid-keys`
  - `NEXT_PUBLIC_VAPID_PUBLIC_KEY=` (public key)
  - `VAPID_PRIVATE_KEY=` (private key — JANGAN commit / bocor)
  - `VAPID_SUBJECT=mailto:you@yourdomain.com`
  - Catatan: Web Push hanya jalan di HTTPS (produksi pakai domain + TLS).

### Apply schema (migrasi DB)

**Sumber kebenaran skema = `src/lib/db/schema/`** (Drizzle). DB produksi yang
kosong dibangun LENGKAP sekali jalan dengan:
```bash
npm run db:push        # = drizzle-kit push
```
`push` mendiff schema TS ↔ DB dan membuat semua tabel/kolom/enum yang belum
ada. **Tidak perlu** menjalankan file `drizzle/*.sql` satu per satu.

> Soal file `drizzle/00XX_*.sql`: itu catatan perubahan inkremental yang ditulis
> tangan untuk DB **lokal yang sudah ada** (mis. `ALTER TYPE ... ADD VALUE` yang
> lebih aman dijalankan manual daripada lewat `push`). File 0001–0014 sengaja
> tidak ada — skema awal dibuat lewat `push`. Jadi menjalankan `*.sql` ke DB
> kosong akan gagal (0015 `ALTER TABLE` butuh tabel yang belum dibuat). Untuk
> produksi: pakai `db:push`, bukan `*.sql`.
>
> ⚠️ `push` bisa destruktif pada perubahan tertentu (drop kolom/rename) — selalu
> review prompt-nya sebelum konfirmasi di produksi.

### Seed data initial (bars/menu/floor/staff)
```bash
npm run db:seed        # = tsx scripts/seed.ts (IDEMPOTENT, aman diulang)
```
Skip otomatis bar yang sudah ada by slug. Termasuk data SOHO Social House +
admin RPC/master data (lihat `scripts/seed.ts`).

### Build production
```bash
npm run build
```

### Setup uploads directory (untuk avatar/story)

Production: simpan uploads di **luar project folder** supaya tidak ke-bundle
saat `next build` dan persistent saat update deployment.

```bash
sudo mkdir -p /var/lib/booking-table/uploads/{avatars,stories,photos,banners,menu}
sudo chown -R booking:booking /var/lib/booking-table
```

Tambah ke `.env.local`:
```
UPLOADS_DIR=/var/lib/booking-table/uploads
```

nginx akan serve folder ini langsung (bypass Next.js) — lihat section nginx
di bawah.

---

## 5. Run dengan PM2

`ecosystem.config.js` sudah ada di root repo (termasuk `kill_timeout` untuk
graceful shutdown — Next.js 16 menuntaskan in-flight request saat SIGTERM).
`cwd` default ke folder repo (`__dirname`), jadi tidak perlu di-edit kalau clone
langsung. Cukup jalankan dari root project:

```bash
pm2 start ecosystem.config.js
pm2 save
```

Verify: `pm2 status` — should show `online`.
Logs: `pm2 logs booking-table`.

---

## 6. nginx Reverse Proxy

```bash
sudo apt install -y nginx
```

Buat `/etc/nginx/sites-available/booking-table`:
```nginx
# User app (default)
server {
    listen 80;
    server_name booking.yourdomain.com;

    # Upload size limit (default nginx 1MB terlalu kecil untuk foto)
    client_max_body_size 10M;

    # SSE perlu special config — buffer off + long timeout
    location /api/realtime/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # SSE specific
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding on;
        proxy_read_timeout 24h;
        proxy_send_timeout 24h;
    }

    # User uploads (avatar, story) — serve langsung dari disk, bypass Next.js
    # Lebih cepat + hemat memory. Cache 1 hari di browser.
    location /uploads/ {
        alias /var/lib/booking-table/uploads/;
        expires 1d;
        add_header Cache-Control "public, immutable";
        access_log off;

        # Anti hotlink (optional — uncomment kalau perlu)
        # valid_referers none blocked booking.yourdomain.com;
        # if ($invalid_referer) { return 403; }
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}

# Admin panel (subdomain admin.*)
# Codebase sama, middleware Next.js detect host header & rewrite path
# ke /admin internally. Lihat src/middleware.ts.
server {
    listen 80;
    server_name admin.booking.yourdomain.com;

    client_max_body_size 10M;

    # Tetap proxy ke same Next.js port — middleware yang routing internal
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/booking-table /etc/nginx/sites-enabled/
sudo nginx -t  # test config
sudo systemctl reload nginx
```

### DNS records

Tambah 2 A record di DNS provider:
```
booking.yourdomain.com         A    <VPS_IP>
admin.booking.yourdomain.com   A    <VPS_IP>
```

Atau pakai CNAME wildcard kalau ingin support lebih banyak subdomain:
```
*.booking.yourdomain.com       A    <VPS_IP>
```

---

## 7. SSL via Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
# Sekaligus issue cert untuk user + admin subdomain
sudo certbot --nginx -d booking.yourdomain.com -d admin.booking.yourdomain.com
```

Auto-renew sudah di-setup via systemd timer. Verify:
```bash
sudo systemctl status certbot.timer
```

---

## 8. Resend Domain Setup (penting!)

Email dari `onboarding@resend.dev` cuma untuk dev. Production harus pakai
domain sendiri supaya:
- Tidak masuk Spam folder
- Branding email bener
- Tidak kena rate limit Resend test domain

Steps:
1. Resend dashboard → Domains → Add `yourdomain.com`
2. Tambah DNS records (DKIM, SPF, DMARC) yang ditampilkan Resend ke DNS
   provider kamu (Cloudflare/Hostinger DNS panel)
3. Tunggu propagation 5-30 menit, Resend auto-verify
4. Update `.env.local`: `RESEND_FROM=noreply@yourdomain.com`
5. Restart app: `pm2 restart booking-table`

---

## 8b. Cron Jobs (Story expire)

Story upload auto-expire 24 jam. Endpoint `/api/cron/expire-stories` hapus
row + file dari storage. Trigger dengan systemd timer (atau PM2 cron module).

### Setup systemd timer

Bikin service file `/etc/systemd/system/booking-cron-stories.service`:
```ini
[Unit]
Description=Expire booking-table stories
After=network.target

[Service]
Type=oneshot
EnvironmentFile=/home/booking/booking-table/.env.local
ExecStart=/usr/bin/curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://booking.yourdomain.com/api/cron/expire-stories
```

Timer file `/etc/systemd/system/booking-cron-stories.timer`:
```ini
[Unit]
Description=Run booking-table story expire every 15 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=15min

[Install]
WantedBy=timers.target
```

Enable + start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now booking-cron-stories.timer
sudo systemctl status booking-cron-stories.timer
```

Cek log eksekusi:
```bash
sudo journalctl -u booking-cron-stories.service -n 20
```

Untuk story service yang lebih agresif (expire dalam menit, bukan jam),
ubah `OnUnitActiveSec=5min` di timer file.

---

## 9. Backup Strategy

Backup database harian via cron:
```bash
sudo crontab -e
```

Tambah:
```
0 3 * * * sudo -u postgres pg_dump booking_table | gzip > /home/booking/backups/db-$(date +\%Y\%m\%d).sql.gz
0 4 * * 0 find /home/booking/backups -name "db-*.sql.gz" -mtime +30 -delete
```

Bikin folder backup:
```bash
mkdir -p /home/booking/backups
```

Sync ke off-site (S3/Backblaze) recommended tapi optional untuk MVP.

---

## 10. Update Deployment

Saat ada update di repo:
```bash
cd /home/booking/booking-table
git pull
npm ci
npm run db:push  # apply schema changes (review prompt kalau ada destructive!)
npm run build
pm2 restart booking-table
```

Untuk zero-downtime deploy lebih advanced, pakai PM2 cluster mode + reload
(perlu code refactor supaya state-free per instance).

---

## 11. Staging + Production (1 VPS, GitHub Actions CI/CD)

Section 1–10 di atas = setup **single environment**. Bagian ini memperluas jadi
**2 environment di 1 VPS** — staging (test) & production — dengan deploy
otomatis via GitHub Actions.

**Ringkasan arsitektur:**

```
VPS (Ubuntu)
├─ Postgres 16 (1 instance, 2 database)
│   ├─ soho_prod       (user soho_prod)
│   └─ soho_staging    (user soho_staging)
├─ /home/booking/soho-prod/     branch main     → PM2 "soho-prod"    PORT 3000
├─ /home/booking/soho-staging/  branch staging  → PM2 "soho-staging" PORT 3001
├─ /var/lib/soho-prod/uploads   +  /var/lib/soho-staging/uploads
└─ Nginx:
     bookingsoho.com / admin.bookingsoho.com                 → :3000
     staging.bookingsoho.com / admin.staging.bookingsoho.com → :3001
```

> Ganti `bookingsoho.com` dengan domain final saat DNS siap. Sebelum domain
> ada, staging bisa diakses sementara lewat `http://<VPS_IP>:3001` (buka port
> 3001 di ufw sementara, tutup lagi setelah domain + Nginx jalan).

Git flow: feature branch → merge ke `staging` (auto-deploy, test) → merge ke
`main` (auto-deploy production).

### 11.1 Buat branch staging (sekali)

Di lokal:
```bash
git checkout main && git pull
git checkout -b staging
git push -u origin staging
```

### 11.2 Dua database + user Postgres

```bash
sudo -u postgres psql <<'EOF'
CREATE DATABASE soho_prod;
CREATE USER soho_prod WITH PASSWORD 'GANTI_PASSWORD_PROD_32_CHAR_RANDOM';
GRANT ALL PRIVILEGES ON DATABASE soho_prod TO soho_prod;
\c soho_prod
GRANT ALL ON SCHEMA public TO soho_prod;

CREATE DATABASE soho_staging;
CREATE USER soho_staging WITH PASSWORD 'GANTI_PASSWORD_STAGING_32_CHAR_RANDOM';
GRANT ALL PRIVILEGES ON DATABASE soho_staging TO soho_staging;
\c soho_staging
GRANT ALL ON SCHEMA public TO soho_staging;
EOF
```

Tetap bind Postgres ke localhost saja (section 3).

### 11.3 Clone 2 folder + `.env.local` per environment

```bash
cd /home/booking

# Production (branch main)
git clone https://github.com/safkifajar/booking-table.git soho-prod
cd soho-prod && git checkout main && cd ..

# Staging (branch staging)
git clone https://github.com/safkifajar/booking-table.git soho-staging
cd soho-staging && git checkout staging && cd ..
```

**`.env.local` production** (`/home/booking/soho-prod/.env.local`):
```
DATABASE_URL=postgres://soho_prod:PASSWORD_PROD@localhost:5432/soho_prod
AUTH_SECRET=<openssl rand -base64 32 — khusus prod>
AUTH_URL=https://bookingsoho.com
RESEND_API_KEY=re_xxx
RESEND_FROM=noreply@bookingsoho.com
NEXT_PUBLIC_BAR_SLUG=soho-purwokerto
NEXT_PUBLIC_DEMO_MODE=false
CRON_SECRET=<openssl rand -base64 32 — khusus prod>
STORAGE_DRIVER=local
UPLOADS_DIR=/var/lib/soho-prod/uploads
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<vapid public>
VAPID_PRIVATE_KEY=<vapid private>
VAPID_SUBJECT=mailto:you@bookingsoho.com
```

**`.env.local` staging** (`/home/booking/soho-staging/.env.local`) — nilai BEDA:
```
DATABASE_URL=postgres://soho_staging:PASSWORD_STAGING@localhost:5432/soho_staging
AUTH_SECRET=<secret berbeda dari prod>
AUTH_URL=https://staging.bookingsoho.com
RESEND_API_KEY=re_xxx
RESEND_FROM=onboarding@resend.dev        # staging boleh pakai test domain
NEXT_PUBLIC_BAR_SLUG=soho-purwokerto
NEXT_PUBLIC_DEMO_MODE=true                # staging boleh demo mode
CRON_SECRET=<secret berbeda dari prod>
STORAGE_DRIVER=local
UPLOADS_DIR=/var/lib/soho-staging/uploads
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<vapid public — boleh keypair beda>
VAPID_PRIVATE_KEY=<vapid private>
VAPID_SUBJECT=mailto:you@bookingsoho.com
```

> Yang WAJIB beda antar env: `DATABASE_URL`, `AUTH_URL`, `UPLOADS_DIR`,
> `AUTH_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_DEMO_MODE`. Kalau `AUTH_URL` salah,
> redirect login / cookie / magic-link / URL admin (`admin.`) tidak resolve.

### 11.4 Folder uploads persistent per-env

```bash
sudo mkdir -p /var/lib/soho-prod/uploads/{avatars,stories,photos,banners,menu}
sudo mkdir -p /var/lib/soho-staging/uploads/{avatars,stories,photos,banners,menu}
sudo chown -R booking:booking /var/lib/soho-prod /var/lib/soho-staging
```

### 11.5 First run kedua environment

```bash
# Production
cd /home/booking/soho-prod
npm ci
npm run db:push        # bangun skema DB prod (review prompt!)
npm run db:seed        # seed data awal (idempotent)
npm run build

# Staging
cd /home/booking/soho-staging
npm ci
npm run db:push -- --force
npm run db:seed
npm run build

# Start keduanya via PM2 (ecosystem.config.js sudah punya 2 app)
cd /home/booking/soho-prod            # cwd bebas, config absolut
pm2 start /home/booking/soho-prod/ecosystem.config.js --only soho-prod
pm2 start /home/booking/soho-prod/ecosystem.config.js --only soho-staging
pm2 save
pm2 status                            # soho-prod (3000) & soho-staging (3001) online
```

### 11.6 Nginx — 4 server block

Tambah ke `/etc/nginx/sites-available/booking-table` (atau file terpisah).
Pola SSE + `/uploads/` + subdomain sama seperti section 6; yang beda cuma
`server_name` dan `proxy_pass` port + `alias` uploads per-env.

```nginx
# ---------- PRODUCTION (:3000) ----------
server {
    listen 80;
    server_name bookingsoho.com;
    client_max_body_size 10M;

    location /api/realtime/ {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off; proxy_cache off; chunked_transfer_encoding on;
        proxy_read_timeout 24h; proxy_send_timeout 24h;
    }
    location /uploads/ {
        alias /var/lib/soho-prod/uploads/;
        expires 1d; add_header Cache-Control "public, immutable"; access_log off;
    }
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
server {                              # admin prod → port sama, middleware routing
    listen 80;
    server_name admin.bookingsoho.com;
    client_max_body_size 10M;
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# ---------- STAGING (:3001) ----------
server {
    listen 80;
    server_name staging.bookingsoho.com;
    client_max_body_size 10M;

    location /api/realtime/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off; proxy_cache off; chunked_transfer_encoding on;
        proxy_read_timeout 24h; proxy_send_timeout 24h;
    }
    location /uploads/ {
        alias /var/lib/soho-staging/uploads/;
        expires 1d; add_header Cache-Control "public, immutable"; access_log off;
    }
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_cache_bypass $http_upgrade;
    }
}
server {                              # admin staging → port 3001
    listen 80;
    server_name admin.staging.bookingsoho.com;
    client_max_body_size 10M;
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 11.7 DNS + SSL (4 domain)

DNS A record (semua ke IP VPS yang sama):
```
bookingsoho.com                 A  <VPS_IP>
admin.bookingsoho.com           A  <VPS_IP>
staging.bookingsoho.com         A  <VPS_IP>
admin.staging.bookingsoho.com   A  <VPS_IP>
```
(atau wildcard `*.bookingsoho.com` + `*.staging.bookingsoho.com`.)

SSL sekaligus 4 domain:
```bash
sudo certbot --nginx \
  -d bookingsoho.com -d admin.bookingsoho.com \
  -d staging.bookingsoho.com -d admin.staging.bookingsoho.com
```

### 11.8 GitHub Actions — auto-deploy

Workflow sudah ada di repo:
- `.github/workflows/deploy-staging.yml` — push ke `staging` → SSH → `scripts/deploy.sh staging` (auto `db:push --force`, tanpa backup).
- `.github/workflows/deploy-production.yml` — push/merge ke `main` → SSH → `scripts/deploy.sh production` (backup `pg_dump` dulu → auto `db:push --force`).

Build dijalankan **di VPS**, bukan di runner GitHub → kuota Actions nyaris nol.

**Setup deploy SSH key (di VPS, sebagai user `booking`):**
```bash
ssh-keygen -t ed25519 -f ~/.ssh/gha_deploy -N "" -C "github-actions-deploy"
cat ~/.ssh/gha_deploy.pub >> ~/.ssh/authorized_keys   # izinkan key ini login
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/gha_deploy                                  # PRIVATE key → copy ke GitHub Secret
```

**Isi GitHub repo Secrets** (`Settings → Secrets and variables → Actions → New repository secret`):

| Secret | Nilai |
|---|---|
| `VPS_HOST` | IP / hostname VPS (mis. `123.45.67.89`) |
| `VPS_USER` | `booking` |
| `VPS_SSH_KEY` | isi lengkap `~/.ssh/gha_deploy` (private key, termasuk baris BEGIN/END) |

> `scripts/deploy.sh` sudah di-mark executable di git (mode 100755), jadi hasil
> clone di VPS otomatis executable. Kalau ternyata tidak (mis. filesystem tak
> dukung), jalankan sekali:
> `chmod +x /home/booking/soho-*/scripts/deploy.sh`

Setelah secret terisi: push ke `staging` → tab **Actions** harus hijau → cek
`pm2 status` di VPS.

### 11.9 Migrasi production (otomatis + backup)

Production migrasi DB **otomatis** (`db:push --force`) saat deploy, tapi
`scripts/deploy.sh` selalu **backup DB dulu** (`pg_dump` → `~/backups/`,
timestamp, di-gzip, disimpan 14 hari) sebelum push. Jadi kamu **tidak perlu
SSH manual** — cukup merge ke `main`.

Syarat: `pg_dump` tersedia di VPS (sudah otomatis ada kalau install
`postgresql-16`). Backup dijalankan sebagai user `booking` — pastikan user itu
bisa `pg_dump` ke DB `soho_prod` (kalau `DATABASE_URL` sudah benar, otomatis
bisa lewat connection string).

**Restore kalau ada masalah** (mis. push tak sengaja hapus kolom):
```bash
ssh booking@<VPS_IP>
ls -lt ~/backups/                    # cari backup sebelum deploy bermasalah
# ambil DATABASE_URL dari .env.local, lalu:
gunzip < ~/backups/soho-prod-YYYYMMDD-HHMMSS.sql.gz | psql "<DATABASE_URL soho_prod>"
pm2 reload soho-prod
```

> Meski otomatis, tetap **hati-hati perubahan skema destruktif** (drop/rename
> kolom). Kalau rilis mengandung itu, lebih aman test di **staging** dulu
> (merge ke `staging`, cek datanya) sebelum merge ke `main`.

### 11.10 Cron per-environment

Section 8b bikin 1 timer. Untuk 2 env, buat 2 pasang service+timer (beda
`EnvironmentFile` + URL). Contoh production:
`/etc/systemd/system/soho-prod-stories.service`:
```ini
[Service]
Type=oneshot
EnvironmentFile=/home/booking/soho-prod/.env.local
ExecStart=/usr/bin/curl -fsS -X POST -H "Authorization: Bearer ${CRON_SECRET}" \
  https://bookingsoho.com/api/cron/expire-stories
```
Staging: `EnvironmentFile=/home/booking/soho-staging/.env.local` + URL
`https://staging.bookingsoho.com/...`. Masing-masing punya timer sendiri
(`soho-prod-stories.timer`, `soho-staging-stories.timer`).

---

## Troubleshooting

### App tidak start
```bash
pm2 logs booking-table --lines 100
```

### Database connection refused
```bash
sudo systemctl status postgresql
sudo -u postgres psql -d booking_table -c "SELECT 1"  # test connection
```

### Magic link tidak masuk inbox
- Cek Resend dashboard logs: ada error apa?
- Cek folder Spam (terutama awal-awal sebelum domain reputation terbentuk)
- Pastikan `RESEND_FROM` pakai domain yang sudah verified

### SSE tidak jalan
- Browser DevTools Network: filter `realtime`, harus ada koneksi pending
- Cek nginx: `sudo nginx -t` + reload kalau ada perubahan config
- Pastikan `proxy_buffering off` di location `/api/realtime/`

### Memory tinggi
- PM2 sudah set `max_memory_restart: '1G'` — auto-restart kalau lewat
- Cek leak: `pm2 monit`

---

## Production Checklist

Sebelum go-live:

- [ ] `AUTH_SECRET` regenerated (jangan reuse dev value)
- [ ] `AUTH_URL` set ke domain production https://
- [ ] `NEXT_PUBLIC_DEMO_MODE=false` di `.env.local`
- [ ] Database password kuat (32+ chars random)
- [ ] Postgres bind ke localhost saja (jangan expose publik)
- [ ] Resend domain verified, `RESEND_FROM` pakai domain sendiri
- [ ] SSL certificate aktif (test: https://yourdomain.com)
- [ ] Firewall: cuma 22, 80, 443 yang open
- [ ] Backup cron berjalan (cek `crontab -l` + `ls backups/`)
- [ ] PM2 startup hook ter-install (`pm2 startup` + `pm2 save`)
- [ ] Test full flow: signup credentials, signin, magic link, open table,
      add item, payment, close session, rate member
- [ ] Test 2-tab realtime: SSE update across tabs <1s

### Tambahan kalau pakai staging + production (section 11)

- [ ] 2 database terpisah (`soho_prod`, `soho_staging`) + user + password beda
- [ ] `.env.local` beda per folder — `AUTH_URL`, `DATABASE_URL`, `UPLOADS_DIR`,
      `AUTH_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_DEMO_MODE` tidak tertukar
- [ ] `UPLOADS_DIR` prod ≠ staging (upload staging tidak nyampur ke prod)
- [ ] PM2: `soho-prod` (3000) & `soho-staging` (3001) keduanya `online`
- [ ] Nginx 4 server block + SSL 4 domain aktif
- [ ] Branch `staging` sudah ada di remote
- [ ] GitHub Secrets terisi: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`
- [ ] `scripts/deploy.sh` executable di kedua folder VPS
- [ ] Test: push ke `staging` → Actions hijau → staging ter-update
- [ ] Test: merge ke `main` → Actions hijau → prod ter-update (migrasi +
      backup DB otomatis; cek `~/backups/` ada file baru)
- [ ] `pg_dump` tersedia di VPS + user `booking` bisa dump DB `soho_prod`
