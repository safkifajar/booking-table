import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  unique,
  check,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { bars } from "./venue";

export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barId: uuid("bar_id")
      .notNull()
      .references(() => bars.id, { onDelete: "cascade" }),
    /**
     * Kategori bertingkat (adjacency list):
     * - NULL  = kategori UTAMA (mis. "Main Course")
     * - terisi = SUB-KATEGORI, menunjuk id kategori utama (mis. "Rice" → Main Course)
     * Item (menu_items.category_id) SELALU menunjuk ke sub-kategori (leaf).
     */
    parentId: uuid("parent_id").references((): AnyPgColumn => menuCategories.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("uq_menu_categories_bar_slug").on(t.barId, t.slug),
    index("idx_menu_categories_parent").on(t.parentId),
  ]
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => menuCategories.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    price: integer("price").notNull(),
    imageUrl: text("image_url"),
    tags: text("tags").array().notNull().default([]),
    isAvailable: boolean("is_available").notNull().default(true),
    prepMinutes: integer("prep_minutes").default(5),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    check("ck_menu_items_price_non_negative", sql`${t.price} >= 0`),
    index("idx_menu_items_category").on(t.categoryId),
  ]
);

/**
 * Relations
 */
export const menuCategoriesRelations = relations(menuCategories, ({ one, many }) => ({
  bar: one(bars, { fields: [menuCategories.barId], references: [bars.id] }),
  items: many(menuItems),
  // Self-relation: sub-kategori → induk, dan induk → daftar sub-kategori.
  parent: one(menuCategories, {
    fields: [menuCategories.parentId],
    references: [menuCategories.id],
    relationName: "category_parent",
  }),
  children: many(menuCategories, { relationName: "category_parent" }),
}));

export const menuItemsRelations = relations(menuItems, ({ one }) => ({
  category: one(menuCategories, {
    fields: [menuItems.categoryId],
    references: [menuCategories.id],
  }),
}));

