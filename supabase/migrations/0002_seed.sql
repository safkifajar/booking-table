-- ============================================================
-- SEED DATA — SOHO Social House Purwokerto
-- Jalankan setelah 0001_schema.sql
-- ============================================================

-- ============================================================
-- BAR
-- ============================================================
insert into bars (id, slug, name, tagline, address, theme, opening_hours)
values (
  '11111111-1111-1111-1111-111111111111',
  'soho-purwokerto',
  'SOHO Social House',
  'Where the night begins',
  'Jl. Jend. Soedirman, Purwokerto, Jawa Tengah',
  '{"primary": "#C9A961", "accent": "#1A1A1A", "bg": "#0A0A0A"}'::jsonb,
  '{"mon":"17:00-01:00","tue":"17:00-01:00","wed":"17:00-01:00","thu":"17:00-02:00","fri":"17:00-03:00","sat":"17:00-03:00","sun":"17:00-01:00"}'::jsonb
);

-- ============================================================
-- FLOOR AREAS (2 area)
-- ============================================================
insert into floor_areas (id, bar_id, name, slug, canvas_width, canvas_height, sort_order)
values
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'Indoor Lounge', 'indoor', 900, 600, 0),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111', 'Rooftop', 'rooftop', 900, 600, 1);

-- ============================================================
-- TABLES (Indoor Lounge)
-- Layout: bar counter di kiri, booth di kanan, meja round di tengah
-- ============================================================
insert into tables (area_id, label, shape, capacity, pos_x, pos_y, width, height) values
  -- Booth area (kanan) — kapasitas besar
  ('22222222-2222-2222-2222-222222222221', 'B1', 'booth', 6, 720, 80,  140, 100),
  ('22222222-2222-2222-2222-222222222221', 'B2', 'booth', 6, 720, 220, 140, 100),
  ('22222222-2222-2222-2222-222222222221', 'B3', 'booth', 6, 720, 360, 140, 100),
  -- Round tables (tengah)
  ('22222222-2222-2222-2222-222222222221', 'T1', 'round', 4, 380, 130, 90, 90),
  ('22222222-2222-2222-2222-222222222221', 'T2', 'round', 4, 510, 130, 90, 90),
  ('22222222-2222-2222-2222-222222222221', 'T3', 'round', 4, 380, 280, 90, 90),
  ('22222222-2222-2222-2222-222222222221', 'T4', 'round', 4, 510, 280, 90, 90),
  ('22222222-2222-2222-2222-222222222221', 'T5', 'round', 2, 380, 430, 70, 70),
  ('22222222-2222-2222-2222-222222222221', 'T6', 'round', 2, 510, 430, 70, 70),
  -- Bar counter seats (kiri) — high tables
  ('22222222-2222-2222-2222-222222222221', 'BC1', 'square', 2, 100, 100, 60, 60),
  ('22222222-2222-2222-2222-222222222221', 'BC2', 'square', 2, 100, 200, 60, 60),
  ('22222222-2222-2222-2222-222222222221', 'BC3', 'square', 2, 100, 300, 60, 60),
  ('22222222-2222-2222-2222-222222222221', 'BC4', 'square', 2, 100, 400, 60, 60);

-- ============================================================
-- TABLES (Rooftop) — vibe lebih chill, lebih banyak meja besar
-- ============================================================
insert into tables (area_id, label, shape, capacity, pos_x, pos_y, width, height) values
  -- Lounge sofas (atas) — kapasitas 8
  ('22222222-2222-2222-2222-222222222222', 'R-L1', 'rect',  8, 80,  80,  180, 120),
  ('22222222-2222-2222-2222-222222222222', 'R-L2', 'rect',  8, 290, 80,  180, 120),
  ('22222222-2222-2222-2222-222222222222', 'R-L3', 'rect',  8, 500, 80,  180, 120),
  -- Round tables (tengah)
  ('22222222-2222-2222-2222-222222222222', 'R-T1', 'round', 4, 130, 270, 90, 90),
  ('22222222-2222-2222-2222-222222222222', 'R-T2', 'round', 4, 260, 270, 90, 90),
  ('22222222-2222-2222-2222-222222222222', 'R-T3', 'round', 4, 390, 270, 90, 90),
  ('22222222-2222-2222-2222-222222222222', 'R-T4', 'round', 4, 520, 270, 90, 90),
  ('22222222-2222-2222-2222-222222222222', 'R-T5', 'round', 4, 650, 270, 90, 90),
  -- VIP cabana (kanan bawah)
  ('22222222-2222-2222-2222-222222222222', 'VIP', 'booth', 10, 700, 420, 180, 140),
  -- Standing tables (bawah)
  ('22222222-2222-2222-2222-222222222222', 'R-S1', 'round', 2, 130, 470, 70, 70),
  ('22222222-2222-2222-2222-222222222222', 'R-S2', 'round', 2, 240, 470, 70, 70),
  ('22222222-2222-2222-2222-222222222222', 'R-S3', 'round', 2, 350, 470, 70, 70),
  ('22222222-2222-2222-2222-222222222222', 'R-S4', 'round', 2, 460, 470, 70, 70);

