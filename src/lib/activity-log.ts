import "server-only";
import { and, count, desc, eq, gte, lt, ilike, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { activityLogs } from "@/lib/db/schema/activity-logs";
import { profiles } from "@/lib/db/schema/profiles";
import { staffRoles } from "@/lib/db/schema/extras";

/**
 * Pencatatan aktivitas STAFF ("siapa melakukan apa").
 *
 * Dipanggil dari server action SETELAH aksinya berhasil. Best-effort:
 * kegagalan menulis log TIDAK boleh menggagalkan aksi aslinya — pembayaran
 * yang sudah lunas tak boleh batal cuma karena log gagal ditulis.
 */

export type ActivityCategory =
  | "payment"
  | "order"
  | "session"
  | "move"
  | "customer"
  | "admin";

export interface LogActivityInput {
  actorId: string;
  barId: string;
  /** Kode aksi, mis. 'payment.received'. */
  action: string;
  category: ActivityCategory;
  /** Kalimat siap tampil di UI admin. */
  summary: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Catat satu aktivitas staff. Nama & role di-snapshot dari DB saat ini supaya
 * riwayat tetap terbaca walau nanti staff-nya berubah/dihapus.
 *
 * TIDAK pernah melempar error — sengaja, supaya aman dipanggil di jalur kritis.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  try {
    const [actor] = await db
      .select({
        name: profiles.displayName,
        role: staffRoles.role,
      })
      .from(profiles)
      .leftJoin(staffRoles, eq(staffRoles.profileId, profiles.id))
      .where(eq(profiles.id, input.actorId));

    await db.insert(activityLogs).values({
      actorId: input.actorId,
      actorName: actor?.name ?? "Unknown",
      actorRole: actor?.role ?? "unknown",
      barId: input.barId,
      action: input.action,
      category: input.category,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      summary: input.summary,
      meta: input.meta ?? {},
    });
  } catch (err) {
    // Sengaja ditelan: log gagal ≠ aksi gagal.
    console.error("[activity-log] gagal mencatat:", input.action, err);
  }
}

/**
 * Catat aktivitas HANYA kalau pelakunya staff aktif — untuk action yang dipakai
 * bersama customer & staff (mis. ubah profil / ganti password di /profile).
 * Customer yang melakukannya bukan aktivitas staff, jadi diabaikan diam-diam.
 *
 * barId diambil dari penugasan staff-nya, jadi pemanggil tak perlu tahu bar.
 * Sama seperti logActivity: tak pernah melempar error.
 */
export async function logIfStaff(
  input: Omit<LogActivityInput, "barId">
): Promise<void> {
  try {
    const [staff] = await db
      .select({ barId: staffRoles.barId })
      .from(staffRoles)
      .where(
        and(
          eq(staffRoles.profileId, input.actorId),
          eq(staffRoles.isActive, true)
        )
      );
    if (!staff) return; // customer biasa → bukan aktivitas staff
    await logActivity({ ...input, barId: staff.barId });
  } catch (err) {
    console.error("[activity-log] gagal cek staff:", input.action, err);
  }
}

// ============================================================
// READ (halaman admin)
// ============================================================

export interface ActivityLogRow {
  id: string;
  actor_id: string | null;
  actor_name: string;
  actor_role: string;
  action: string;
  category: string;
  entity_type: string | null;
  entity_id: string | null;
  summary: string;
  created_at: string;
}

export interface ListActivityResult {
  rows: ActivityLogRow[];
  total: number;
}

/**
 * List aktivitas untuk halaman admin. Filter: pencarian teks, kategori,
 * staff tertentu, dan rentang tanggal. Terbaru dulu.
 */
export async function listActivityLogs(opts: {
  barId: string;
  search?: string;
  category?: string;
  actorId?: string;
  /** ISO. from inklusif, to EKSKLUSIF (sesuai resolveDateRange). */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListActivityResult> {
  const size = [20, 50, 100].includes(opts.pageSize ?? 0)
    ? (opts.pageSize as number)
    : 20;
  const page = Math.max(1, opts.page ?? 1);
  const search = (opts.search ?? "").trim();

  const whereClause = and(
    eq(activityLogs.barId, opts.barId),
    opts.category && opts.category !== "all"
      ? eq(activityLogs.category, opts.category)
      : undefined,
    opts.actorId ? eq(activityLogs.actorId, opts.actorId) : undefined,
    opts.from ? gte(activityLogs.createdAt, new Date(opts.from)) : undefined,
    opts.to ? lt(activityLogs.createdAt, new Date(opts.to)) : undefined,
    search
      ? or(
          ilike(activityLogs.summary, `%${search}%`),
          ilike(activityLogs.actorName, `%${search}%`),
          ilike(activityLogs.action, `%${search}%`)
        )
      : undefined
  );

  const [rows, totalRow] = await Promise.all([
    db
      .select({
        id: activityLogs.id,
        actor_id: activityLogs.actorId,
        actor_name: activityLogs.actorName,
        actor_role: activityLogs.actorRole,
        action: activityLogs.action,
        category: activityLogs.category,
        entity_type: activityLogs.entityType,
        entity_id: activityLogs.entityId,
        summary: activityLogs.summary,
        created_at: activityLogs.createdAt,
      })
      .from(activityLogs)
      .where(whereClause)
      .orderBy(desc(activityLogs.createdAt))
      .limit(size)
      .offset((page - 1) * size),
    db.select({ total: count() }).from(activityLogs).where(whereClause),
  ]);

  return {
    rows: rows.map((r) => ({ ...r, created_at: r.created_at.toISOString() })),
    total: Number(totalRow[0]?.total ?? 0),
  };
}

/** Daftar staff yang punya aktivitas (untuk dropdown filter). */
export async function listActivityActors(
  barId: string
): Promise<{ id: string; name: string; role: string }[]> {
  const rows = await db
    .selectDistinctOn([activityLogs.actorId], {
      id: activityLogs.actorId,
      name: activityLogs.actorName,
      role: activityLogs.actorRole,
    })
    .from(activityLogs)
    .where(and(eq(activityLogs.barId, barId), sql`${activityLogs.actorId} IS NOT NULL`))
    .orderBy(activityLogs.actorId, desc(activityLogs.createdAt));

  return rows
    .filter((r): r is { id: string; name: string; role: string } => !!r.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}
