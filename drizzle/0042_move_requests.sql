-- 0042: request pindah meja (approval saat aktif) + notif type baru.

-- Enum notif baru (ADD VALUE harus di luar transaksi/independent statement).
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'move_request';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'move_approved';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'move_rejected';

CREATE TABLE IF NOT EXISTS table_move_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES table_sessions(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  from_table_id uuid NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
  to_table_id uuid NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
  reservation_at timestamptz NOT NULL,
  reservation_end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  resolved_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_move_req_session ON table_move_requests(session_id);
CREATE INDEX IF NOT EXISTS idx_move_req_status ON table_move_requests(status);
