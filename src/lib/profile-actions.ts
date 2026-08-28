"use server";

/**
 * Server Actions untuk PROFIL PENGGUNA — data diri, onboarding, kata sandi,
 * dan foto.
 *
 * Dipisah dari actions.ts (yang 5.208 baris) mengikuti pola yang sudah ada
 * di project ini: cashier-actions, waiter-actions, membership-actions.
 * Bagian ini paling mandiri — tak menyentuh sesi meja, pesanan, maupun
 * pembayaran sama sekali.
 *
 * actions.ts MENERUSKAN ekspor dari sini, jadi 29 berkas yang mengimpor
 * dari sana tak perlu disentuh.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { profiles } from "@/lib/db/schema/profiles";
import { and, eq, ne } from "drizzle-orm";
import { requireProfile } from "@/lib/auth-v2/current";
import { normalizeUsername } from "@/lib/utils";
import { logIfStaff } from "@/lib/activity-log";

// PROFILE
// ============================================================

const updateProfileSchema = z.object({
  displayName: z.string().min(2, "Name must be at least 2 characters").max(40),
  /** Username unik. Kosong = tak diubah (biarkan yg ada). */
  username: z.string().optional().or(z.literal("")),
  phone: z
    .string()
    .max(20)
    .regex(/^[\d\s+\-()]*$/, "Invalid WhatsApp number format")
    .optional()
    .or(z.literal("")),
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date format")
    .optional()
    .or(z.literal("")),
  bio: z.string().max(280, "Max 280 characters").optional().or(z.literal("")),
  gender: z.enum(["male", "female"]).optional().or(z.literal("")),
  interestedIn: z.enum(["male", "female", "both"]).optional().or(z.literal("")),
  socialLink: z.string().max(200).optional().or(z.literal("")),
  area: z.string().max(120).optional().or(z.literal("")),
  lookingFor: z
    .enum(["relationship", "casual", "friendship"])
    .optional()
    .or(z.literal("")),
  education: z
    .enum([
      "high_school",
      "diploma",
      "bachelor",
      "master",
      "doctorate",
      "other",
    ])
    .optional()
    .or(z.literal("")),
  heightCm: z.number().int().min(120).max(230).nullable().optional(),
  religion: z
    .enum([
      "islam",
      "christian",
      "catholic",
      "hindu",
      "buddhist",
      "confucian",
      "spiritual",
    ])
    .optional()
    .or(z.literal("")),
  musicPref: z.string().max(120).optional().or(z.literal("")),
  favFood: z.string().max(120).optional().or(z.literal("")),
  favDrink: z.string().max(120).optional().or(z.literal("")),
  hideHistory: z.boolean().optional(),
  hideLocation: z.boolean().optional(),
  hideAge: z.boolean().optional(),
  hideSocial: z.boolean().optional(),
  hobbies: z.array(z.string().min(1).max(30)).max(15).optional(),
  prompts: z
    .array(
      z.object({
        prompt: z.string().min(1).max(120),
        answer: z.string().min(1).max(280),
      })
    )
    .max(5)
    .optional(),
});

