import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { tableShapeEnum } from "./_enums";

/**
 * Bar = venue. Demo cuma 1 row (SOHO Social House).
 */
export const bars = pgTable("bars", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline"),
  address: text("address"),
  /**
   * Nomor WhatsApp CS — format 62... tanpa +/spasi (sesuai wa.me).
   * NULL/kosong = pakai default dari lib/contact.ts (env atau nomor bawaan).
   */
  contactWa: text("contact_wa"),
  logoUrl: text("logo_url"),
  coverUrl: text("cover_url"),
  theme: jsonb("theme").default({}).notNull(),
  openingHours: jsonb("opening_hours").default({}).notNull(),
  reservationConfig: jsonb("reservation_config").default({}).notNull(),
  /** Pajak & service charge (%) + pembulatan. Lihat ChargeConfig. */
  chargeConfig: jsonb("charge_config").default({}).notNull(),
  /**
   * Halaman link-tree publik (link.<domain>): judul, subjudul, & preferensi
   * tampil untuk 3 tautan BAWAAN (aplikasi/WA/alamat). Tautan kustom ada di
   * tabel bar_links. Lihat LinkTreeConfig.
   */
  linkTreeConfig: jsonb("link_tree_config").default({}).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
});

/**
 * Floor area = ruangan/zona dalam bar (Indoor Lounge, Rooftop, etc).
 * Setiap area punya canvas size sendiri untuk floor map.
 */
export const floorAreas = pgTable(
  "floor_areas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barId: uuid("bar_id")
      .notNull()
      .references(() => bars.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    canvasWidth: integer("canvas_width").notNull().default(800),
    canvasHeight: integer("canvas_height").notNull().default(600),
    backgroundUrl: text("background_url"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [unique("uq_floor_areas_bar_slug").on(t.barId, t.slug)]
);

/**
 * Table = meja fisik. Posisi di floor map disimpan sebagai koordinat.
 */
export const tables = pgTable(
  "tables",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    areaId: uuid("area_id")
      .notNull()
      .references(() => floorAreas.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    shape: tableShapeEnum("shape").notNull().default("round"),
    capacity: integer("capacity").notNull().default(4),
    posX: integer("pos_x").notNull().default(0),
    posY: integer("pos_y").notNull().default(0),
    /** Draft posisi dari floor editor (belum publish). NULL = tak ada draft. */
    draftPosX: integer("draft_pos_x"),
    draftPosY: integer("draft_pos_y"),
    width: integer("width").notNull().default(80),
    height: integer("height").notNull().default(80),
    rotation: integer("rotation").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    /** Meja baru dari floor editor yg belum publish (tak tampil ke customer). */
    isDraft: boolean("is_draft").notNull().default(false),
    minSpend: integer("min_spend").default(0),
    /** Kalau true, host boleh menambah orang MELEBIHI kapasitas meja. Diatur
     *  admin di floor editor. Default false (dibatasi kapasitas). */
    allowOverCapacity: boolean("allow_over_capacity").notNull().default(false),
    createdAt: timestamp("created_at", { mode: "date" }).notNull().defaultNow(),
  },
  (t) => [unique("uq_tables_area_label").on(t.areaId, t.label)]
);

/**
 * Relations
 */
export const barsRelations = relations(bars, ({ many }) => ({
  areas: many(floorAreas),
}));

export const floorAreasRelations = relations(floorAreas, ({ one, many }) => ({
  bar: one(bars, { fields: [floorAreas.barId], references: [bars.id] }),
  tables: many(tables),
}));

export const tablesRelations = relations(tables, ({ one }) => ({
  area: one(floorAreas, { fields: [tables.areaId], references: [floorAreas.id] }),
}));

