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
     * Implementasi: gate /admin & /staff routes, sisanya allow.
     * Logic per-role akan di-cek di Server Component (requireAdmin / requireStaff).
     */
    authorized({ auth, request }) {
      const path = request.nextUrl.pathname;
      const isLoggedIn = !!auth?.user?.id;

      // Routes yang butuh login
      const protectedPrefixes = ["/admin", "/staff", "/profile"];
      const isProtected = protectedPrefixes.some((p) => path.startsWith(p));

      if (isProtected) {
        return isLoggedIn; // false → Auth.js auto-redirect ke signIn page
      }

      // Public routes — allow
      return true;
    },
  },
} satisfies NextAuthConfig;
