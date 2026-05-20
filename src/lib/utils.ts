import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatIDR(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatIDRShort(amount: number): string {
  if (amount >= 1_000_000) return `Rp${(amount / 1_000_000).toFixed(1)}jt`;
  if (amount >= 1_000) return `Rp${(amount / 1_000).toFixed(0)}rb`;
  return `Rp${amount}`;
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} mnt yang lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam yang lalu`;
  const days = Math.floor(hours / 24);
  return `${days} hari yang lalu`;
}

export function generateInviteCode(length = 6): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function initials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/**
 * Detect Next.js internal `redirect()` exception so we don't show it as a
 * user-facing error. Re-throw it from try/catch blocks in client components
 * that call Server Actions which redirect.
 *
 * Next sets a digest like "NEXT_REDIRECT;replace;/foo;..." on the Error.
 */
export function isRedirectError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: string }).digest;
  const message = (err as { message?: string }).message;
  return (
    (typeof digest === "string" && digest.startsWith("NEXT_REDIRECT")) ||
    message === "NEXT_REDIRECT"
  );
}

/**
 * Use inside `catch` of client-side Server Action calls. Re-throws Next's
 * internal redirect signal so it can complete navigation, otherwise returns
 * the user-facing message for `toast.error()`.
 */
export function getActionErrorMessage(err: unknown, fallback = "Terjadi kesalahan"): string {
  if (isRedirectError(err)) {
    // Re-throw so Next.js can process the redirect.
    throw err;
  }
  return err instanceof Error ? err.message : fallback;
}
