/**
 * Edge-safe Auth.js config.
 *
 * Dipakai oleh middleware.ts yang jalan di Edge runtime — tidak boleh
 * import apapun yang punya Node.js dependency (DB driver, fs, crypto, dll).
 *
 * Yang BOLEH di file ini:
 * - Pages config (URL custom signin/error)
 * - Cookie config
 * - Session strategy
 * - JWT/Session callbacks (sebagian — selama tidak hit DB)
 * - Providers METADATA saja (full provider config tetap di src/auth.ts)
 *
 * Yang TIDAK BOLEH:
 * - Drizzle adapter (butuh postgres driver, bukan edge-safe)
 * - Credentials provider authorize() (lookup DB)
 * - Magic link sendVerificationRequest (Resend SDK)
 * - events.createUser (kita pakai bootstrapProfile yang hit DB)
 *
 * src/auth.ts extend config ini dengan adapter + providers full.
 */

import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  // JWT strategy → session disimpan di cookie, no DB lookup per request
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 hari
    updateAge: 24 * 60 * 60, // refresh tiap 24 jam
  },

  useSecureCookies: process.env.NODE_ENV === "production",

  pages: {
    signIn: "/auth",
    // No query string — Auth.js append-nya ?error=<code> sendiri
    error: "/auth",
    verifyRequest: "/auth?check_email=1",
  },

  // Empty providers — full provider list di src/auth.ts (butuh DB lookup)
  // Edge middleware cuma butuh tau ada session valid atau tidak.
  providers: [],

  callbacks: {
    /**
     * Inject user.id ke JWT.
     * Edge-safe karena cuma manipulasi token object.
     */
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },

    /**
     * Map JWT claims → session shape untuk client.
     * Edge-safe karena cuma manipulasi object.
     */
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },

    /**
     * Authorization check untuk middleware.
     * Return true = allow request, false = redirect ke signIn.
     *
     * Middleware utama (src/middleware.ts) sekarang handle subdomain
     * routing + admin redirect. Callback ini cuma gate /staff & /profile
     * untuk user app (non-admin subdomain). Admin gate sudah di middleware.
     */
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const host = request.headers.get("host") ?? "";
      const fwd = request.headers.get("x-forwarded-host") ?? "";
      const isAdminSubdomain =
        host.startsWith("admin.") || fwd.startsWith("admin.");
      // Link-tree (link.<domain>) PUBLIK sepenuhnya — dipasang di bio
      // Instagram. Callback ini jalan SEBELUM middleware.ts, jadi tanpa
      // pengecualian di sini pengunjung bisa dilempar ke login walau
      // middleware sudah mengizinkan.
      const isLinkSubdomain =
        host.startsWith("link.") || fwd.startsWith("link.");
      const isLoggedIn = !!auth?.user?.id;

      // Cek PATH juga, bukan cuma host: setelah middleware me-rewrite ke
      // /link, Next 16 menjalankan ulang pipeline dgn `host` yang sudah
      // dinormalkan (subdomain "link." hilang) — tanpa cek path ini,
      // pengunjung dilempar ke /auth?next=/link pada jalan kedua.
      if (isLinkSubdomain || path === "/link" || path.startsWith("/link/")) {
        return true;
      }

      // Admin subdomain: middleware.ts yang handle gate, callback skip
      if (isAdminSubdomain) return true;

      // User app: gate /staff & /profile (need login)
      const protectedPrefixes = ["/staff", "/profile"];
      const isProtected = protectedPrefixes.some((p) => path.startsWith(p));

      if (isProtected) {
        return isLoggedIn;
      }
      return true;
    },
  },
} satisfies NextAuthConfig;
