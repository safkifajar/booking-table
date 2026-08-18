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

/**
 * Cek subdomain link-tree: link.<domain> (mis. link.ratssocial.com,
 * link.localhost:3000 di dev).
 *
 * Sama seperti isAdminSubdomain: cek `host` DAN `x-forwarded-host`, karena
 * rewrite internal Next 16 menormalkan `host` & menghilangkan subdomainnya.
 */
function isLinkSubdomain(request: NextRequest): boolean {
  const host = request.headers.get("host") ?? "";
  const fwd = request.headers.get("x-forwarded-host") ?? "";
  return host.startsWith("link.") || fwd.startsWith("link.");
}

export default authMiddleware(async (req) => {
  const isAdmin = isAdminSubdomain(req);
  const path = req.nextUrl.pathname;

  // ==================================================
  // LINK SUBDOMAIN (link.<domain>) — halaman link-tree utk bio Instagram
  // ==================================================
  // PUBLIK sepenuhnya: tak butuh login & SENGAJA di atas maintenance gate,
  // karena tautannya dipasang di bio Instagram — harus tetap bisa dibuka
  // walau app customer sedang ditutup untuk maintenance.
  // Path /link SELALU publik, dari host mana pun. Ini yang membuat jalan
  // KEDUA middleware (Next 16 menjalankan ulang middleware setelah rewrite,
  // dgn `host` yang sudah dinormalkan sehingga "link." hilang) tak lagi
  // menganggapnya halaman customer & melemparnya ke /auth?next=/link.
  if (path === "/link" || path.startsWith("/link/")) {
    return NextResponse.next();
  }

  if (isLinkSubdomain(req)) {
    // Aset & API tetap lewat apa adanya.
    if (path.startsWith("/_next/") || path.startsWith("/api/")) {
      return NextResponse.next();
    }
    const url = req.nextUrl.clone();
    url.pathname = "/link";
    return NextResponse.rewrite(url);
  }

  // ==================================================
  // MAINTENANCE GATE ("live tapi tertutup")
  // ==================================================
  // MAINTENANCE_MODE=true → subdomain CUSTOMER tampilkan halaman "Segera Hadir".
  // Subdomain ADMIN tidak terkena — operator tetap bisa login & setup bar/menu/
  // meja sebelum buka ke publik. Aset statis, API, & halaman maintenance sendiri
  // dilewati supaya halaman tetap ter-render. Set MAINTENANCE_MODE=false (atau
  // hapus) saat siap buka ke user.
  if (
    process.env.MAINTENANCE_MODE === "true" &&
    !isAdmin &&
    path !== "/maintenance" &&
    !path.startsWith("/api/") &&
    !path.startsWith("/_next/")
  ) {
    const url = req.nextUrl.clone();
    url.pathname = "/maintenance";
    url.search = "";
    return NextResponse.rewrite(url);
  }

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
    // - /open-table — form buka/booking meja (kasir buka meja utk customer)
    // - /booking/*  — layar tunggu bayar DP walk-in (staff pilih Cash → ke
    //   /booking/[id]/pay). Halaman customer, bukan /admin/* → jangan di-rewrite.
    // - /onboarding — guest yg dibuatkan kasir belum onboarded → redirect ke sini
    // - /auth — kalau session guest perlu login/daftar
    // - /api/* — API routes
    // Tanpa ini, route customer di atas di-rewrite ke /admin/* (tak ada) → 404
    // saat staff mengaksesnya dari subdomain admin (mis. buka meja → onboarding).
    const skipRewrite =
      path.startsWith("/admin") ||
      path.startsWith("/staff") ||
      path.startsWith("/session") ||
      path.startsWith("/bar") ||
      path.startsWith("/open-table") ||
      path.startsWith("/booking") ||
      path.startsWith("/onboarding") ||
      path.startsWith("/auth") ||
      // Bell notif ada di dashboard staff (kasir/waiter) yg dibuka dari
      // subdomain admin → /notifications harus bisa diakses (halaman customer,
      // bukan /admin/*). Tanpa ini staff klik bell → 404.
      path.startsWith("/notifications") ||
      path.startsWith("/api/") ||
      // Service worker & PWA manifest harus di-serve apa adanya (jangan
      // di-rewrite ke /admin/* → 404 → SW gagal register, push toggle hang).
      path === "/sw.js" ||
      path === "/manifest.webmanifest" ||
      path === "/manifest.json";

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

  // Belum login (customer) → arahkan ke /auth, kecuali path PUBLIK. Auth & legal
  // & join-via-QR tetap boleh dibuka anonim. API/SSE tak di-redirect (biar fetch
  // dapat 401/JSON, bukan HTML redirect).
  if (!isAdmin && !req.auth?.user?.id) {
    const isPublic =
      // /auth DAN sub-path-nya (mis. /auth/forgot) — halaman lupa password
      // wajib bisa dibuka justru saat user BELUM login.
      path === "/auth" ||
      path.startsWith("/auth/") ||
      path === "/terms" ||
      path === "/privacy" ||
      path === "/maintenance" ||
      path.startsWith("/join/") ||
      path.startsWith("/api/");
    if (!isPublic) {
      const url = req.nextUrl.clone();
      url.pathname = "/auth";
      if (path !== "/") url.searchParams.set("next", path);
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Match all paths kecuali static assets, images, service worker, manifest,
    // dan API auth (Auth.js handle sendiri).
    "/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|manifest.json|api/auth|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
