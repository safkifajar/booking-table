"use server";

/**
 * Server Actions untuk admin manage staff.
 *
 * Onboarding flow: admin invite by email — kalau user belum terdaftar di
 * aplikasi, kita create account dengan passwordHash=null + kirim email
 * berisi token untuk set password. Kalau user sudah ada, skip email,
 * langsung assign role pakai password existing.
 *
 * Operations:
 * - listStaffForBar: list semua staff di bar
 * - inviteStaff: create user (kalau perlu) + assign role + send email
 * - updateStaffRole: ubah role staff existing
 * - toggleStaffActive: activate/deactivate
 * - resendInvite: send ulang setup password email
 */

import { revalidatePath } from "next/cache";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/client";
import { staffRoles } from "@/lib/db/schema/extras";
import { users, verificationTokens } from "@/lib/db/schema/auth";
import { profiles } from "@/lib/db/schema/profiles";
import { bars } from "@/lib/db/schema/venue";
import {
  requirePermission,
  type StaffRoleName,
} from "@/lib/auth-v2/permissions";
import { sendEmail } from "@/lib/auth-v2/email-service";
import { staffInviteEmail } from "@/lib/auth-v2/email-template";

// ============================================================
// LIST
// ============================================================

export interface AdminStaffRow {
  id: string;
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
  role: StaffRoleName;
  isActive: boolean;
  /** True kalau user belum set password (invite pending) */
  hasPassword: boolean;
  createdAt: Date;
}

export async function listStaffForBar(barId: string): Promise<AdminStaffRow[]> {
  await requirePermission("manage_staff", "/admin/staff");

  const rows = await db
    .select({
      id: staffRoles.id,
      userId: profiles.id,
      displayName: profiles.displayName,
      email: users.email,
      avatarUrl: profiles.avatarUrl,
      role: staffRoles.role,
      isActive: staffRoles.isActive,
      passwordHash: users.passwordHash,
      createdAt: staffRoles.createdAt,
    })
    .from(staffRoles)
    .innerJoin(profiles, eq(profiles.id, staffRoles.profileId))
    .innerJoin(users, eq(users.id, profiles.id))
    .where(eq(staffRoles.barId, barId))
    .orderBy(staffRoles.createdAt);

  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    displayName: r.displayName,
    email: r.email,
    avatarUrl: r.avatarUrl,
    role: r.role as StaffRoleName,
    isActive: r.isActive,
    hasPassword: !!r.passwordHash,
    createdAt: r.createdAt,
  }));
}

// ============================================================
// INVITE STAFF (new or existing user)
// ============================================================

const inviteSchema = z.object({
  barId: z.string().uuid(),
  email: z.string().email("Invalid email").max(255),
  displayName: z.string().min(2, "Name must be at least 2 characters").max(40),
  role: z.enum(["waiter", "cashier", "manager", "admin"]),
});

const ROLE_LABELS: Record<StaffRoleName, string> = {
  admin: "Admin",
  manager: "Manager",
  cashier: "Kasir",
  waiter: "Waiter",
};

const SETUP_TOKEN_TTL_DAYS = 7;

export interface InviteResult {
  staffRoleId: string;
  /** True kalau user baru dibuat (atau existing tanpa password — perlu setup) */
  isNewUser: boolean;
  /** True kalau email berhasil dikirim (atau dry-run di dev) */
  emailSent: boolean;
  /** Setup URL — admin bisa copy & kirim manual ke karyawan via WhatsApp/SMS.
   *  Null kalau user existing yang sudah punya password (tidak butuh setup). */
  setupUrl: string | null;
}

