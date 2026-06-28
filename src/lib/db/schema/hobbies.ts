import { pgTable, uuid, text, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Master list hobi & minat — dikelola admin. Customer hanya memilih dari sini
 * (tak boleh nambah custom). Dikelompokkan per kategori untuk tampilan.
 */
export const hobbies = pgTable(
  "hobbies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nama hobi (lowercase, dipakai sbg value di profiles.hobbies[]). */
    name: text("name").notNull(),
    /** Kategori tampilan (mis. "Musik & Hiburan"). */
    category: text("category").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_hobby_name").on(t.name)]
);
