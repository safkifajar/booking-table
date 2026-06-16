"use server";

/**
 * Server Actions untuk admin kelola denah (floor plan editor).
 *
 * - Area: create / update (nama, ukuran kanvas) / delete
 * - Meja: create / update (atribut + posisi) / delete (tolak kalau aktif)
 * - updateTablePositions: batch simpan posisi setelah drag-drop
 *
 * Semua di-guard requireAdmin (bar dari context admin).
 */

import { revalidatePath } from "next/cache";
import { and, eq, inArray, max } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { floorAreas, tables } from "@/lib/db/schema/venue";
import { tableSessions } from "@/lib/db/schema/sessions";
import { requireAdmin } from "@/lib/admin";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "area"
  );
}

/** Pastikan area milik bar admin (cegah cross-bar). Return barId. */
async function assertAreaInBar(areaId: string, barId: string) {
  const [a] = await db
    .select({ barId: floorAreas.barId })
    .from(floorAreas)
    .where(eq(floorAreas.id, areaId));
  if (!a || a.barId !== barId) throw new Error("Area tidak ditemukan");
}

// ============================================================
// AREA
// ============================================================

const areaSchema = z.object({
  name: z.string().min(1, "Nama area wajib").max(60),
  canvasWidth: z.number().int().min(200).max(3000),
  canvasHeight: z.number().int().min(200).max(3000),
});

export async function createArea(input: z.infer<typeof areaSchema>) {
  const bar = await requireAdmin();
  const data = areaSchema.parse(input);

  // Slug unik per bar.
  const base = slugify(data.name);
  let slug = base;
  let n = 1;
  while (
    (
      await db
        .select({ id: floorAreas.id })
        .from(floorAreas)
        .where(and(eq(floorAreas.barId, bar.id), eq(floorAreas.slug, slug)))
    ).length > 0
  ) {
    slug = `${base}-${++n}`;
  }

  const [sortRow] = await db
    .select({ m: max(floorAreas.sortOrder) })
    .from(floorAreas)
    .where(eq(floorAreas.barId, bar.id));

  await db.insert(floorAreas).values({
    barId: bar.id,
    name: data.name,
    slug,
    canvasWidth: data.canvasWidth,
    canvasHeight: data.canvasHeight,
    sortOrder: (sortRow?.m ?? 0) + 1,
  });

  revalidatePath("/admin/floor");
}

const updateAreaSchema = areaSchema.extend({ id: z.string().uuid() });

export async function updateArea(input: z.infer<typeof updateAreaSchema>) {
  const bar = await requireAdmin();
  const data = updateAreaSchema.parse(input);
  await assertAreaInBar(data.id, bar.id);

  await db
    .update(floorAreas)
    .set({
      name: data.name,
      canvasWidth: data.canvasWidth,
      canvasHeight: data.canvasHeight,
    })
    .where(eq(floorAreas.id, data.id));

  revalidatePath("/admin/floor");
}

export async function deleteArea(areaId: string) {
  const bar = await requireAdmin();
  await assertAreaInBar(areaId, bar.id);

  // Tolak kalau ada meja dgn session aktif di area ini.
  const tableIds = await db
    .select({ id: tables.id })
    .from(tables)
    .where(eq(tables.areaId, areaId));
  if (tableIds.length > 0) {
    const [active] = await db
      .select({ id: tableSessions.id })
      .from(tableSessions)
      .where(
        and(
          inArray(
            tableSessions.tableId,
            tableIds.map((t) => t.id)
          ),
          inArray(tableSessions.status, ["reserved", "open", "locked"])
        )
      )
      .limit(1);
    if (active) {
      throw new Error(
        "Ada meja di area ini yang sedang dipakai/dibooking — tidak bisa hapus area."
      );
    }
  }

  // Cascade: meja ikut terhapus (FK onDelete cascade).
  await db.delete(floorAreas).where(eq(floorAreas.id, areaId));
  revalidatePath("/admin/floor");
}

// ============================================================
// MEJA
// ============================================================

