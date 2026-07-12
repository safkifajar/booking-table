/**
 * Signup helper — create user + profile dalam 1 transaction.
 *
 * Auth.js Credentials provider TIDAK punya built-in signup
 * (intentional design — bukan job-nya).
 * Jadi kita expose function ini untuk dipanggil dari Server Action signup form.
 *
 * Flow:
 * 1. Validate input (email valid, password kuat, displayName)
 * 2. Cek email tidak duplicate
 * 3. Hash password
 * 4. Insert ke users + profiles dalam 1 transaction
 * 5. Caller (Server Action) lalu panggil signIn("credentials", ...) untuk auto-login
 *
 * Tidak handle sign-in — itu tanggung jawab caller.
 */

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema/auth";
import { profiles } from "@/lib/db/schema/profiles";
import { hashPassword } from "./password";
import { USERNAME_REGEX, isDbConstraintError } from "@/lib/utils";

const signupSchema = z.object({
  email: z.string().email("Invalid email").max(255),
  password: z.string().min(6, "Password must be at least 6 characters").max(100),
  displayName: z.string().min(2, "Name must be at least 2 characters").max(40),
  username: z
    .string()
    .transform((s) => s.trim().toLowerCase())
    .pipe(
      z
        .string()
        .regex(
          USERNAME_REGEX,
          "Username must be 3-20 chars: lowercase letters, numbers, _"
        )
    ),
  phone: z.string().max(20).optional().or(z.literal("")),
});

export type SignupInput = z.infer<typeof signupSchema>;

export class SignupError extends Error {
  constructor(
    public code: "email_taken" | "username_taken" | "validation" | "db",
    message: string
  ) {
    super(message);
    this.name = "SignupError";
  }
}

export interface SignupResult {
  userId: string;
  email: string;
}

export async function signup(input: SignupInput): Promise<SignupResult> {
  // Validate
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new SignupError("validation", first?.message ?? "Invalid input");
  }
  const data = parsed.data;
  const email = data.email.toLowerCase().trim();
  const displayName = data.displayName.trim();
  const username = data.username; // sudah lowercase + tervalidasi via schema

  // Check duplicate email
  const existing = await db.query.users.findFirst({
    where: eq(users.email, email),
  });
  if (existing) {
    throw new SignupError("email_taken", "Email already registered");
  }

  // Check duplicate username (pre-flight; constraint jadi backstop).
  const usernameTaken = await db.query.profiles.findFirst({
    where: eq(profiles.username, username),
    columns: { id: true },
  });
  if (usernameTaken) {
    throw new SignupError("username_taken", "Username already taken");
  }

  // Hash password
  const passwordHash = await hashPassword(data.password);

  // Insert dalam transaction
  try {
    const result = await db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          name: displayName,
          // emailVerified left null — user belum verify email
          // bisa di-set saat magic link / email confirmation
        })
        .returning({ id: users.id, email: users.email });

      await tx.insert(profiles).values({
        id: newUser.id,
        displayName,
        username,
        phone: data.phone?.trim() || null,
        // onboarded default false → user diarahkan ke /onboarding (step 2-3).
      });

      return newUser;
    });

    return { userId: result.id, email: result.email };
  } catch (err) {
    // Race condition: concurrent signup (constraint jadi backstop).
    if (isDbConstraintError(err, "uq_profiles_username")) {
      throw new SignupError("username_taken", "Username already taken");
    }
    if (err instanceof Error && err.message.includes("unique")) {
      throw new SignupError("email_taken", "Email already registered");
    }
    throw new SignupError("db", "Failed to create account. Please try again.");
  }
}
