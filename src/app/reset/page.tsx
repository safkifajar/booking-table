import Link from "next/link";
import { Shield } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { verifyResetToken } from "@/lib/auth-v2/reset-password";
import { AdminResetForm } from "./AdminResetForm";

export const metadata = {
  title: "Set a new password",
};

// Token diperiksa tiap kali dibuka — jangan dilayani dari cache.
export const dynamic = "force-dynamic";

/**
 * Menyetel password staff, dibuka dari tautan di email.
 *
 * Token diperiksa DI SERVER sebelum form tampil: tanpa itu staff mengetikkan
 * password baru dulu, baru diberi tahu tautannya sudah kedaluwarsa.
 */
export default async function AdminResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; email?: string }>;
}) {
  const { token = "", email = "" } = await searchParams;
  const check = await verifyResetToken(token, email);

  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950">
      {check.ok ? (
        <AdminResetForm token={token} email={email} />
      ) : (
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <span className="mx-auto mb-2 inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Shield className="h-6 w-6" />
            </span>
            <CardTitle>Link expired</CardTitle>
            <CardDescription>
              {check.error ?? "This reset link is no longer valid."} Reset links
              work once and expire after 30 minutes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/forgot"
              className="flex h-10 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              Request a new link
            </Link>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
