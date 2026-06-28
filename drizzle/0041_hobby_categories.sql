-- 0041: kategori hobi sbg tabel sendiri (dikelola admin).
CREATE TABLE IF NOT EXISTS hobby_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_hobby_category_name UNIQUE (name)
);

-- Seed dari kategori yg sudah dipakai di tabel hobbies.
INSERT INTO hobby_categories (name, sort_order) VALUES
  ('Musik & Hiburan', 10),
  ('Minuman & Kuliner', 20),
  ('Aktivitas Sosial', 30),
  ('Vibe & Gaya', 40),
  ('Lifestyle', 50)
ON CONFLICT (name) DO NOTHING;
