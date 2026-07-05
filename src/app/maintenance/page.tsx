/**
 * Halaman "Coming Soon" / maintenance. Ditampilkan saat MAINTENANCE_MODE=true
 * untuk subdomain customer (production live tapi belum dibuka ke user).
 *
 * Middleware me-rewrite semua request customer ke sini saat gate aktif —
 * subdomain admin TIDAK terkena (operator tetap bisa setup/login).
 */
export const dynamic = "force-static";

export const metadata = {
  title: "SOHO Social House — Segera Hadir",
  description: "Kami sedang menyiapkan pengalaman terbaik untukmu.",
};

export default function MaintenancePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-primary px-3 py-1.5 text-lg font-bold tracking-tight text-primary-foreground">
          SO.HO
        </span>
      </div>
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold text-foreground sm:text-3xl">
          Segera Hadir ✨
        </h1>
        <p className="mx-auto max-w-md text-sm text-muted-foreground sm:text-base">
          SOHO Social House sedang menyiapkan pengalaman nongkrong &amp; reservasi
          meja terbaik untukmu. Nantikan pembukaannya!
        </p>
      </div>
      <p className="text-xs text-muted-foreground/70">
        © SOHO Social House
      </p>
    </main>
  );
}
