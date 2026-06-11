/**
 * Channel name constants — shared antara Server Actions (notify) dan
 * SSE route handlers (listen).
 *
 * Channel name max 63 chars (Postgres identifier limit). UUIDs aman:
 * 36 char + prefix.
 */
export const channels = {
  session: (sessionId: string) => `session:${sessionId}`,
  staff: (barId: string) => `staff:${barId}`,
};
