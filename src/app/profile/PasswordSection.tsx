"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, Eye, EyeOff, KeyRound } from "lucide-react";
import { changePassword } from "@/lib/actions";
import { getActionErrorMessage, cn } from "@/lib/utils";

interface Props {
  hasPassword: boolean;
}

export function PasswordSection({ hasPassword }: Props) {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  function resetForm() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast.error("New password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Password confirmation doesn't match");
      return;
    }
    if (hasPassword && !currentPassword) {
      toast.error("Current password is required");
      return;
    }

    setLoading(true);
    try {
      await changePassword({
        currentPassword: hasPassword ? currentPassword : undefined,
        newPassword,
        confirmPassword,
      });
      toast.success(
        hasPassword
          ? "Password changed successfully"
          : "Password set successfully. You can now sign in with email + password."
      );
      resetForm();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Failed to change password"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {hasPassword ? (
            <>
              <Lock className="h-4 w-4 text-primary" />
              Change Password
            </>
          ) : (
            <>
              <KeyRound className="h-4 w-4 text-primary" />
              Set Password
            </>
          )}
        </CardTitle>
        <CardDescription>
          {hasPassword
            ? "Use a strong, unique password. Min 6 characters."
            : "You signed in via magic link. Set a password so you can also sign in with email + password."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Current password — hanya kalau hasPassword */}
          {hasPassword && (
            <PasswordField
              label="Current password"
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrent}
              onToggleShow={() => setShowCurrent((v) => !v)}
              autoComplete="current-password"
            />
          )}

          <PasswordField
            label={hasPassword ? "New password" : "Password"}
            value={newPassword}
            onChange={setNewPassword}
            show={showNew}
            onToggleShow={() => setShowNew((v) => !v)}
            autoComplete="new-password"
            minLength={6}
          />

          <PasswordField
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            show={showNew}
            onToggleShow={() => setShowNew((v) => !v)}
            autoComplete="new-password"
            minLength={6}
            error={
              confirmPassword.length > 0 && confirmPassword !== newPassword
                ? "Doesn't match the new password"
                : null
            }
          />

          <div className="flex justify-end gap-2">
            <Button
              type="submit"
              variant="gold"
              size="lg"
              disabled={loading || !newPassword || !confirmPassword}
            >
              {loading
                ? "Saving..."
                : hasPassword
                  ? "Change Password"
                  : "Set Password"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggleShow,
  autoComplete,
  minLength,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  autoComplete: string;
  minLength?: number;
  error?: string | null;
}) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-1.5">
        {label}
      </label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={100}
          className={cn(
            "w-full h-11 px-3 pr-10 rounded-md bg-input border border-border focus:outline-none focus:border-primary/60 transition",
            error && "border-red-500/60"
          )}
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={show ? "Hide" : "Show"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && (
        <p className="text-xs text-red-400 mt-1">{error}</p>
      )}
    </div>
  );
}
