import { Suspense } from "react";
import { AuthForm } from "./AuthForm";

export default function AuthPage() {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <Suspense>
        <AuthForm />
      </Suspense>
    </main>
  );
}
