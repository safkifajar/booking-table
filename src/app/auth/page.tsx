import { Suspense } from "react";
import { AuthForm } from "./AuthForm";

export default function AuthPage() {
  return (
    <main
      className="relative flex-1 flex items-center justify-center px-6 py-12 overflow-hidden"
      style={{ background: "#8d1312" }}
    >
      {/* Latar solid #8d1312 (= bg logo JPEG) supaya logo menyatu mulus. */}
      <div className="relative z-10 w-full max-w-sm">
        <Suspense>
          <AuthForm />
        </Suspense>
      </div>
    </main>
  );
}