export async function updateProfile(input: z.infer<typeof updateProfileSchema>) {
  const profile = await requireProfile();
  const data = updateProfileSchema.parse(input);

  // Clean hobbies: trim + dedup, preserve original-case
  const hobbies = (data.hobbies ?? [])
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .filter((h, i, arr) => arr.indexOf(h) === i);

  // Clean prompts: trim + buang kosong, maks 5.
  const prompts = (data.prompts ?? [])
    .map((p) => ({ prompt: p.prompt.trim(), answer: p.answer.trim() }))
    .filter((p) => p.prompt && p.answer)
    .slice(0, 5);

  // Username: kalau dikirim & tak kosong → validasi + cek unik (kecuali milik
  // sendiri). Kosong = tak diubah.
  let usernameUpdate: { username: string } | Record<string, never> = {};
  const rawUsername = data.username?.trim();
  if (rawUsername) {
    const u = normalizeUsername(rawUsername);
    if (!u.ok) throw new Error(u.error);
    const [clash] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(eq(profiles.username, u.value), ne(profiles.id, profile.id)));
    if (clash) throw new Error("Username already taken");
    usernameUpdate = { username: u.value };
  }

  await db
    .update(profiles)
    .set({
      displayName: data.displayName,
      ...usernameUpdate,
      phone: data.phone?.trim() || null,
      birthDate: data.birthDate || null,
      bio: data.bio?.trim() || null,
      gender: data.gender || null,
      interestedIn: data.interestedIn || null,
      socialLink: data.socialLink?.trim() || null,
      area: data.area || null,
      lookingFor: data.lookingFor || null,
      education: data.education || null,
      ...(data.heightCm !== undefined ? { heightCm: data.heightCm } : {}),
      religion: data.religion || null,
      musicPref: data.musicPref?.trim() || null,
      favFood: data.favFood?.trim() || null,
      favDrink: data.favDrink?.trim() || null,
      ...(data.hideHistory !== undefined ? { hideHistory: data.hideHistory } : {}),
      ...(data.hideLocation !== undefined ? { hideLocation: data.hideLocation } : {}),
      ...(data.hideAge !== undefined ? { hideAge: data.hideAge } : {}),
      ...(data.hideSocial !== undefined ? { hideSocial: data.hideSocial } : {}),
      hobbies,
      // Hanya tulis prompts kalau caller mengirim (jaga data lama kalau field
      // tak dikirim). Form edit selalu mengirim.
      ...(data.prompts !== undefined ? { prompts } : {}),
    })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
}

/**
 * Update profil STAFF (kasir/waiter) — minimal: hanya nama tampilan. Field
 * lain (WA, bio, gender, dll) TIDAK disentuh (staff tak punya form itu). Foto
 * ditangani AvatarUploader terpisah.
 */
export async function updateStaffProfile(input: { displayName: string }) {
  const profile = await requireProfile();
  const displayName = z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(40)
    .parse(input.displayName.trim());

  // Nama lama diambil SEBELUM update — supaya log bisa menampilkan
  // perubahannya, bukan cuma nama akhirnya.
  const [before] = await db
    .select({ displayName: profiles.displayName })
    .from(profiles)
    .where(eq(profiles.id, profile.id));

  await db
    .update(profiles)
    .set({ displayName })
    .where(eq(profiles.id, profile.id));

  if (before && before.displayName !== displayName) {
    await logIfStaff({
      actorId: profile.id,
      action: "account.name_changed",
      category: "admin",
      entityType: "profile",
      entityId: profile.id,
      summary: `Changed own account name from "${before.displayName}" to "${displayName}"`,
      meta: { from: before.displayName, to: displayName },
    });
  }

  revalidatePath("/staff/profile");
  revalidatePath("/", "layout");
}

/**
 * Set akun privat (ala Instagram) — true = user lain hanya lihat data list
 * network, sisanya diblur+kunci di detail & hangout history disembunyikan.
 */
export async function updatePrivacy(isPrivate: boolean) {
  const profile = await requireProfile();
  await db
    .update(profiles)
    .set({ isPrivate: !!isPrivate })
    .where(eq(profiles.id, profile.id));
  revalidatePath("/profile");
  revalidatePath("/profile/privacy");
  // Detail profil publik ikut berubah gate-nya.
  revalidatePath("/network");
}

// ============================================================
// ONBOARDING (wizard step 2-3 saat daftar)
// ============================================================

