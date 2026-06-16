-- =====================================================================
-- Push subscriptions (Web Push — notif popup OS ala app, walau web ditutup)
--
-- 1 baris per device/browser yg subscribe. endpoint UNIQUE (idempotent
-- upsert by endpoint). p256dh + auth = kunci enkripsi dari PushSubscription.
-- Dikirim push via lib web-push pakai VAPID keys.
-- =====================================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_profile
  ON push_subscriptions(profile_id);