export async function inviteStaff(
  input: z.infer<typeof inviteSchema>
): Promise<InviteResult> {
  const ctx = await requirePermission("manage_staff", "/admin/staff");
  const data = inviteSchema.parse(input);

  if (data.barId !== ctx.barId) {
    throw new Error("Invalid bar");
  }

  const email = data.email.toLowerCase().trim();
  const displayName = data.displayName.trim();

  // Cek user existing
  const [existingUser] = await db
    .select({ id: users.id, passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.email, email));

  // Step 1: pastikan user + profile + staff_role ready dalam transaction
  const result = await db.transaction(async (tx) => {
    let userId: string;
    let isNewUser = false;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create user baru (passwordHash = null — user set via setup link)
      const [newUser] = await tx
        .insert(users)
        .values({
          email,
          name: displayName,
          // emailVerified langsung set sebagai bukti owner-trusted onboarding
          emailVerified: new Date(),
        })
        .returning({ id: users.id });
      userId = newUser.id;
      isNewUser = true;

      // Create profile
      await tx.insert(profiles).values({
        id: userId,
        displayName,
      });
    }

    // Cek staff_role existing untuk pair (bar, user)
    const [existingRole] = await tx
      .select({ id: staffRoles.id })
      .from(staffRoles)
      .where(
        and(eq(staffRoles.barId, data.barId), eq(staffRoles.profileId, userId))
      );

    let staffRoleId: string;
    if (existingRole) {
      await tx
        .update(staffRoles)
        .set({ role: data.role, isActive: true })
        .where(eq(staffRoles.id, existingRole.id));
      staffRoleId = existingRole.id;
    } else {
      const [created] = await tx
        .insert(staffRoles)
        .values({
          barId: data.barId,
          profileId: userId,
          role: data.role,
          isActive: true,
        })
        .returning({ id: staffRoles.id });
      staffRoleId = created.id;
    }

    return { staffRoleId, userId, isNewUser };
  });

  // Step 2: kalau user baru (atau existing tanpa password), generate setup
  // URL + coba kirim email. URL selalu di-return supaya admin bisa copy manual
  // kalau email gagal (Resend free tier, dll).
  const shouldSendEmail =
    result.isNewUser || (existingUser && !existingUser.passwordHash);

  let emailSent = false;
  let setupUrl: string | null = null;

  if (shouldSendEmail) {
    const inviteResult = await sendStaffInvite({
      userId: result.userId,
      email,
      displayName,
      role: data.role,
      barId: data.barId,
    });
    emailSent = inviteResult.emailSent;
    setupUrl = inviteResult.setupUrl;
  }

  revalidatePath("/admin/staff");
  return {
    staffRoleId: result.staffRoleId,
    isNewUser: result.isNewUser,
    emailSent,
    setupUrl,
  };
}

/**
 * Generate token + simpan + kirim email.
 * Pakai verification_tokens table (Auth.js standard).
 * Identifier = email, untuk consistency dengan magic link flow.
 */
async function sendStaffInvite(args: {
  userId: string;
  email: string;
  displayName: string;
  role: StaffRoleName;
  barId: string;
}): Promise<{ emailSent: boolean; setupUrl: string }> {
  // Hapus token lama (kalau ada) supaya hanya 1 active token per email
  await db
    .delete(verificationTokens)
    .where(eq(verificationTokens.identifier, args.email));

  // Generate token raw (32 bytes hex = 64 char) — pakai prefix "staff_" supaya
  // distinguish dari magic link token saat verify nanti
  const rawToken = `staff_${randomBytes(32).toString("hex")}`;
  const expires = new Date(
    Date.now() + SETUP_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );

  await db.insert(verificationTokens).values({
    identifier: args.email,
    token: rawToken, // simpan raw (kita verify dengan exact match di setup page)
    expires,
  });

  // Lookup bar name untuk email
  const [bar] = await db
    .select({ name: bars.name })
    .from(bars)
    .where(eq(bars.id, args.barId));
  const barName = bar?.name ?? "SOHO Social House";

  // Build setup URL — di production pakai admin subdomain
  const baseUrl = process.env.AUTH_URL ?? "http://localhost:3000";
  let adminBaseUrl = baseUrl;
  try {
    const url = new URL(baseUrl);
    // Tambah "admin." ke host
    if (!url.hostname.startsWith("admin.")) {
      url.hostname = `admin.${url.hostname}`;
    }
    adminBaseUrl = url.toString().replace(/\/$/, "");
  } catch {
    // Kalau parse gagal, fallback ke baseUrl
  }

  const setupUrl = `${adminBaseUrl}/setup-password?token=${encodeURIComponent(
    rawToken
  )}&email=${encodeURIComponent(args.email)}`;

  const { html, text } = staffInviteEmail({
    setupUrl,
    email: args.email,
    displayName: args.displayName,
    roleLabel: ROLE_LABELS[args.role],
    barName,
    expiresIn: `${SETUP_TOKEN_TTL_DAYS} hari`,
  });

  try {
    const result = await sendEmail({
      to: args.email,
      subject: `Kamu di-invite jadi ${ROLE_LABELS[args.role]} di ${barName}`,
      html,
      text,
    });
    console.log(
      `[inviteStaff] email ${result.dryRun ? "DRY-RUN" : "SENT"} to ${args.email}`
    );
    return { emailSent: true, setupUrl };
  } catch (err) {
    console.error("[inviteStaff] sendEmail failed:", err);
    console.error(`[inviteStaff] ⚠️  Setup URL untuk ${args.email}: ${setupUrl}`);
    return { emailSent: false, setupUrl };
  }
}

