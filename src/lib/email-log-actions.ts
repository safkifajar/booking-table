"use server";

/**
 * Pembacaan catatan pengiriman email untuk Admin → Email Log.
 *
 * DIBATASI ADMIN, bukan manager/staf: log memuat alamat email seluruh tamu
 * (data pribadi) dan isi email reset password — yang memuat tautan masih
 * aktif selama 30 menit.
 */

import { and, count, desc, eq, ilike, lt, or, type SQL } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailLogs } from "@/lib/db/schema/email-logs";
import { requireAdmin } from "@/lib/admin";

/** Berapa lama catatan disimpan sebelum dibuang otomatis. */
const RETENTION_DAYS = 90;

async function requireAdminRole() {
  const bar = await requireAdmin();
  if (bar.role !== "admin") {
    throw new Error("Only admin can view email logs");
  }
  return bar;
}

export interface EmailLogRow {
  id: string;
  recipient: string;
  subject: string;
  kind: string;
  status: string;
  provider: string;
  providerMessageId: string | null;
  error: string | null;
  createdAt: Date;
}

export interface EmailLogPage {
  rows: EmailLogRow[];
  total: number;
  /** Jumlah per status, untuk ringkasan di atas tabel. */
  counts: { success: number; failed: number; dryRun: number };
}

/**
 * Daftar catatan email, terbaru dulu.
 *
 * `search` mencocokkan penerima ATAU subjek — saat menelusuri keluhan, admin
 * biasanya cuma ingat salah satunya.
 */
export async function getEmailLogs(params: {
  page?: number;
  perPage?: number;
  search?: string;
  status?: string;
}): Promise<EmailLogPage> {
  await requireAdminRole();

  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(100, Math.max(10, params.perPage ?? 10));
  const search = params.search?.trim();
  const status = params.status?.trim();

  const filters: SQL[] = [];
  if (search) {
    const like = `%${search}%`;
    const match = or(
      ilike(emailLogs.recipient, like),
      ilike(emailLogs.subject, like)
    );
    if (match) filters.push(match);
  }
  if (status && status !== "all") {
    filters.push(eq(emailLogs.status, status));
  }
  const where = filters.length ? and(...filters) : undefined;

  const [rows, [totalRow], statusRows] = await Promise.all([
    db
      .select({
        id: emailLogs.id,
        recipient: emailLogs.recipient,
        subject: emailLogs.subject,
        kind: emailLogs.kind,
        status: emailLogs.status,
        provider: emailLogs.provider,
        providerMessageId: emailLogs.providerMessageId,
        error: emailLogs.error,
        createdAt: emailLogs.createdAt,
      })
      .from(emailLogs)
      .where(where)
      .orderBy(desc(emailLogs.createdAt))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db.select({ n: count() }).from(emailLogs).where(where),
    // Ringkasan status sengaja TANPA filter status: angkanya harus tetap
    // utuh saat admin sedang menyaring "failed", supaya bisa dipakai
    // berpindah antar-status.
    db
      .select({ status: emailLogs.status, n: count() })
      .from(emailLogs)
      .groupBy(emailLogs.status),
  ]);

  const counts = { success: 0, failed: 0, dryRun: 0 };
  for (const r of statusRows) {
    if (r.status === "success") counts.success = r.n;
    else if (r.status === "failed") counts.failed = r.n;
    else if (r.status === "dry_run") counts.dryRun = r.n;
  }

  return { rows, total: totalRow?.n ?? 0, counts };
}

/**
 * Isi lengkap satu email.
 *
 * Dipisah dari daftar: body HTML bisa puluhan KB, tak ada gunanya ikut
 * terkirim untuk 10 baris sekaligus padahal admin cuma membuka satu.
 */
export async function getEmailLogBody(
  id: string
): Promise<{ ok: boolean; html?: string; error?: string }> {
  await requireAdminRole();
  const [row] = await db
    .select({ html: emailLogs.bodyHtml })
    .from(emailLogs)
    .where(eq(emailLogs.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "Log entry not found" };
  return { ok: true, html: row.html ?? "" };
}

/**
 * Buang catatan yang lebih tua dari masa simpan.
 *
 * Dipanggil cron. Tabel ini tumbuh seiring tiap email yang dikirim — tanpa
 * pembersihan, isinya membengkak tanpa batas.
 */
export async function purgeOldEmailLogs(): Promise<number> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(emailLogs)
    .where(lt(emailLogs.createdAt, cutoff))
    .returning({ id: emailLogs.id });
  return deleted.length;
}