const onboardingSchema = z.object({
  // Step 2 — data diri
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal("")),
  gender: z.enum(["male", "female"]).optional().or(z.literal("")),
  interestedIn: z.enum(["male", "female", "both"]).optional().or(z.literal("")),
  area: z.string().max(120).optional().or(z.literal("")),
  socialLink: z.string().max(200).optional().or(z.literal("")),
  // Step 3 — interest & preferensi
  lookingFor: z
    .enum(["relationship", "casual", "friendship"])
    .optional()
    .or(z.literal("")),
  education: z
    .enum([
      "high_school",
      "diploma",
      "bachelor",
      "master",
      "doctorate",
      "other",
    ])
    .optional()
    .or(z.literal("")),
  heightCm: z.number().int().min(120).max(230).nullable().optional(),
  religion: z
    .enum([
      "islam",
      "christian",
      "catholic",
      "hindu",
      "buddhist",
      "confucian",
      "spiritual",
    ])
    .optional()
    .or(z.literal("")),
  musicPref: z.string().max(120).optional().or(z.literal("")),
  favFood: z.string().max(120).optional().or(z.literal("")),
  favDrink: z.string().max(120).optional().or(z.literal("")),
  bio: z.string().max(280).optional().or(z.literal("")),
  hobbies: z.array(z.string().min(1).max(30)).max(15).optional(),
  prompts: z
    .array(
      z.object({
        prompt: z.string().min(1).max(120),
        answer: z.string().min(1).max(280),
      })
    )
    .max(5)
    .optional(),
});

/** Selesaikan onboarding: simpan profil step 2-3 + tandai onboarded=true. */
export async function completeOnboarding(
  input: z.infer<typeof onboardingSchema>
) {
  const profile = await requireProfile();
  const data = onboardingSchema.parse(input);

  const hobbies = (data.hobbies ?? [])
    .map((h) => h.trim())
    .filter((h) => h.length > 0)
    .filter((h, i, arr) => arr.indexOf(h) === i)
    .slice(0, 8); // maks 8 interest (CMB-style "What do you like?")

  await db
    .update(profiles)
    .set({
      birthDate: data.birthDate || null,
      gender: data.gender || null,
      interestedIn: data.interestedIn || null,
      area: data.area || null,
      socialLink: data.socialLink?.trim() || null,
      lookingFor: data.lookingFor || null,
      education: data.education || null,
      heightCm: data.heightCm ?? null,
      religion: data.religion || null,
      musicPref: data.musicPref?.trim() || null,
      favFood: data.favFood?.trim() || null,
      favDrink: data.favDrink?.trim() || null,
      bio: data.bio?.trim() || null,
      hobbies,
      prompts: (data.prompts ?? [])
        .map((p) => ({ prompt: p.prompt.trim(), answer: p.answer.trim() }))
        .filter((p) => p.prompt && p.answer)
        .slice(0, 5),
      onboarded: true,
    })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/", "layout");
}

// ============================================================
// PASSWORD CHANGE
// ============================================================

const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional(), // optional untuk magic-link users
    newPassword: z.string().min(6, "Password must be at least 6 characters").max(100),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Password confirmation does not match",
    path: ["confirmPassword"],
  });

/**
 * Ubah / set password.
 *
 * - Kalau user sudah punya password (passwordHash != null): WAJIB pass
 *   currentPassword yang harus match.
 * - Kalau user belum punya password (signup via magic link): currentPassword
 *   tidak dipakai, langsung set newPassword.
 *
 * Server-side enforce supaya tidak bisa di-bypass dari client.
 */
export async function changePassword(input: z.infer<typeof changePasswordSchema>) {
  const profile = await requireProfile();
  const data = changePasswordSchema.parse(input);

  const { users } = await import("@/lib/db/schema/auth");
  const { hashPassword, verifyPassword } = await import("@/lib/auth-v2/password");

  // Ambil current hash
  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, profile.id));
  if (!user) throw new Error("User not found");

  // Kalau sudah punya password → wajib verify current
  if (user.passwordHash) {
    if (!data.currentPassword) {
      throw new Error("Current password is required");
    }
    const ok = await verifyPassword(data.currentPassword, user.passwordHash);
    if (!ok) throw new Error("Current password is incorrect");
  }

  // Hash + save
  const newHash = await hashPassword(data.newPassword);
  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, profile.id));

  // Audit: HANYA fakta bahwa password diganti — password/hash-nya JANGAN
  // pernah ikut tercatat. Halaman /profile dipakai bersama customer, jadi
  // logIfStaff menyaring supaya cuma aktivitas staff yang masuk.
  await logIfStaff({
    actorId: profile.id,
    action: user.passwordHash ? "account.password_changed" : "account.password_set",
    category: "admin",
    entityType: "profile",
    entityId: profile.id,
    summary: user.passwordHash
      ? "Changed own account password"
      : "Set own account password",
  });

  revalidatePath("/profile");
  return { ok: true };
}

