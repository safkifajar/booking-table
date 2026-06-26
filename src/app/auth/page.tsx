import { Suspense } from "react";
import { AuthForm } from "./AuthForm";

export default function AuthPage() {
  return (
    <main className="relative flex-1 flex items-center justify-center px-4 py-12 overflow-hidden">
      {/* Lapisan brand SOHO (marun) — latar, bukan elemen aksi */}
      <div className="absolute inset-0 bg-brand-gradient opacity-90" aria-hidden />
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(240,230,210,0.10),transparent_60%)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-md">
        <Suspense>
          <AuthForm />
        </Suspense>
      </div>
    </main>
  );
}
