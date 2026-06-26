import { Suspense } from "react";
import { AuthForm } from "./AuthForm";

export default function AuthPage() {
  return (
    <main className="auth-bg relative flex-1 flex items-center justify-center px-4 py-12 overflow-hidden">
      <div className="relative z-10 w-full max-w-md">
        <Suspense>
          <AuthForm />
        </Suspense>
      </div>
    </main>
  );
}