/**
 * Cek apakah user sudah punya password (untuk UI decide section "Set password"
 * vs "Ubah password").
 */
export async function userHasPassword(): Promise<boolean> {
  const profile = await requireProfile();
  const { users } = await import("@/lib/db/schema/auth");

  const [user] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, profile.id));
  return !!user?.passwordHash;
}

// ============================================================
// AVATAR UPLOAD
// ============================================================

const ACCEPTED_AVATAR_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  // iPhone modern default — convert ke JPEG server-side dulu sebelum sharp
  "image/heic",
  "image/heif",
] as const;
const MAX_AVATAR_BYTES = 10 * 1024 * 1024; // 10MB pre-process (HEIC bisa besar)

/**
 * Beberapa browser/OS kirim MIME type kosong atau "application/octet-stream"
 * untuk HEIC dari iPhone. Fallback detect via extension nama file.
 */
function isHeicFile(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
}

/**
 * Upload avatar foto.
 *
 * Flow:
 * 1. Validate file (type, size)
 * 2. Resize ke 256×256 cover crop + convert ke WebP via sharp
 * 3. Hapus avatar lama (kalau ada) supaya tidak menumpuk
 * 4. Upload ke storage adapter (local disk MVP)
 * 5. Update profiles.avatar_url
 *
 * Pakai FormData supaya bisa terima File langsung dari Client Component.
 */
export async function uploadAvatar(formData: FormData): Promise<{ avatarUrl: string }> {
  const profile = await requireProfile();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    throw new Error("Invalid file");
  }
  if (file.size === 0) {
    throw new Error("File is empty");
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error(
      `File is too large (max ${Math.floor(MAX_AVATAR_BYTES / 1024 / 1024)}MB)`
    );
  }
  const heic = isHeicFile(file);
  const validMime = ACCEPTED_AVATAR_TYPES.includes(
    file.type as (typeof ACCEPTED_AVATAR_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("File must be JPG, PNG, WebP, or HEIC");
  }

  const { default: sharp } = await import("sharp");
  const { storage } = await import("@/lib/storage");

  // Read file → kalau HEIC, convert ke JPEG dulu (sharp tidak support HEIC
  // dari npm install — perlu libheif system-wide, tidak portable).
  let inputBuffer = Buffer.from(await file.arrayBuffer());
  if (heic) {
    const { default: heicConvert } = await import("heic-convert");
    inputBuffer = Buffer.from(
      await heicConvert({
        buffer: new Uint8Array(inputBuffer),
        format: "JPEG",
        quality: 0.9,
      })
    );
  }

  // Process: resize 256×256 cover → webp quality 80
  const outputBuffer = await sharp(inputBuffer)
    .rotate() // auto-rotate berdasarkan EXIF (foto dari HP sering miring)
    .resize(256, 256, { fit: "cover", position: "center" })
    .webp({ quality: 80 })
    .toBuffer();

  // Hapus avatar lama kalau ada
  const [oldRow] = await db
    .select({ avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));
  if (oldRow?.avatarUrl) {
    await storage.delete(oldRow.avatarUrl);
  }

  // Upload baru
  const { publicUrl } = await storage.upload({
    buffer: outputBuffer,
    folder: "avatars",
    key: profile.id,
    contentType: "image/webp",
  });

  // Cache-bust: append timestamp supaya browser refresh image kalau user upload ulang
  const versionedUrl = `${publicUrl}?v=${Date.now()}`;

  await db
    .update(profiles)
    .set({ avatarUrl: versionedUrl })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");

  return { avatarUrl: versionedUrl };
}

// Foto profil (galeri): maks 3, tiap ≤4MB (pre-process). Server tetap kompres
// (resize 1080px + webp q80) sbg jaring kedua walau client sudah kompres.
const MAX_PROFILE_PHOTOS = 3;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024;

