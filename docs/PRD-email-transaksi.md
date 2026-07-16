# PRD — Email Transaksi via SMTP

**Status:** FINAL — semua GAP diputuskan (2026-07-16, via diskusi)
**Tanggal:** 2026-07-16
**Pemicu:** permintaan user — "kirim email setiap selesai transaksi (open table, bayar order) ke email user, pakai SMTP agar gratis."

---

## 1. Ringkasan & Tujuan

Setiap transaksi penting mengirim email otomatis ke user: konfirmasi saat membuka meja/reservasi, dan kuitansi saat pembayaran lunas. Pengiriman lewat **SMTP** (nodemailer) supaya **gratis** — memakai SMTP apa pun yang tersedia (email domain di Hostinger, Gmail app-password, Brevo free, dll.), menggantikan ketergantungan pada Resend yang berbayar setelah kuota.

**Prinsip pemandu:**
1. **Satu pintu.** Semua email tetap lewat `sendEmail()` (`src/lib/auth-v2/email-service.ts`) — email lama (magic link, staff invite, undangan meja) otomatis ikut pindah transport tanpa disentuh.
2. **Best-effort mutlak.** Email TIDAK PERNAH menggagalkan transaksi: kegagalan SMTP hanya tercatat di log. Uang selalu lebih penting dari email.
3. **Tepat satu kali.** Satu pembayaran = maksimal satu kuitansi, walau jalur "paid" ada banyak (mock instan, polling, webhook Duitku, kasir manual).

## 2. Desain Transport

Prioritas di `sendEmail()` (env-driven, pemanggil tak berubah):

| Prioritas | Transport | Syarat env |
|---|---|---|
| 1 | **SMTP** (nodemailer, pool 2 koneksi, cache per proses) | `SMTP_HOST` (+ `SMTP_PORT` 465/587, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`) |
| 2 | Resend (fallback existing) | `RESEND_API_KEY` |
| 3 | Dry-run (log console, warning keras di production) | — |

Port 465 = TLS implisit, 587 = STARTTLS (default 587). `SMTP_FROM` fallback ke `RESEND_FROM` lalu `SMTP_USER`.

## 3. Email Transaksi Baru

| # | Email | Penerima | Momen kirim | Isi |
|---|---|---|---|---|
| **E1** | Konfirmasi open table / reservasi | HOST | Setelah `openTable` sukses (sesi terbentuk) | Meja + area, jadwal (reservasi) / "opened just now" (walk-in), status & nominal DP, link sesi |
| **E2** | Kuitansi pembayaran bill | PEMBAYAR (paidByMember → profil → email) | Saat payment **berubah jadi paid** — semua jalur | Meja, waktu bayar, metode, potongan voucher (kalau ada), nominal, link detail |
| **E3** | Kuitansi pembayaran membership | Pembeli | Saat transaksi membership paid | Level, periode aktif, base + tax & service, total |

Gaya: template HTML inline dark+gold yang sama dengan email existing; bahasa **English** (konvensi UI); plaintext fallback disertakan.

### Titik pemasangan E2 (semua transisi paid — pola `settleVoucherForPayment`)
`payShare` (mock instan) · `checkPaymentStatus` (polling) · `markPaymentPaidBySystem` (webhook Duitku) · `cashierMarkPaymentPaid` · `cashierCreatePayment` (cash/mock instan) · DP instan di `openTable`.

### Dedup "tepat satu kali" (E2)
Kolom baru `payments.receipt_sent_at` (timestamptz NULL). Kirim hanya bila conditional update `SET receipt_sent_at = now() WHERE id = X AND receipt_sent_at IS NULL` mengembalikan baris — race-safe antar jalur paid, pola yang sama dengan aktivasi membership. Kolom baru non-destruktif (cukup `db:push`, tanpa pre-migrate).

### Yang di-SKIP otomatis
- Pembayar **guest** (walk-in placeholder — emailnya fake).
- Baris payments **method `voucher`** (sintetis; potongannya sudah tercantum di kuitansi payment utama).
- Payment `failed`/`refunded` (v1 tanpa email pembatalan).

## 4. Keputusan GAP — FINAL (semua usulan default DISETUJUI user)

| # | Pertanyaan | Keputusan |
|---|---|---|
| **G1** | **SMTP mana yang dipakai?** Kredensialnya menentukan setup env staging/production. | **Email domain di Hostinger** (paket hosting biasanya sudah termasuk; `smtp.hostinger.com:465`). Alternatif: Gmail app-password (±500/hari), Brevo free (300/hari). Volume 1 bar aman utk semuanya. Kode dibuat generik — keputusan ini murni pengisian env. |
| **G2** | **Kuitansi utk pembayaran CASH di kasir juga dikirim?** | **Ya** — kuitansi digital menggantikan struk utk customer; pembayar cash tetap teridentifikasi (member meja). |
| **G3** | **Kuitansi pembayaran membership (E3) ikut scope ini?** | **Ya, sekalian** — jalurnya persis sama (satu titik: `activateMembershipTx`) dan transaksinya bernilai besar; aneh kalau bill Rp50rb dapat kuitansi tapi membership Rp500rb tidak. |
| **G4** | **E1 utk meja yang dibuka STAFF (walk-in via waiter)?** | **Tidak** — host-nya guest placeholder tanpa email asli. Hanya open table oleh customer sendiri. |
| **G5** | **Batas laju?** SMTP gratis punya kuota harian. | **Tanpa throttle di v1** — volume transaksional 1 bar jauh di bawah kuota. Kalau kelak kena limit, antrian bisa ditambah belakangan. |

## 5. Rencana Implementasi (1 fase, ~1 commit)

1. `email-service.ts`: transport SMTP (nodemailer) + prioritas + dry-run yang menyebut kedua opsi env.
2. `email-template.ts`: `openTableConfirmationEmail` + `paymentReceiptEmail` + `membershipReceiptEmail` — shell dark+gold bersama.
3. Kolom `payments.receipt_sent_at` + helper `maybeSendPaymentReceipt(paymentId)` (server-only lib, dedup di dalam) dipasang di semua transisi paid.
4. Hook E1 di `openTable` (pasca-commit, `void ...catch` — fire-and-forget).
5. Verifikasi: dry-run lokal (log), lalu smoke nyata di staging dengan kredensial SMTP.

## 6. Edge case

- **SMTP down / kredensial salah** → transaksi tetap sukses; error tercatat log PM2. Dry-run warning keras kalau production tanpa transport.
- **Race dua jalur paid bersamaan** → `receipt_sent_at` conditional update; satu pemenang.
- **QRIS dibayar setelah dibatalkan** (`paidAfterCancelled`) → tetap dapat kuitansi (uang nyata masuk).
- **Email profil kosong/invalid** → skip senyap (jangan throw).
- **Deliverability**: SMTP domain sendiri sebaiknya punya SPF/DKIM (setting DNS Hostinger) supaya tak masuk spam — di luar scope kode, masuk checklist deploy.
