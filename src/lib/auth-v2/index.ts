/**
 * Public API untuk lib/auth-v2.
 *
 * Caller (Server Actions, Server Components) cuma import dari sini —
 * tidak boleh import langsung dari sub-file.
 *
 * Ini abstraction boundary: kalau ganti dari Auth.js ke library lain,
 * implementasi di balik export tetap sama signature-nya.
 */

// Server helpers (current session, profile, role guards)
export {
  getCurrentUser,
  getCurrentProfile,
  requireUser,
  requireProfile,
  requireAdmin,
  requireStaff,
  getStaffRole,
} from "./current";
export type { AuthUser, Profile, StaffContext } from "./current";

// Signup flow (custom, bukan dari Auth.js)
export { signup, SignupError } from "./signup";
export type { SignupInput, SignupResult } from "./signup";

// Password utilities
export { hashPassword, verifyPassword } from "./password";

// Email utilities (re-export untuk reusable di Server Actions lain)
export { sendEmail } from "./email-service";
export type { SendEmailInput, SendEmailResult } from "./email-service";

// Auth.js core re-exports (untuk Server Action callers)
export { signIn, signOut, auth } from "@/auth";