const tableSchema = z.object({
  areaId: z.string().uuid(),
  label: z.string().min(1, "Label wajib").max(20),
  shape: z.enum(["round", "square", "rect", "booth"]),
  capacity: z.number().int().min(1).max(50),
  posX: z.number().int().min(0).max(3000),
  posY: z.number().int().min(0).max(3000),
  width: z.number().int().min(20).max(600),
  height: z.number().int().min(20).max(600),
  rotation: z.number().int().min(0).max(359),
  minSpend: z.number().int().min(0).max(100_000_000),
});

export async function createTable(input: z.infer<typeof tableSchema>) {
  const bar = await requireAdmin();
  const data = tableSchema.parse(input);
  await assertAreaInBar(data.areaId, bar.id);

  // Label unik per area.
  const [clash] = await db
    .select({ id: tables.id })
    .from(tables)
    .where(and(eq(tables.areaId, data.areaId), eq(tables.label, data.label)));
  if (clash) throw new Error(`Label "${data.label}" sudah ada di area ini`);

  await db.insert(tables).values({
    areaId: data.areaId,
    label: data.label,
    shape: data.shape,
    capacity: data.capacity,
    posX: data.posX,
    posY: data.posY,
    width: data.width,
    height: data.height,
    rotation: data.rotation,
    minSpend: data.minSpend,
  });

  revalidatePath("/admin/floor");
}

const updateTableSchema = tableSchema
  .omit({ areaId: true })
  .extend({ id: z.string().uuid() });

export async function updateTable(input: z.infer<typeof updateTableSchema>) {
  const bar = await requireAdmin();
  const data = updateTableSchema.parse(input);

  // Verifikasi meja di area milik bar admin.
  const [row] = await db
    .select({ areaId: tables.areaId })
    .from(tables)
    .where(eq(tables.id, data.id));
  if (!row) throw new Error("Meja tidak ditemukan");
  await assertAreaInBar(row.areaId, bar.id);

  // Label unik per area (kecuali diri sendiri).
  const clashes = await db
    .select({ id: tables.id })
    .from(tables)
    .where(and(eq(tables.areaId, row.areaId), eq(tables.label, data.label)));
  if (clashes.some((c) => c.id !== data.id)) {
    throw new Error(`Label "${data.label}" sudah ada di area ini`);
  }

  await db
    .update(tables)
    .set({
      label: data.label,
      shape: data.shape,
      capacity: data.capacity,
      posX: data.posX,
      posY: data.posY,
      width: data.width,
      height: data.height,
      rotation: data.rotation,
      minSpend: data.minSpend,
    })
    .where(eq(tables.id, data.id));

  revalidatePath("/admin/floor");
}

export async function deleteTable(tableId: string) {
  const bar = await requireAdmin();
  const [row] = await db
    .select({ areaId: tables.areaId })
    .from(tables)
    .where(eq(tables.id, tableId));
  if (!row) throw new Error("Meja tidak ditemukan");
  await assertAreaInBar(row.areaId, bar.id);

  // Tolak kalau ada session aktif.
  const [active] = await db
    .select({ id: tableSessions.id })
    .from(tableSessions)
    .where(
      and(
        eq(tableSessions.tableId, tableId),
        inArray(tableSessions.status, ["reserved", "open", "locked"])
      )
    )
    .limit(1);
  if (active) {
    throw new Error(
      "Meja sedang dipakai/dibooking — tidak bisa dihapus. Tunggu sampai selesai."
    );
  }

  await db.delete(tables).where(eq(tables.id, tableId));
  revalidatePath("/admin/floor");
}

// ============================================================
// BATCH POSISI (setelah drag-drop)
// ============================================================

const positionsSchema = z.object({
  areaId: z.string().uuid(),
  positions: z
    .array(
      z.object({
        id: z.string().uuid(),
        posX: z.number().int().min(0).max(3000),
        posY: z.number().int().min(0).max(3000),
      })
    )
    .max(200),
});

export async function updateTablePositions(
  input: z.infer<typeof positionsSchema>
) {
  const bar = await requireAdmin();
  const data = positionsSchema.parse(input);
  await assertAreaInBar(data.areaId, bar.id);

  // Update tiap posisi (hanya meja di area ini).
  await db.transaction(async (tx) => {
    for (const p of data.positions) {
      await tx
        .update(tables)
        .set({ posX: p.posX, posY: p.posY })
        .where(and(eq(tables.id, p.id), eq(tables.areaId, data.areaId)));
    }
  });

  revalidatePath("/admin/floor");
}
