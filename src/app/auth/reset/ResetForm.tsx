"use client";

import * as React from "react";
import { toast } from "sonner";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { updatePassword } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { cn, getActionErrorMessage } from "@/lib/utils";

export function ResetForm({ email }: { email: string }) {
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [show, setShow] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password minimal 6 karakter");
    if (password !== confirm) return toast.error("Password tidak cocok");

    setLoading(true);
    try {
      await updatePassword({ password });
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal update password"));
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-xs tracking-[0.3em] uppercase text-primary/70 font-medium">
            SOHO Social House
          </span>
        </div>
        <CardTitle className="text-2xl flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          Set Password Baru
        </CardTitle>
        <CardDescription>
          Untuk akun <span className="text-foreground">{email}</span>. Pastikan
          password baru kuat dan minimal 6 karakter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <input
              type={show ? "text" : "password"}
              placeholder="Password baru (min 6)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              minLength={6}
              autoComplete="new-password"
              className={cn(inputCls, "pr-10")}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide" : "Show"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <input
            type={show ? "text" : "password"}
            placeholder="Konfirmasi password baru"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={6}
            autoComplete="new-password"
            className={inputCls}
          />

          <Button
            type="submit"
            variant="gold"
            size="lg"
            className="w-full"
            disabled={loading}
          >
            {loading ? "Memperbarui..." : "Simpan Password Baru"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const inputCls =
  "w-full h-11 px-3 rounded-md bg-input border border-border text-foreground focus:outline-none focus:border-primary/60 transition";
