-- 0052: master pertanyaan prompt (ice-breaker) — dikelola admin.
CREATE TABLE IF NOT EXISTS prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_prompt_text UNIQUE (text)
);

INSERT INTO prompts (text, sort_order) VALUES
  ('Tonight I''m in the mood for…', 10),
  ('My go-to order here is…', 20),
  ('You''ll usually find me…', 30),
  ('The perfect night out is…', 40),
  ('Ask me about…', 50),
  ('I''ll always say yes to…', 60),
  ('A little-known fact about me…', 70),
  ('My hidden talent is…', 80),
  ('On repeat right now…', 90),
  ('My karaoke go-to is…', 100),
  ('Let''s talk about…', 110),
  ('The best way to break the ice with me…', 120),
  ('I''m here to…', 130),
  ('My kind of crowd is…', 140)
ON CONFLICT (text) DO NOTHING;
