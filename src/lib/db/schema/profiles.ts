import {
  pgTable,
  uuid,
  text,
  date,
  boolean,
  timestamp,
  jsonb,
  integer,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./auth";
import { membershipLevels } from "./membership";

/**
 * Profile = extra data per user (display name, avatar, hobbies, dll).
 * One-to-one dengan users.
 *
 * id = same as users.id (FK + PK)
 *
 * Guest profile: profile placeholder untuk walk-in customer (waiter buka meja
 * atas nama tamu). is_guest=true. users row tetap ada (fake email), tapi
 * tidak bisa login (passwordHash NULL).
 */
export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    /**
     * Username unik (handle). Format app-level: ^[a-z0-9_]{3,20}$, lowercase.
     * Nullable: user lama & guest walk-in tak punya (NULL). Registrasi baru wajib.
     */
    username: text("username"),
    avatarUrl: text("avatar_url"),
    /** Galeri foto profil (URL storage). Maks 3; foto[0] = avatar utama. */
    photos: text("photos").array().notNull().default([]),
    phone: text("phone"),
    birthDate: date("birth_date"),
    bio: text("bio"),
    /** Jenis kelamin: 'male' | 'female' | null (opsional). */
    gender: text("gender"),
    /** Tertarik pada: 'male' | 'female' | 'both' | null (opsional). */
    interestedIn: text("interested_in"),
    /** Link media sosial bebas (IG/TikTok/linktree dll). Opsional. */
    socialLink: text("social_link"),
    /** Alamat: kode kecamatan (mis. 'pwt_utara'). Opsional. */
    area: text("area"),
    /** Tujuan/mencari: 'relationship' | 'casual' | 'friendship' | null. */
    lookingFor: text("looking_for"),
    /** Pendidikan terakhir (mis. 'bachelor'). Opsional. */
    education: text("education"),
    /** Tinggi badan dalam cm (mis. 170). Opsional. */
    heightCm: integer("height_cm"),
    /** Agama (mis. 'islam'). Opsional. */
    religion: text("religion"),
    /** Preferensi musik (teks bebas). */
    musicPref: text("music_pref"),
    /** Makanan favorit (teks bebas). */
    favFood: text("fav_food"),
    /** Minuman favorit (teks bebas). */
    favDrink: text("fav_drink"),
    /** Privacy granular (LEGACY — tidak lagi dipakai UI, digantikan isPrivate). */
    hideHistory: boolean("hide_history").notNull().default(false),
    hideLocation: boolean("hide_location").notNull().default(false),
    hideAge: boolean("hide_age").notNull().default(false),
    hideSocial: boolean("hide_social").notNull().default(false),
    /**
     * Akun privat (ala Instagram). True = user lain HANYA lihat data yg tampil
     * di list network (foto, nama, umur, area, education, rating, hobbies dasar,
     * badge At SOHO). Sisanya (bio, social, prompts, dll) diblur+kunci di detail,
     * dan hangout history disembunyikan total.
     */
    isPrivate: boolean("is_private").notNull().default(false),
    hobbies: text("hobbies").array().notNull().default([]),
    /** Prompt profil (ice-breaker): [{ prompt, answer }]. Maks 5. */
    prompts: jsonb("prompts")
      .$type<{ prompt: string; answer: string }[]>()
      .notNull()
      .default([]),
    isGuest: boolean("is_guest").notNull().default(false),
    /** Akun aktif. False = di-nonaktifkan admin → tidak bisa login. */
    isActive: boolean("is_active").notNull().default(true),
    /** Onboarding (step 2-3 saat daftar) selesai. False = paksa ke /onboarding. */
    onboarded: boolean("onboarded").notNull().default(false),

    // --- Membership (PRD Membership 4.2) ---
    // Level TERSIMPAN — level EFEKTIF dihitung lazy oleh
    // src/lib/membership.ts: expires_at < now → efektif 'basic' (tanpa cron).
    // Baris 'basic' dijamin ada oleh seed pre-migrate 0059 SEBELUM kolom ini
    // dibuat (default-nya menunjuk ke sana).
    membershipLevel: text("membership_level")
      .notNull()
      .default("basic")
      .references(() => membershipLevels.key, { onDelete: "restrict" }),
    /** NULL = tanpa batas (basic / lifetime). */
    membershipExpiresAt: timestamp("membership_expires_at", {
      withTimezone: true,
      mode: "date",
    }),

    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_profiles_hobbies").using("gin", t.hobbies),
    // Username unik (NULL diperbolehkan banyak — Postgres unique mengabaikan NULL).
    unique("uq_profiles_username").on(t.username),
  ]
);

export const profilesRelations = relations(profiles, ({ one }) => ({
  user: one(users, { fields: [profiles.id], references: [users.id] }),
}));