-- Set min_spend untuk VIP & booth besar
update tables set min_spend = 1500000 where label = 'VIP';
update tables set min_spend = 500000 where shape = 'booth' and label like 'B%';
update tables set min_spend = 750000 where label like 'R-L%';

-- ============================================================
-- MENU CATEGORIES
-- ============================================================
insert into menu_categories (id, bar_id, name, slug, sort_order) values
  ('33333333-3333-3333-3333-333333333301', '11111111-1111-1111-1111-111111111111', 'Signature Cocktails', 'signature', 0),
  ('33333333-3333-3333-3333-333333333302', '11111111-1111-1111-1111-111111111111', 'Classic Cocktails',   'classic',   1),
  ('33333333-3333-3333-3333-333333333303', '11111111-1111-1111-1111-111111111111', 'Mocktails',           'mocktails', 2),
  ('33333333-3333-3333-3333-333333333304', '11111111-1111-1111-1111-111111111111', 'Wine & Spirits',      'wine',      3),
  ('33333333-3333-3333-3333-333333333305', '11111111-1111-1111-1111-111111111111', 'Beer',                'beer',      4),
  ('33333333-3333-3333-3333-333333333306', '11111111-1111-1111-1111-111111111111', 'Bar Bites',           'bites',     5),
  ('33333333-3333-3333-3333-333333333307', '11111111-1111-1111-1111-111111111111', 'Main Course',         'mains',     6);

-- ============================================================
-- MENU ITEMS
-- ============================================================

-- Signature Cocktails
insert into menu_items (category_id, name, description, price, tags, prep_minutes, sort_order) values
  ('33333333-3333-3333-3333-333333333301', 'SOHO Sunset',      'Tequila, passionfruit, lime, hint of chili',        125000, '{"signature","alcoholic","spicy"}', 6, 0),
  ('33333333-3333-3333-3333-333333333301', 'Purwokerto Mule',  'Vodka, ginger beer, kemangi infusion',              110000, '{"signature","alcoholic","local"}', 5, 1),
  ('33333333-3333-3333-3333-333333333301', 'Banyumas Old Fashioned', 'Bourbon, palm sugar, smoked cinnamon bitters', 145000, '{"signature","alcoholic","smoky"}', 7, 2),
  ('33333333-3333-3333-3333-333333333301', 'Velvet Lounge',    'Gin, butterfly pea, lychee, prosecco float',         130000, '{"signature","alcoholic","floral"}', 5, 3);

-- Classic Cocktails
insert into menu_items (category_id, name, description, price, tags, prep_minutes, sort_order) values
  ('33333333-3333-3333-3333-333333333302', 'Negroni',         'Gin, Campari, sweet vermouth',                 95000,  '{"classic","alcoholic","bitter"}', 4, 0),
  ('33333333-3333-3333-3333-333333333302', 'Margarita',       'Tequila, triple sec, fresh lime, salt rim',     95000,  '{"classic","alcoholic","citrus"}', 4, 1),
  ('33333333-3333-3333-3333-333333333302', 'Espresso Martini','Vodka, kahlua, fresh espresso',                105000, '{"classic","alcoholic","caffeine"}', 5, 2),
  ('33333333-3333-3333-3333-333333333302', 'Mojito',          'White rum, mint, lime, soda',                   85000,  '{"classic","alcoholic","refreshing"}', 4, 3),
  ('33333333-3333-3333-3333-333333333302', 'Whiskey Sour',    'Bourbon, lemon, sugar, egg white',              100000, '{"classic","alcoholic"}', 5, 4);

-- Mocktails
insert into menu_items (category_id, name, description, price, tags, prep_minutes, sort_order) values
  ('33333333-3333-3333-3333-333333333303', 'Virgin Mojito',   'Mint, lime, soda',                             55000, '{"non-alcoholic","refreshing"}', 3, 0),
  ('33333333-3333-3333-3333-333333333303', 'Tropical Sunrise','Orange, mango, grenadine, soda',                60000, '{"non-alcoholic","fruity"}', 3, 1),
  ('33333333-3333-3333-3333-333333333303', 'Lychee Spritz',   'Lychee, sparkling water, basil',                65000, '{"non-alcoholic","floral"}', 3, 2);

