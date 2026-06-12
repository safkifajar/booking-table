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

### Apply schema
```bash
npx drizzle-kit push
```

Ini bikin semua tables. Untuk seed data initial (bars/menu/etc):
```bash
# Edit supabase/migrations/0002_seed.sql kalau perlu adjustment
sudo -u postgres psql -d booking_table -f supabase/migrations/0002_seed.sql
```

(Note: migration files masih di folder `supabase/migrations/` dari fase Supabase
sebelumnya, isinya SQL biasa — tidak butuh Supabase. Rename folder kalau mau
bersih.)

### Apply admin RPC functions
```bash
sudo -u postgres psql -d booking_table -f supabase/migrations/0012_admin_reports.sql
```

(Required untuk admin sales reports — lihat src/lib/admin.ts.)

### Build production
```bash
npm run build
```

### Setup uploads directory (untuk avatar/story)

Production: simpan uploads di **luar project folder** supaya tidak ke-bundle
saat `next build` dan persistent saat update deployment.

```bash
sudo mkdir -p /var/lib/booking-table/uploads/avatars
sudo mkdir -p /var/lib/booking-table/uploads/stories
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

Buat `ecosystem.config.js` di root project:
```js
module.exports = {
  apps: [{
    name: 'booking-table',
    script: 'npm',
    args: 'start',
    cwd: '/home/booking/booking-table',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    max_memory_restart: '1G',
    instances: 1,
    autorestart: true,
  }]
};
```

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
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/booking-table /etc/nginx/sites-enabled/
sudo nginx -t  # test config
sudo systemctl reload nginx
```

---

## 7. SSL via Let's Encrypt

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d booking.yourdomain.com
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
npx drizzle-kit push  # apply schema changes (review dulu kalau ada destructive!)
npm run build
pm2 restart booking-table
```

Untuk zero-downtime deploy lebih advanced, pakai PM2 cluster mode + reload
(perlu code refactor supaya state-free per instance).

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
