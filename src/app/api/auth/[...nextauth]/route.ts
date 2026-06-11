/**
 * Auth.js HTTP endpoint — catch-all route untuk semua auth requests.
 *
 * URL pattern yang di-handle:
 * - GET  /api/auth/signin              — sign in page (default Auth.js UI atau redirect ke pages.signIn)
 * - POST /api/auth/signin/:provider    — sign in dengan provider tertentu
 * - GET  /api/auth/signout             — sign out page
 * - POST /api/auth/signout             — sign out action
 * - GET  /api/auth/callback/:provider  — OAuth callback / magic link verify
 * - POST /api/auth/callback/:provider  — credentials callback
 * - GET  /api/auth/session             — fetch current session (untuk client-side useSession)
 * - GET  /api/auth/csrf                — CSRF token
 * - GET  /api/auth/providers           — list registered providers
 *
 * Auth.js v5 native support Next.js App Router — handlers exported dari src/auth.ts.
 */

import { handlers } from "@/auth";

export const { GET, POST } = handlers;