/** Tambah 1 foto ke galeri profil. Foto pertama otomatis jadi avatar utama. */
export async function uploadProfilePhoto(
  formData: FormData
): Promise<{ photos: string[]; avatarUrl: string | null }> {
  const profile = await requireProfile();
  const file = formData.get("file");

  if (!(file instanceof File)) throw new Error("Invalid file");
  if (file.size === 0) throw new Error("File is empty");
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error(
      `File is too large (max ${Math.floor(MAX_PHOTO_BYTES / 1024 / 1024)}MB)`
    );
  }
  const heic = isHeicFile(file);
  const validMime = ACCEPTED_AVATAR_TYPES.includes(
    file.type as (typeof ACCEPTED_AVATAR_TYPES)[number]
  );
  if (!validMime && !heic) {
    throw new Error("File must be JPG, PNG, WebP, or HEIC");
  }

  const [row] = await db
    .select({ photos: profiles.photos, avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));
  const current = row?.photos ?? [];
  if (current.length >= MAX_PROFILE_PHOTOS) {
    throw new Error(`You can add up to ${MAX_PROFILE_PHOTOS} photos`);
  }

  const { default: sharp } = await import("sharp");
  const { storage } = await import("@/lib/storage");

  let inputBuffer = Buffer.from(await file.arrayBuffer());
  if (heic) {
    const { default: heicConvert } = await import("heic-convert");
    inputBuffer = Buffer.from(
      await heicConvert({
        buffer: new Uint8Array(inputBuffer),
        format: "JPEG",
        quality: 0.9,
      })
    );
  }

  // Resize maks 1080px (sisi terpanjang, tak upscale) → webp q80.
  const outputBuffer = await sharp(inputBuffer)
    .rotate()
    .resize(1080, 1080, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const { publicUrl } = await storage.upload({
    buffer: outputBuffer,
    folder: "photos",
    // key unik per foto (profileId + index + waktu) supaya tak overwrite.
    key: `${profile.id}-${current.length}-${Date.now()}`,
    contentType: "image/webp",
  });

  const photos = [...current, publicUrl];
  // Foto pertama = avatar utama (kalau belum ada avatar).
  const nextAvatar =
    photos.length === 1 ? `${publicUrl}?v=${Date.now()}` : row?.avatarUrl ?? null;

  await db
    .update(profiles)
    .set({ photos, avatarUrl: nextAvatar })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { photos, avatarUrl: nextAvatar };
}

/** Hapus 1 foto galeri (by index). Kalau foto[0] dihapus, avatar ikut geser. */
export async function removeProfilePhoto(
  index: number
): Promise<{ photos: string[]; avatarUrl: string | null }> {
  const profile = await requireProfile();
  const [row] = await db
    .select({ photos: profiles.photos, avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));
  const current = row?.photos ?? [];
  if (index < 0 || index >= current.length) {
    throw new Error("Photo not found");
  }

  const { storage } = await import("@/lib/storage");
  const removedUrl = current[index];
  const photos = current.filter((_, i) => i !== index);

  // Avatar mengikuti foto[0]. Kalau foto pertama berubah/hilang → update avatar.
  const nextAvatar =
    photos.length > 0 ? `${photos[0]}?v=${Date.now()}` : null;

  await db
    .update(profiles)
    .set({ photos, avatarUrl: nextAvatar })
    .where(eq(profiles.id, profile.id));

  // Hapus file dari storage (best-effort) — tapi jangan hapus kalau URL masih
  // dipakai foto lain (tak mungkin, key unik) — aman.
  try {
    await storage.delete(removedUrl);
  } catch {
    /* ignore */
  }

  revalidatePath("/profile");
  revalidatePath("/", "layout");
  return { photos, avatarUrl: nextAvatar };
}

/**
 * Hapus avatar (kembali ke initials fallback).
 */
export async function deleteAvatar(): Promise<void> {
  const profile = await requireProfile();
  const { storage } = await import("@/lib/storage");

  const [row] = await db
    .select({ avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, profile.id));

  if (row?.avatarUrl) {
    await storage.delete(row.avatarUrl);
  }

  await db
    .update(profiles)
    .set({ avatarUrl: null })
    .where(eq(profiles.id, profile.id));

  revalidatePath("/profile");
  revalidatePath("/", "layout");
}
