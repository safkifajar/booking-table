import { AdminForgotForm } from "./AdminForgotForm";

export const metadata = {
  title: "Forgot password",
};

/**
 * Lupa password STAFF — dibuka dari halaman login admin.
 *
 * Berbeda dari /auth/forgot milik tamu: tautan yang dikirim mengarah ke
 * domain admin, dan requestPasswordReset("admin") hanya melayani akun yang
 * punya peran staff aktif.
 */
export default function AdminForgotPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      <AdminForgotForm />
    </main>
  );
}
