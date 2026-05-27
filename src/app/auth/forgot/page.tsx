import { Suspense } from "react";
import { ForgotForm } from "./ForgotForm";

export default function ForgotPasswordPage() {
  return (
    <main className="flex-1 flex items-center justify-center px-4 py-12">
      <Suspense>
        <ForgotForm />
      </Suspense>
    </main>
  );
}