-- Wine & Spirits
insert into menu_items (category_id, name, description, price, tags, prep_minutes, sort_order) values
  ('33333333-3333-3333-3333-333333333304', 'House Red (glass)',   'Cabernet Sauvignon',           90000,  '{"wine","red"}', 2, 0),
  ('33333333-3333-3333-3333-333333333304', 'House White (glass)', 'Sauvignon Blanc',              90000,  '{"wine","white"}', 2, 1),
  ('33333333-3333-3333-3333-333333333304', 'House Red (bottle)',  'Cabernet Sauvignon',           450000, '{"wine","red","bottle"}', 2, 2),
  ('33333333-3333-3333-3333-333333333304', 'Prosecco (bottle)',   'Italian sparkling',            550000, '{"wine","sparkling","bottle"}', 2, 3),
  ('33333333-3333-3333-3333-333333333304', 'Jack Daniel''s Set',  'Bottle + 4 mixers',            850000, '{"spirit","bottle","whiskey"}', 3, 4),
  ('33333333-3333-3333-3333-333333333304', 'Absolut Vodka Set',   'Bottle + 4 mixers',            750000, '{"spirit","bottle","vodka"}', 3, 5);

-- Beer
insert into menu_items (category_id, name, description, price, tags, prep_minutes, sort_order) values
  ('33333333-3333-3333-3333-333333333305', 'Bintang Pilsener',  'Local lager',                   45000, '{"beer","local"}', 1, 0),
  ('33333333-3333-3333-3333-333333333305', 'Heineken',          'Dutch lager',                   55000, '{"beer","import"}', 1, 1),
  ('33333333-3333-3333-3333-333333333305', 'Corona + lime',     'Mexican lager with lime',       65000, '{"beer","import"}', 1, 2),
  ('33333333-3333-3333-3333-333333333305', 'Stark Wheat IPA',   'Local craft IPA',               70000, '{"beer","craft","local"}', 1, 3);

-- Bar Bites
insert into menu_items (category_id, name, description, price, tags, prep_minutes, sort_order) values
  ('33333333-3333-3333-3333-333333333306', 'Truffle Fries',         'Shoestring, truffle oil, parmesan',   75000,  '{"snack","vegetarian"}', 10, 0),
  ('33333333-3333-3333-3333-333333333306', 'Crispy Chicken Wings',  'Korean glaze or BBQ',                 85000,  '{"snack","chicken"}', 12, 1),
  ('33333333-3333-3333-3333-333333333306', 'Calamari Fritti',       'Crispy squid, garlic aioli',          95000,  '{"snack","seafood"}', 10, 2),
  ('33333333-3333-3333-3333-333333333306', 'Beef Sliders (3pc)',    'Mini wagyu burgers, brioche',         110000, '{"snack","beef"}', 14, 3),
  ('33333333-3333-3333-3333-333333333306', 'Tuna Tartare',          'Sashimi-grade tuna, avocado, chips',  125000, '{"snack","seafood","raw"}', 10, 4),
  ('33333333-3333-3333-3333-333333333306', 'Cheese & Charcuterie',  'Selection of cheese & cold cuts',     185000, '{"snack","sharing"}', 8, 5),
  ('33333333-3333-3333-3333-333333333306', 'Edamame',               'Salted or spicy',                     35000,  '{"snack","vegetarian","light"}', 5, 6);

-- Main Course
insert into menu_items (category_id, name, description, price, tags, prep_minutes, sort_order) values
  ('33333333-3333-3333-3333-333333333307', 'Wagyu Steak (200g)',   'Grilled wagyu, mash, jus',               325000, '{"main","beef"}', 18, 0),
  ('33333333-3333-3333-3333-333333333307', 'Grilled Salmon',       'Norwegian salmon, asparagus, lemon',     185000, '{"main","seafood"}', 15, 1),
  ('33333333-3333-3333-3333-333333333307', 'Spicy Nasi Goreng SOHO','House fried rice, chicken satay, telur',95000,  '{"main","local","spicy"}', 12, 2),
  ('33333333-3333-3333-3333-333333333307', 'Truffle Mushroom Pasta','Linguine, mushroom, cream, truffle',    125000, '{"main","vegetarian"}', 14, 3);

-- ============================================================
-- DEMO PROFILES (akan dipakai untuk seed sessions)
-- Catatan: di production, profile dibuat lewat auth signup.
-- Untuk demo, kita insert langsung agar bisa ada "live" sessions.
-- ============================================================
-- Kita SKIP insert profile dummy di sini karena harus ada auth.users dulu.
-- Profile demo akan dibuat via signup di app, atau via seed script terpisah.

-- ============================================================
-- DONE
-- ============================================================
