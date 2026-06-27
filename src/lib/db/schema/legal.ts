import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { bars } from "./venue";

/**
 * Dokumen legal per bar (Privacy Policy, Terms & Conditions, dll).
 * key membedakan jenis dokumen; unik per (bar, key).
 * content = Markdown (di-render jadi HTML di halaman publik).
 */
export const legalDocuments = pgTable(
  "legal_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barId: uuid("bar_id")
      .notNull()
      .references(() => bars.id, { onDelete: "cascade" }),
    /** 'privacy' | 'terms' (bisa nambah jenis lain nanti). */
    key: text("key").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("uq_legal_bar_key").on(t.barId, t.key)]
);
