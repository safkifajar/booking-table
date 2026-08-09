import { ForgotForm } from "./ForgotForm";

export const metadata = {
  title: "Forgot password",
};

/**
 * Halaman "lupa password" — user isi email lalu diarahkan ke WhatsApp CS
 * dengan pesan yang sudah terisi. Reset dilakukan admin setelah verifikasi.
 */
export default function ForgotPasswordPage() {
  return (
    <main
      className="relative flex-1 flex items-stretch justify-center px-6 pt-4 pb-5 overflow-hidden"
      style={{ background: "#8d1312" }}
    >
      {/* Rata ATAS (bukan center) — judul & field di atas, tombol di bawah. */}
      <div className="relative z-10 w-full max-w-sm flex flex-col">
        <ForgotForm />
      </div>
    </main>
  );
}
