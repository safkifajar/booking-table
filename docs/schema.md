# Database Schema — Booking Table (SOHO Social House)

Schema ini dirancang untuk konsep **social table booking** dengan host, multi-member, shared ordering, dan split payment.

## Entity Relationship (overview)

```
auth.users (Supabase Auth)
    │
    ├──< profiles (1:1) — extra user data
    │
    └──< table_sessions (host_id) — "open table" yang dibuka host
              │
              ├──< session_members — siapa saja di meja itu
              │       │
              │       └──< order_items (added_by_member_id) — pesanan per anggota
              │
              ├──< orders — bill/tab untuk session
              │       │
              │       └──< order_items
              │
              └──< payments — pembayaran per anggota (split)

bars (1) ──< floor_areas ──< tables ──< table_sessions
bars (1) ──< menu_categories ──< menu_items
```

## Tables

### 1. `profiles`
Extension dari `auth.users` (Supabase Auth menangani email/phone/oauth).
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | FK → `auth.users.id`, on delete cascade |
| `display_name` | text | Nama tampilan |
| `avatar_url` | text | Foto profil (Supabase storage) |
| `phone` | text | Optional |
| `created_at` | timestamptz | default `now()` |

### 2. `bars`
Master data venue. Demo cuma 1 row: SOHO Social House Purwokerto.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `slug` | text UNIQUE | e.g. `soho-purwokerto` |
| `name` | text | "SOHO Social House" |
| `tagline` | text | |
| `address` | text | |
| `logo_url` | text | |
| `cover_url` | text | |
| `theme` | jsonb | `{ primary: "#...", accent: "#..." }` |
| `opening_hours` | jsonb | `{ mon: "17:00-02:00", ... }` |
| `created_at` | timestamptz | |

### 3. `floor_areas`
Misal: "Indoor", "Rooftop", "Lounge". Setiap area punya canvas size sendiri.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `bar_id` | uuid FK | |
| `name` | text | "Rooftop" |
| `slug` | text | |
| `canvas_width` | int | px, untuk SVG floor map |
| `canvas_height` | int | |
| `background_url` | text | Optional, bg image area |
| `sort_order` | int | |

### 4. `tables`
Meja fisik di bar. Posisi di floor map disimpan di sini.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `area_id` | uuid FK → floor_areas | |
| `label` | text | "T-01", "VIP-A" |
| `shape` | text enum | `'round' \| 'square' \| 'rect' \| 'booth'` |
| `capacity` | int | Default 4 |
| `pos_x` | int | Koordinat di canvas |
| `pos_y` | int | |
| `width` | int | |
| `height` | int | |
| `rotation` | int | Degrees |
| `is_active` | bool | Bisa dinonaktifkan tanpa hapus |
| `min_spend` | int | Optional, minimum order (rupiah) |

### 5. `table_sessions`
**Inti dari "open table"**. Setiap kali host buka meja, satu row baru dibuat.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `table_id` | uuid FK | |
| `host_id` | uuid FK → profiles | |
| `status` | text enum | `'open' \| 'locked' \| 'closed' \| 'cancelled'` |
| `visibility` | text enum | `'public' \| 'friends' \| 'invite_only'` |
| `title` | text | "Friday night vibes" — judul meja |
| `vibe_tags` | text[] | `['chill', 'networking']` |
| `max_guests` | int | Default = table.capacity |
| `started_at` | timestamptz | |
| `closed_at` | timestamptz | |
| `notes` | text | |

**Constraint:** Hanya boleh ada 1 session `open`/`locked` per `table_id` pada satu waktu — pakai partial unique index.

### 6. `session_members`
Siapa saja yang ada di meja itu.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK | |
| `profile_id` | uuid FK → profiles | |
| `role` | text enum | `'host' \| 'member' \| 'guest'` |
| `status` | text enum | `'pending' \| 'joined' \| 'left' \| 'kicked'` |
| `joined_at` | timestamptz | |
| `left_at` | timestamptz | |
| UNIQUE | (session_id, profile_id) | |

### 7. `session_invites`
Link/invite yang dibuat host untuk mengajak orang.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK | |
| `code` | text UNIQUE | Short code untuk URL: `/join/AB12CD` |
| `created_by` | uuid FK → profiles | |
| `expires_at` | timestamptz | Default +2 jam |
| `max_uses` | int | Default null = unlimited |
| `use_count` | int | Default 0 |

### 8. `menu_categories`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `bar_id` | uuid FK | |
| `name` | text | "Signature Cocktails", "Bar Bites" |
| `slug` | text | |
| `sort_order` | int | |
| `is_active` | bool | |

