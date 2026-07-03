import { pgTable, uuid, text, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Master pertanyaan prompt (ice-breaker) — dikelola admin. Customer memilih
 * dari sini saat onboarding/edit profil lalu mengisi jawaban (disimpan di
 * profiles.prompts). Ini cuma DAFTAR pertanyaan, bukan jawaban.
 */
export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Teks pertanyaan (mis. "Tonight I'm in the mood for…"). */
    text: text("text").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_prompt_text").on(t.text)]
);
