import { ForgotForm } from "./ForgotForm";
import { getBarContactWa } from "@/lib/settings-actions";

export const metadata = {
  title: "Forgot password",
};

/**
 * Halaman "lupa password" — user isi email, tautan reset dikirim ke email
 * itu. WhatsApp CS tetap ada sebagai jalur cadangan untuk tamu yang tak bisa
 * membuka emailnya.
 */
export default async function ForgotPasswordPage() {
  // Nomor CS dari DB (server) → props ke komponen client.
  const contactWa = await getBarContactWa();
  return (
    <main
      className="relative flex-1 flex items-stretch justify-center px-6 pt-4 pb-5 overflow-hidden"
      style={{ background: "#8d1312" }}
    >
      {/* Rata ATAS (bukan center) — judul & field di atas, tombol di bawah. */}
      <div className="relative z-10 w-full max-w-sm flex flex-col">
        <ForgotForm contactWa={contactWa} />
      </div>
    </main>
  );
}
