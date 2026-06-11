/**
 * Auth.js v5 root configuration.
 *
 * Entrypoint dipanggil dari:
 * - src/app/api/auth/[...nextauth]/route.ts → handlers (GET, POST)
 * - middleware.ts → auth()
 * - Server Actions → auth() untuk getSession
 *
 * Strategy: JWT-based session (stateless, no DB lookup per request).
 * Database adapter tetap dipakai untuk:
 * - Store accounts (kalau pakai OAuth nanti)
 * - Store verification tokens (magic link via Resend)
 * - Lookup user dari credentials provider
 *
 * Note: providers (Credentials, Resend) di-add di step berikutnya.
 * Step 1 ini cuma base config + adapter wiring.
 */

import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db/client";
import { users, accounts, sessions, verificationTokens } from "@/lib/db/schema/auth";
import { credentialsProvider } from "@/lib/auth-v2/credentials";
import { magicLinkProvider } from "@/lib/auth-v2/magic-link";
import { bootstrapProfile } from "@/lib/auth-v2/profile-bootstrap";

/**
 * Exports:
 * - handlers: { GET, POST } untuk API route /api/auth/[...nextauth]
 * - auth(): get current session (server-side, di Server Components/Actions/middleware)
 * - signIn(): trigger sign in flow (Server Actions)
 * - signOut(): trigger sign out (Server Actions)
 */
export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  // Drizzle adapter — wire ke schema tables yang sudah kita define
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  // JWT strategy → session disimpan di cookie, no DB lookup per request
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 hari
    updateAge: 24 * 60 * 60, // refresh token tiap 24 jam kalau ada aktivitas
  },

  // Cookie config — secure di production, lax di dev
  useSecureCookies: process.env.NODE_ENV === "production",

  // Halaman custom (route exists di app, akan refactor di step lain)
  pages: {
    signIn: "/auth",
    error: "/auth?error=auth_error",
    verifyRequest: "/auth?check_email=1",
  },

  // Providers
  // - credentials: email + password (existing user sign in)
  // - resend (magic link): passwordless via email — juga handle signup baru
  providers: [credentialsProvider, magicLinkProvider],

  // Events — side effects setelah auth action (tidak block flow kalau error)
  events: {
    /**
     * Dipanggil setelah Auth.js create user baru (dari magic link / OAuth).
     * Credentials signup tidak trigger ini karena kita create user manual
     * (bukan lewat adapter.createUser).
     *
     * Kita auto-create profile supaya helper requireProfile() tidak balik null
     * di first session setelah magic link signup.
     */
    async createUser({ user }) {
      if (!user.id) return;
      try {
        await bootstrapProfile({
          userId: user.id,
          email: user.email,
          name: user.name,
        });
      } catch (err) {
        // Log tapi jangan throw — kalau profile fail, user tetap sign in,
        // bisa di-create lewat /profile page nanti
        console.error("[auth] bootstrapProfile failed:", err);
      }
    },
  },

  // Callbacks — kontrol token payload & session shape
  callbacks: {
    /**
     * jwt() dipanggil setiap kali token di-create / di-update.
     * Tempat masukin custom claims ke JWT (userId, dll).
     */
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },

    /**
     * session() dipanggil saat client request session (via useSession atau auth()).
     * Map JWT claims → session shape yang dipakai app.
     */
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  // Debug logging di dev — matiin di production
  debug: process.env.NODE_ENV === "development",
});