### 9. `menu_items`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `category_id` | uuid FK | |
| `name` | text | "Negroni Soho" |
| `description` | text | |
| `price` | int | Rupiah (integer, no float) |
| `image_url` | text | |
| `tags` | text[] | `['alcoholic', 'signature']` |
| `is_available` | bool | Stok habis = false |
| `prep_minutes` | int | Estimasi waktu siap |

### 10. `orders`
Satu **bill/tab** per session. Biasanya 1 session = 1 order yang terus ditambah.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `session_id` | uuid FK | |
| `status` | text enum | `'open' \| 'submitted' \| 'preparing' \| 'served' \| 'closed'` |
| `created_at` | timestamptz | |

### 11. `order_items`
Setiap item pesanan, dilacak siapa yang menambahkannya.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid FK | |
| `menu_item_id` | uuid FK | |
| `added_by_member_id` | uuid FK → session_members | **Siapa yang pesan** — penting untuk split itemized |
| `quantity` | int | |
| `unit_price` | int | Snapshot harga saat order (anti perubahan harga) |
| `notes` | text | "Less ice", "no sugar" |
| `status` | text enum | `'draft' \| 'sent' \| 'preparing' \| 'served' \| 'void'` |
| `created_at` | timestamptz | |

### 12. `payments`
Setiap pembayaran (split) dari anggota.
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `order_id` | uuid FK | |
| `paid_by_member_id` | uuid FK → session_members | |
| `amount` | int | Rupiah |
| `method` | text enum | `'qris' \| 'cash' \| 'card' \| 'gopay' \| 'ovo' \| 'mock'` |
| `status` | text enum | `'pending' \| 'paid' \| 'failed' \| 'refunded'` |
| `split_mode` | text enum | `'equal' \| 'itemized' \| 'custom'` |
| `split_meta` | jsonb | Item IDs untuk itemized, dll |
| `paid_at` | timestamptz | |
| `external_ref` | text | ID dari Midtrans/Xendit nanti |

### 13. `staff_roles` (untuk waiter & admin mode)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `bar_id` | uuid FK | |
| `profile_id` | uuid FK | |
| `role` | text enum | `'waiter' \| 'manager' \| 'admin'` |
| `is_active` | bool | |

## Enums (Postgres)

```sql
create type session_status as enum ('open', 'locked', 'closed', 'cancelled');
create type session_visibility as enum ('public', 'friends', 'invite_only');
create type member_role as enum ('host', 'member', 'guest');
create type member_status as enum ('pending', 'joined', 'left', 'kicked');
create type table_shape as enum ('round', 'square', 'rect', 'booth');
create type order_status as enum ('open', 'submitted', 'preparing', 'served', 'closed');
create type order_item_status as enum ('draft', 'sent', 'preparing', 'served', 'void');
create type payment_method as enum ('qris', 'cash', 'card', 'gopay', 'ovo', 'mock');
create type payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type split_mode as enum ('equal', 'itemized', 'custom');
create type staff_role as enum ('waiter', 'manager', 'admin');
```

## Row Level Security (sketsa)

- **profiles**: user bisa read all, update own
- **bars / floor_areas / tables / menu_***: read public, write hanya `staff_roles.admin`
- **table_sessions**: 
  - `open` + `public` → read public
  - `invite_only` → read hanya members atau yang punya invite code
  - Write: hanya host atau staff
- **session_members**: read by session members; insert oleh self (saat join); host/staff bisa kick
- **orders / order_items**: read by session members + staff; insert oleh members + staff
- **payments**: read by self + host + staff; insert oleh self

## Indexes penting

- `idx_table_sessions_active` on `(table_id) where status in ('open','locked')` — unique
- `idx_sessions_visibility` on `(visibility, status)` untuk listing public open tables
- `idx_order_items_session` on `(order_id, added_by_member_id)` untuk split calculation
- `idx_invites_code` on `code` (unique)

## Catatan Desain

1. **Harga disimpan sebagai integer (rupiah, no desimal)** — hindari floating point untuk uang.
2. **`unit_price` di-snapshot saat order dibuat** — kalau harga menu berubah, order lama tidak terpengaruh.
3. **`added_by_member_id` di `order_items`** adalah kunci untuk fitur "siapa pesan apa" → split itemized jadi mudah.
4. **Realtime subscription** akan listen ke:
   - `table_sessions` (perubahan status meja di floor map)
   - `session_members` (orang baru join)
   - `order_items` (order baru muncul untuk semua anggota meja)
   - `payments` (status pembayaran update)
5. **Mock payment** pakai `method = 'mock'` untuk demo. Saat go-prod, ganti ke `'qris'` dengan integrasi Midtrans/Xendit — tidak ada perubahan schema.
