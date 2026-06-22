/**
 * Edge middleware — jalan di setiap request sebelum Server Components.
 *
 * Tanggung jawab:
 * 1. Subdomain routing: admin.* → rewrite ke /admin/* internally
 * 2. Auth.js JWT session validate + refresh cookie
 * 3. Gate protected routes — logic di authConfig.callbacks.authorized
 *
 * Subdomain detection:
 * - admin.bookingsoho.com → admin app (rewrite ke /admin/...)
 * - admin.localhost:3000 → admin app (dev)
 * - bookingsoho.com / localhost:3000 → user app (default)
 *
 * Dengan rewrite, /admin/* di subdomain admin = /admin/* di codebase
 * (sama). Yang berbeda: kalau user akses bookingsoho.com/admin/*, return 404.
 * Itu kita handle di authConfig.callbacks.authorized.
 */

import NextAuth from "next-auth";
import { NextResponse, type NextRequest } from "next/server";
import { authConfig } from "@/auth.config";

const { auth: authMiddleware } = NextAuth(authConfig);

/**
 * Cek apakah request datang dari subdomain admin.
 * - admin.bookingsoho.com
 * - admin.localhost:3000 (dev)
 * - admin.local (custom dev)
 */
function isAdminSubdomain(request: NextRequest): boolean {
  // Next 16: rewrite internal me-RUN ULANG middleware dgn `host` yg sudah
  // dinormalkan ke host server (subdomain "admin." hilang). Tapi
  // `x-forwarded-host` tetap membawa host asli. Cek keduanya supaya request
  // hasil rewrite (mis. /login → /admin-login) tetap dikenali sbg admin.
  const host = request.headers.get("host") ?? "";
  const fwd = request.headers.get("x-forwarded-host") ?? "";
  return host.startsWith("admin.") || fwd.startsWith("admin.");
}

export default authMiddleware(async (req) => {
  const isAdmin = isAdminSubdomain(req);
  const path = req.nextUrl.pathname;

  // ==================================================
  // ADMIN SUBDOMAIN
  // ==================================================
  if (isAdmin) {
    const isLoggedIn = !!req.auth?.user?.id;

    // Path login admin (hasil rewrite /login → /admin-login). Saat Next 16
    // me-run-ulang middleware untuk request rewrite, path-nya jadi
    // "/admin-login" — perlakukan sbg halaman login & langsung tampilkan
    // (jangan rewrite lagi / jangan redirect).
    if (path === "/admin-login") {
      return NextResponse.next();
    }

    // Public paths admin (tidak butuh login):
    // - /login          (admin sign in)
    // - /setup-password (karyawan baru klik dari email)
    const isPublicAdminPath =
      path === "/login" || path === "/setup-password";

    // Belum login & bukan public path → redirect ke /login (pertahankan host
    // admin asli; nextUrl.host bisa sudah dinormalkan ke host server).
    if (!isLoggedIn && !isPublicAdminPath && !path.startsWith("/api/")) {
      const host =
        req.headers.get("x-forwarded-host") ??
        req.headers.get("host") ??
        req.nextUrl.host;
      const loginUrl = new URL(`${req.nextUrl.protocol}//${host}/login`);
      if (path !== "/") {
        loginUrl.searchParams.set("next", path);
      }
      return NextResponse.redirect(loginUrl);
    }

    // /login → rewrite ke /admin-login route file
    if (path === "/login") {
      const url = req.nextUrl.clone();
      url.pathname = "/admin-login";
      return NextResponse.rewrite(url);
    }

    // /setup-password tidak butuh rewrite, file langsung di /setup-password/
    if (path === "/setup-password") {
      return NextResponse.next();
    }

    // Path yang tidak butuh rewrite (sudah punya file langsung):
    // - /admin/* — admin panel
    // - /staff/* — dashboard role (cashier, waiter)
    // - /session/* — customer session UI (staff pakai untuk "Bantu Pesan" + "Buka Meja")
    // - /bar/* — venue page (staff balik dari session bisa landing di sini)
    // - /api/* — API routes
    const skipRewrite =
      path.startsWith("/admin") ||
      path.startsWith("/staff") ||
      path.startsWith("/session") ||
      path.startsWith("/bar") ||
      path.startsWith("/api/");

    // Default: rewrite path ke /admin prefix untuk root + path lain
    if (!skipRewrite) {
      const url = req.nextUrl.clone();
      url.pathname = `/admin${path === "/" ? "" : path}`;
      return NextResponse.rewrite(url);
    }
  }

  // ==================================================
  // USER SUBDOMAIN (default)
  // ==================================================
  // Kalau user (non-admin subdomain) akses admin/staff path → 404
  // Admin panel + dashboard kasir/waiter cuma boleh diakses dari subdomain admin
  if (
    !isAdmin &&
    (path.startsWith("/admin") ||
      path.startsWith("/staff") ||
      path === "/admin-login" ||
      path === "/setup-password")
  ) {
    return new NextResponse(null, { status: 404 });
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Match all paths kecuali static assets, images, dan API auth (Auth.js handle sendiri).
    "/((?!_next/static|_next/image|favicon.ico|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
