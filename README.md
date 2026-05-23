# Booking Table — SOHO Social House

Social table booking demo: open table, invite circle, order together, split bill.

Built with **Next.js 16** · **React 19** · **Tailwind v4** · **Supabase** · **TypeScript**.

---

## Quick Start (15 minutes)

### 1. Supabase: reset & migrate

Login ke Supabase dashboard → project kamu → **SQL Editor**.

Jalankan tiga file SQL secara berurutan:

| Step | File | Apa yang dilakukan |
|---|---|---|
| 1 | [supabase/migrations/0000_reset.sql](supabase/migrations/0000_reset.sql) | **Hapus semua table, type, function di schema public** dari project lama. ⚠️ Destructive — pastikan benar project yang sudah di-pause. |
| 2 | [supabase/migrations/0001_schema.sql](supabase/migrations/0001_schema.sql) | Create 13 tables, enums, RLS policies, realtime publication |
| 3 | [supabase/migrations/0002_seed.sql](supabase/migrations/0002_seed.sql) | Seed SOHO Social House: 2 area, 24 meja, 35+ menu item |

**Caranya:** copy isi file → paste ke SQL Editor → **Run**. Lakukan satu per satu, pastikan tidak ada error sebelum lanjut ke file berikutnya.

### 2. Aktifkan Anonymous Sign-In (untuk demo cepat)

Tanpa step ini, mode "Masuk sebagai Tamu" tidak akan jalan.

Supabase dashboard → **Authentication → Providers → Anonymous Sign-Ins** → **Enable**.

(Magic link via email tetap berjalan tanpa ini.)

### 3. Dapatkan kredensial API

Supabase dashboard → **Settings → API**, copy:
- `Project URL`
- `anon public` key

### 4. Set env variable lokal

Copy file `.env.local.example` ke `.env.local`:

```bash
cp .env.local.example .env.local
```

Edit `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
NEXT_PUBLIC_BAR_SLUG=soho-purwokerto
```

### 5. Jalankan dev server

```bash
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

---

## Demo Flow

Skenario presentasi ke client:

1. **Landing** (`/`) — hero SOHO, tombol "Browse Tables"
2. **Floor plan** (`/bar/soho-purwokerto`) — denah interaktif 2 area (Indoor + Rooftop)
   - Hijau pulse = meja open (ada session)
   - Gelap = available
   - Tap meja kosong → bottom sheet → "Open This Table"
3. **Sign in cepat** (`/auth`) — pilih "Masuk sebagai Tamu", masukkan nama
4. **Open table form** (`/open-table?tableId=...`) — pilih judul, visibility (public/friends/invite), vibe tags
5. **Session page** (`/session/[id]`) — tabs:
   - **Meja**: lihat members + invite link
   - **Menu**: kategori cocktails / bites / mains — tap untuk add to order
   - **Bill**: rincian per anggota (siapa pesan apa)
   - **Split**: equal / itemized / custom + mock payment QRIS/GoPay/Card/Cash
6. **Invite teman** — tap "Invite" di header → link disalin → buka di browser lain (atau incognito) → sign in tamu lain → join meja
7. **Realtime** — order baru, member baru, payment masuk → semua tab refresh otomatis

---

## Struktur Project

```
src/
├── app/
│   ├── page.tsx               # Landing
│   ├── layout.tsx             # Root + Sonner toast
│   ├── auth/                  # Sign in (email + anonymous)
│   ├── bar/[slug]/            # Floor plan
│   ├── open-table/            # Open table form
│   ├── session/[id]/          # Live session (members/menu/bill/split)
│   └── join/[code]/           # Join via invite link
├── components/
│   ├── ui/                    # Button, Card, Badge, Avatar
│   ├── floor/FloorMap.tsx     # SVG interactive map
│   ├── menu/MenuPicker.tsx    # Menu catalog + add to order sheet
│   └── session/SplitPayment.tsx # Equal/itemized/custom split
├── lib/
│   ├── supabase/              # client, server, middleware
│   ├── actions.ts             # Server Actions (open, join, order, pay)
│   ├── queries.ts             # Server-side data fetchers
│   ├── auth.ts                # Auth helpers (require user/profile)
│   └── utils.ts               # formatIDR, initials, etc.
├── hooks/
│   └── useSessionRealtime.ts  # Supabase realtime subscription
├── types/
│   └── db.ts                  # TypeScript types matching schema
└── middleware.ts              # Supabase session refresh
```

---

## Schema Overview

Lihat [docs/schema.md](docs/schema.md) untuk dokumentasi lengkap.

**Tables (13):** `profiles`, `bars`, `floor_areas`, `tables`, `table_sessions`, `session_members`, `session_invites`, `menu_categories`, `menu_items`, `orders`, `order_items`, `payments`, `staff_roles`

**Key design:**
- `order_items.added_by_member_id` → tracks **siapa pesan apa** untuk split itemized
- `table_sessions` unique partial index → hanya 1 session aktif per meja
- Harga as **integer (rupiah)**, no float
- `unit_price` di-snapshot saat order → harga menu boleh berubah tanpa pengaruhi order lama
- **RLS aktif** untuk semua table — public read untuk bar/menu, member-only untuk order/payment

---

## Realtime

Halaman session subscribe ke 4 table via `useSessionRealtime`:
- `table_sessions` — status meja
- `session_members` — orang join/leave
- `order_items` — pesanan baru
- `payments` — pembayaran masuk

Setiap event memicu `router.refresh()` → server re-fetch & update UI. Cocok untuk demo. Untuk production scale, ganti ke optimistic UI dengan local state.

---

## Production Roadmap (post-demo)

| Fitur | Status demo | Untuk go-live |
|---|---|---|
| Payment | Mock — semua `method='mock'` jadi `status='paid'` | Integrasi Midtrans/Xendit snap |
| Auth | Email magic link + anonymous | Tambah Google/Phone OTP |
| Waiter mode | Skema staff_roles ada | UI khusus untuk waiter (tablet view) |
| Admin dashboard | Skema staff_roles ada | UI manage menu, table layout, analytics |
| Push notif | Belum | OneSignal / FCM untuk "your order is ready" |
| QR per meja | Belum | Print sticker QR → scan → langsung ke session yang aktif |
| Custom split | Placeholder | Per-item assignment, % share |

---

## Troubleshooting

**`Failed to fetch` saat sign in tamu**
→ Anonymous sign-in belum diaktifkan di Supabase. Lihat step 2.

**`uniq_active_session_per_table` error saat open table**
→ Meja sudah punya session aktif. Reset dengan `update table_sessions set status='closed' where status in ('open','locked')` di SQL Editor.

**Tidak ada meja muncul di floor plan**
→ Seed belum jalan. Run `0002_seed.sql`.

**RLS blocking semua queries**
→ Pastikan user sudah sign in. Cek di Supabase Auth → Users apakah ada record.

---

## Tech Notes

- **Mobile-first** — testing utama di Chrome devtools mobile preview
- **Currency** — `formatIDR()` di [src/lib/utils.ts](src/lib/utils.ts)
- **Theme** — dark + gold (#C9A961) di [src/app/globals.css](src/app/globals.css)
- **No external API keys** untuk demo (semua mock di sisi payment)

---

Demo for SOHO Social House Purwokerto.