/**
 * Re-send invite email untuk staff yang belum set password.
 * Return URL juga supaya admin bisa copy manual.
 */
export async function resendInvite(
  staffRoleId: string
): Promise<{ emailSent: boolean; setupUrl: string }> {
  const ctx = await requirePermission("manage_staff", "/admin/staff");

  const [row] = await db
    .select({
      barId: staffRoles.barId,
      profileId: staffRoles.profileId,
      role: staffRoles.role,
      email: users.email,
      displayName: profiles.displayName,
      passwordHash: users.passwordHash,
    })
    .from(staffRoles)
    .innerJoin(users, eq(users.id, staffRoles.profileId))
    .innerJoin(profiles, eq(profiles.id, staffRoles.profileId))
    .where(eq(staffRoles.id, staffRoleId));

  if (!row) throw new Error("Staff not found");
  if (row.barId !== ctx.barId) throw new Error("Invalid bar access");
  if (row.passwordHash) {
    throw new Error("User has already set a password, no need to re-invite");
  }

  return sendStaffInvite({
    userId: row.profileId,
    email: row.email,
    displayName: row.displayName,
    role: row.role as StaffRoleName,
    barId: row.barId,
  });
}

// ============================================================
// UPDATE ROLE
// ============================================================

const updateRoleSchema = z.object({
  staffRoleId: z.string().uuid(),
  role: z.enum(["waiter", "cashier", "manager", "admin"]),
});

export async function updateStaffRole(
  input: z.infer<typeof updateRoleSchema>
): Promise<void> {
  const ctx = await requirePermission("manage_staff", "/admin/staff");
  const data = updateRoleSchema.parse(input);

  const [existing] = await db
    .select({ barId: staffRoles.barId, profileId: staffRoles.profileId })
    .from(staffRoles)
    .where(eq(staffRoles.id, data.staffRoleId));
  if (!existing) throw new Error("Staff role not found");
  if (existing.barId !== ctx.barId) {
    throw new Error("No access to staff role in another bar");
  }
  if (existing.profileId === ctx.profileId) {
    throw new Error("You cannot change your own role");
  }

  await db
    .update(staffRoles)
    .set({ role: data.role })
    .where(eq(staffRoles.id, data.staffRoleId));

  revalidatePath("/admin/staff");
}

// ============================================================
// UPDATE STAFF (nama + email + role) — dialog Edit Staff
// ============================================================

const updateStaffSchema = z.object({
  staffRoleId: z.string().uuid(),
  displayName: z.string().min(1, "Name is required").max(80),
  email: z.string().email("Invalid email").max(120),
  role: z.enum(["waiter", "cashier", "manager", "admin"]),
  isActive: z.boolean(),
  /** Reset password opsional — kosong = tidak diubah. */
  password: z.string().min(6, "Password must be at least 6 characters").max(100).optional(),
});

/**
 * Edit data staff: nama, email, role, status aktif, & reset password (opsional)
 * sekaligus. Nama disimpan ganda (users.name + profiles.displayName) konsisten
 * dgn inviteStaff. Email unik (kecuali milik sendiri). Untuk DIRI SENDIRI: role
 * tidak boleh diubah & tidak boleh dinonaktifkan (cegah admin mengunci diri).
 */
