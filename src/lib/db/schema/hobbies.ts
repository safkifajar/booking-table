import { pgTable, uuid, text, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Kategori hobi — dikelola admin. Dipakai mengelompokkan hobi di tampilan.
 */
export const hobbyCategories = pgTable(
  "hobby_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_hobby_category_name").on(t.name)]
);

/**
 * Master list hobi & minat — dikelola admin. Customer hanya memilih dari sini
 * (tak boleh nambah custom). Dikelompokkan per kategori untuk tampilan.
 */
export const hobbies = pgTable(
  "hobbies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Nama hobi (dipakai sbg value di profiles.hobbies[]). */
    name: text("name").notNull(),
    /** Kategori tampilan (mis. "Food & Drink"). */
    category: text("category").notNull(),
    /** Emoji di depan nama (mis. "🍸"). Opsional. */
    emoji: text("emoji"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_hobby_name").on(t.name)]
);
