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
import { authConfig } from "@/auth.config";

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
  // Spread base config (edge-safe parts) — pages, session, callbacks
  ...authConfig,

  // Drizzle adapter — Node.js only (postgres driver), tidak ada di authConfig
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  // Providers full — di authConfig cuma metadata kosong
  providers: [credentialsProvider, magicLinkProvider],

  // Events — Node.js only (bootstrapProfile hit DB)
  events: {
    /**
     * Dipanggil setelah Auth.js create user baru (dari magic link / OAuth).
     * Credentials signup tidak trigger ini karena kita create user manual.
     *
     * Auto-create profile supaya requireProfile() tidak balik null
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

  // Debug logging di dev — matiin di production
  debug: process.env.NODE_ENV === "development",
});
