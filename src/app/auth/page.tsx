import { Suspense } from "react";
import { AuthForm } from "./AuthForm";

export default function AuthPage() {
  return (
    <main
      className="relative flex-1 flex items-center justify-center px-6 py-12 overflow-hidden"
      style={{ background: "#8d1312" }}
    >
      {/* glow halus krem di tengah */}
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_40%,rgba(240,230,210,0.08),transparent_60%)]"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-sm">
        <Suspense>
          <AuthForm />
        </Suspense>
      </div>
    </main>
  );
}
