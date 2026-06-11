/**
 * Edge middleware — jalan di setiap request sebelum hit Server Components.
 *
 * Tanggung jawab:
 * 1. Auth.js JWT session validate + refresh cookie (sliding window)
 * 2. Gate protected routes (/admin, /staff, /profile) — logic di authConfig.callbacks.authorized
 * 3. Refresh Supabase session (LEGACY, akan dihapus saat refactor selesai)
 *
 * Edge-safe: pakai authConfig (tidak ada DB import).
 *
 * Strategi dual-auth saat ini:
 * - Auth.js handle session validation untuk routes baru
 * - Supabase tetap refresh session selama refactor belum complete
 *
 * Saat refactor Phase 3-5 selesai, hapus Supabase middleware call.
 */

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";
import { updateSession } from "@/lib/supabase/middleware";

// Edge-safe Auth.js instance — cuma untuk middleware
const { auth: authMiddleware } = NextAuth(authConfig);

/**
 * Auth.js v5 middleware pattern:
 * `auth()` adalah higher-order function. Kita wrap request handler-nya
 * supaya bisa add Supabase legacy session refresh setelah Auth.js check.
 *
 * Di dalam handler, `req.auth` adalah session (null kalau no session).
 * authorized callback di authConfig sudah handle gate + redirect.
 */
export default authMiddleware(async (req) => {
  // Auth.js sudah handle authorize() check via authConfig.callbacks.authorized.
  // Kalau request lolos sampai sini, berarti boleh lanjut.
  //
  // LEGACY: Supabase session refresh untuk routes lama yang masih pakai
  // Supabase Auth. Akan dihapus setelah refactor Phase 3-5 selesai.
  return await updateSession(req);
});

export const config = {
  matcher: [
    // Match all paths kecuali static assets, images, dan API auth (Auth.js handle sendiri).
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
