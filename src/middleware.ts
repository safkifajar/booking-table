/**
 * Edge middleware — jalan di setiap request sebelum Server Components.
 *
 * Tanggung jawab tunggal:
 * - Auth.js JWT session validate + refresh cookie (sliding window)
 * - Gate protected routes (/admin, /staff, /profile) — logic di
 *   authConfig.callbacks.authorized
 *
 * Edge-safe: pakai authConfig dari src/auth.config.ts (tidak ada DB driver).
 */

import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

const { auth: authMiddleware } = NextAuth(authConfig);

export default authMiddleware;

export const config = {
  matcher: [
    // Match all paths kecuali static assets, images, dan API auth (Auth.js handle sendiri).
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
