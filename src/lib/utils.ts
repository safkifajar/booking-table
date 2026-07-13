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
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
 * Cek apakah error berasal dari pelanggaran constraint DB tertentu.
 * Drizzle membungkus error postgres.js: `err.message` jadi generik
 * ("Failed query: ..."), detail asli (code 23xxx, constraint_name) ada di
 * `err.cause`. Helper ini memeriksa error DAN cause-nya.
 */
export function isDbConstraintError(err: unknown, constraintName: string): boolean {
  const layers = [err, (err as { cause?: unknown })?.cause];
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    const l = layer as { constraint_name?: string; message?: string };
    if (l.constraint_name === constraintName) return true;
    if (typeof l.message === "string" && l.message.includes(constraintName)) {
      return true;
    }
  }
  return false;
}

/**
 * Aturan format username (handle): 3-20 karakter, lowercase, hanya a-z 0-9 _.
 * Dipakai di registrasi, edit profil, dan admin.
 */
export const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

/**
 * Normalisasi + validasi username. Return { ok, value?, error? }.
 * Lowercase-kan dulu (biar "Budi" == "budi"). Kosong → error.
 */
export function normalizeUsername(
  raw: string
): { ok: true; value: string } | { ok: false; error: string } {
  const v = raw.trim().toLowerCase();
  if (v.length === 0) return { ok: false, error: "Username is required" };
  if (v.length < 3) return { ok: false, error: "Username must be at least 3 characters" };
  if (v.length > 20) return { ok: false, error: "Username must be at most 20 characters" };
  if (!USERNAME_REGEX.test(v)) {
    return { ok: false, error: "Username may only contain lowercase letters, numbers, and _" };
  }
  return { ok: true, value: v };
}

/**
 * Use inside `catch` of client-side Server Action calls. Re-throws Next's
 * internal redirect signal so it can complete navigation, otherwise returns
 * the user-facing message for `toast.error()`.
 */
export function getActionErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (isRedirectError(err)) {
    // Re-throw so Next.js can process the redirect.
    throw err;
  }
  return err instanceof Error ? err.message : fallback;
}
