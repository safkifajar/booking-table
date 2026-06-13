-- =====================================================================
-- Reservation config + operating hours structure
--
-- bars.opening_hours sudah ada (jsonb default {}), kita reuse untuk
-- operating hours dengan struktur:
--   {
--     "mon": { "open": "10:00", "close": "23:00", "closed": false },
--     "tue": { ... },
--     ...
--     "sun": { ... }
--   }
--
-- bars.reservation_config baru — config untuk fitur reservation booking:
--   {
--     "enabled": true,
--     "bookingWindowDays": 7,
--     "minLeadTimeMinutes": 60,
--     "graceMinutes": 15,
--     "slotIntervalMinutes": 60,
--     "maxPartySize": 12
--   }
-- =====================================================================

ALTER TABLE bars
  ADD COLUMN IF NOT EXISTS reservation_config jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN bars.reservation_config IS
  'Config fitur reservation: enabled, bookingWindowDays, minLeadTimeMinutes, graceMinutes, slotIntervalMinutes, maxPartySize';

COMMENT ON COLUMN bars.opening_hours IS
  'Operating hours per hari. Format: {"mon": {"open": "10:00", "close": "23:00", "closed": false}, ...}';