export async function updateStaff(
  input: z.infer<typeof updateStaffSchema>
): Promise<void> {
  const ctx = await requirePermission("manage_staff", "/admin/staff");
  const data = updateStaffSchema.parse(input);
  const email = data.email.trim().toLowerCase();
  const displayName = data.displayName.trim();

  const [existing] = await db
    .select({
      barId: staffRoles.barId,
      profileId: staffRoles.profileId,
      role: staffRoles.role,
    })
    .from(staffRoles)
    .where(eq(staffRoles.id, data.staffRoleId));
  if (!existing) throw new Error("Staff role not found");
  if (existing.barId !== ctx.barId) {
    throw new Error("No access to staff role in another bar");
  }
  const isSelf = existing.profileId === ctx.profileId;
  if (isSelf) {
    if (data.role !== existing.role) {
      throw new Error("You cannot change your own role");
    }
    if (!data.isActive) {
      throw new Error("You cannot deactivate yourself");
    }
  }

  // Email unik kecuali milik user ini sendiri.
  const [dupe] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, email), sql`${users.id} <> ${existing.profileId}`));
  if (dupe) throw new Error("Email is already used by another account");

  // Hash password kalau di-reset.
  let passwordHash: string | null = null;
  if (data.password) {
    const { hashPassword } = await import("@/lib/auth-v2/password");
    passwordHash = await hashPassword(data.password);
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ email, name: displayName, ...(passwordHash ? { passwordHash } : {}) })
      .where(eq(users.id, existing.profileId));
    await tx
      .update(profiles)
      .set({ displayName })
      .where(eq(profiles.id, existing.profileId));
    await tx
      .update(staffRoles)
      .set({ role: data.role, isActive: data.isActive })
      .where(eq(staffRoles.id, data.staffRoleId));
  });

  revalidatePath("/admin/staff");
}

// ============================================================
// TOGGLE ACTIVE
// ============================================================

export async function toggleStaffActive(
  staffRoleId: string,
  isActive: boolean
): Promise<void> {
  const ctx = await requirePermission("manage_staff", "/admin/staff");

  const [existing] = await db
    .select({ barId: staffRoles.barId, profileId: staffRoles.profileId })
    .from(staffRoles)
    .where(eq(staffRoles.id, staffRoleId));
  if (!existing) throw new Error("Staff role not found");
  if (existing.barId !== ctx.barId) {
    throw new Error("No access to staff role in another bar");
  }
  if (existing.profileId === ctx.profileId && !isActive) {
    throw new Error("You cannot deactivate yourself");
  }

  await db
    .update(staffRoles)
    .set({ isActive })
    .where(eq(staffRoles.id, staffRoleId));

  revalidatePath("/admin/staff");
}

// ============================================================
// SETUP PASSWORD (dari email link)
// ============================================================

const setupPasswordSchema = z
  .object({
    token: z.string().min(20),
    email: z.string().email(),
    password: z.string().min(6, "Password must be at least 6 characters").max(100),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Password confirmation does not match",
    path: ["confirmPassword"],
  });

export interface SetupResult {
  ok: boolean;
  error?: string;
}

/**
 * Set password dari token email invite.
 *
 * Public action — tidak butuh auth.
 * Flow:
 * 1. Validate token (exists + not expired)
 * 2. Hash password + update users.passwordHash
 * 3. Delete token (one-time use)
 *
 * Caller harus signIn manual setelah ini sukses (via signInAction).
 */
export async function setupPasswordWithToken(
  input: z.infer<typeof setupPasswordSchema>
): Promise<SetupResult> {
  let data: z.infer<typeof setupPasswordSchema>;
  try {
    data = setupPasswordSchema.parse(input);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { ok: false, error: err.issues[0]?.message ?? "Invalid input" };
    }
    throw err;
  }

  // 1. Validate token
  const now = new Date();
  const [token] = await db
    .select({
      identifier: verificationTokens.identifier,
      expires: verificationTokens.expires,
    })
    .from(verificationTokens)
    .where(
      and(
        eq(verificationTokens.token, data.token),
        eq(verificationTokens.identifier, data.email.toLowerCase()),
        gt(verificationTokens.expires, now)
      )
    );

  if (!token) {
    return {
      ok: false,
      error:
        "Invite link is invalid or has expired. Ask your admin to resend it.",
    };
  }

  // 2. Hash password + update user
  const { hashPassword } = await import("@/lib/auth-v2/password");
  const newHash = await hashPassword(data.password);

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(users.email, token.identifier));

    // 3. Delete token (one-time use)
    await tx
      .delete(verificationTokens)
      .where(
        and(
          eq(verificationTokens.token, data.token),
          eq(verificationTokens.identifier, token.identifier)
        )
      );
  });

  return { ok: true };
}

// Suppress unused warning
void sql;
