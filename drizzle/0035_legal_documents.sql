-- 0035: dokumen legal per bar (Privacy Policy, Terms & Conditions).
CREATE TABLE IF NOT EXISTS legal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_id uuid NOT NULL REFERENCES bars(id) ON DELETE CASCADE,
  key text NOT NULL,
  title text NOT NULL,
  content text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_legal_bar_key UNIQUE (bar_id, key)
);
