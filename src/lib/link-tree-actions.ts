"use server";

/**
 * Kelola halaman link-tree publik (link.<domain>) dari admin.
 *
 * Halaman publiknya tak butuh login — tautannya dipasang di bio Instagram,
 * harus bisa dibuka siapa pun. Karena itu fungsi BACA publik (getLinkTree)
 * sengaja tanpa guard; yang TULIS wajib admin/manager.
 */

import { revalidatePath } from "next/cache";
import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { bars } from "@/lib/db/schema/venue";
import { barLinks } from "@/lib/db/schema/link-tree";
import { staffRoles } from "@/lib/db/schema/extras";
import { requireProfile } from "@/lib/auth-v2/current";
import { isLinkIcon } from "@/lib/link-icons";
import {
  DEFAULT_LINK_TREE_CONFIG,
  type LinkTreeConfig,
} from "@/lib/settings-constants";
import { CONTACT_WA } from "@/lib/contact";
import { logActivity } from "@/lib/activity-log";

// ============================================================
// GUARD
// ============================================================

async function requireAdminForBar(barId: string) {
  const profile = await requireProfile();
  const [staff] = await db
    .select({ role: staffRoles.role })
    .from(staffRoles)
    .where(
      and(
        eq(staffRoles.profileId, profile.id),
        eq(staffRoles.barId, barId),
        eq(staffRoles.isActive, true)
      )
    );
  if (!staff) throw new Error("Admin access required");
  if (staff.role !== "admin" && staff.role !== "manager") {
    throw new Error("Only admin/manager can manage links");
  }
  return { profile, role: staff.role };
}

// ============================================================
// TYPES
// ============================================================

export interface LinkTreeItem {
  id: string;
  label: string;
  url: string;
  icon: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  /** true = tautan BAWAAN (dirakit sistem), tak bisa dihapus/diedit. */
  isBuiltIn?: boolean;
}

export interface LinkTreeData {
  barName: string;
  logoUrl: string | null;
  config: LinkTreeConfig;
  /** Tautan siap tampil: bawaan (yang dinyalakan) + kustom, terurut. */
  links: LinkTreeItem[];
}

// ============================================================
// READ — PUBLIK (tanpa login)
// ============================================================

/**
 * Data halaman link-tree. TANPA guard: halaman ini publik.
 *
 * Tiga tautan bawaan dirakit dari data yang sudah ada — bukan disimpan
 * sebagai baris — supaya ikut berubah kalau alamat/nomor WA berubah dan
 * admin tak perlu mengetik ulang.
 */
export async function getLinkTree(slug?: string): Promise<LinkTreeData | null> {
  const [bar] = slug
    ? await db
        .select({
          id: bars.id,
          name: bars.name,
          address: bars.address,
          logoUrl: bars.logoUrl,
          linkTreeConfig: bars.linkTreeConfig,
        })
        .from(bars)
        .where(eq(bars.slug, slug))
        .limit(1)
    : // Tanpa slug → bar pertama. Sistem ini satu-bar; kalau nanti multi-bar,
      // subdomain per bar bisa memakai parameter slug.
      await db
        .select({
          id: bars.id,
          name: bars.name,
          address: bars.address,
          logoUrl: bars.logoUrl,
          linkTreeConfig: bars.linkTreeConfig,
        })
        .from(bars)
        .orderBy(asc(bars.createdAt))
        .limit(1);

  if (!bar) return null;

  const config: LinkTreeConfig = {
    ...DEFAULT_LINK_TREE_CONFIG,
    ...((bar.linkTreeConfig as Partial<LinkTreeConfig>) ?? {}),
  };

  const custom = await db
    .select({
      id: barLinks.id,
      label: barLinks.label,
      url: barLinks.url,
      icon: barLinks.icon,
      description: barLinks.description,
      isActive: barLinks.isActive,
      sortOrder: barLinks.sortOrder,
    })
    .from(barLinks)
    .where(and(eq(barLinks.barId, bar.id), eq(barLinks.isActive, true)))
    .orderBy(asc(barLinks.sortOrder), asc(barLinks.createdAt));

  // Tiap tautan bawaan: pakai URL/label KUSTOM kalau admin mengisinya,
  // kalau kosong jatuh balik ke nilai otomatis dari data yang ada.
  const builtIn: LinkTreeItem[] = [];
  if (config.showApp) {
    builtIn.push({
      id: "builtin-app",
      label: config.appLabel?.trim() || "Open the app",
      url: config.appUrl?.trim() || appUrl(),
      icon: "smartphone",
      description: "Book a table, order, and join the night",
      isActive: true,
      sortOrder: -3,
      isBuiltIn: true,
    });
  }
  if (config.showWhatsapp) {
    builtIn.push({
      id: "builtin-wa",
      label: config.whatsappLabel?.trim() || "Chat on WhatsApp",
      url: config.whatsappUrl?.trim() || `https://wa.me/${CONTACT_WA}`,
      icon: "whatsapp",
      description: "Questions, bookings, or anything else",
      isActive: true,
      sortOrder: -2,
      isBuiltIn: true,
    });
  }
  // Alamat: tampil kalau ada URL kustom ATAU alamat bar terisi — tanpa
  // keduanya tak ada yang bisa dituju.
  const addressUrl =
    config.addressUrl?.trim() ||
    (bar.address
      ? // Google Maps pencarian teks — tak perlu koordinat.
        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bar.address)}`
      : "");
  if (config.showAddress && addressUrl) {
    builtIn.push({
      id: "builtin-address",
      label: config.addressLabel?.trim() || "Find us",
      url: addressUrl,
      icon: "map-pin",
      description: bar.address ?? null,
      isActive: true,
      sortOrder: -1,
      isBuiltIn: true,
    });
  }

  return {
    barName: bar.name,
    logoUrl: bar.logoUrl,
    config,
    links: [...builtIn, ...custom],
  };
}

/** URL aplikasi customer — dibangun dari AUTH_URL (buang subdomain admin). */
function appUrl(): string {
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  try {
    const url = new URL(base);
    url.hostname = url.hostname.replace(/^(admin|link)\./, "");
    url.pathname = "/";
    url.search = "";
    return url.toString();
  } catch {
    return "/";
  }
}

// ============================================================
// READ — ADMIN (semua tautan, termasuk yang nonaktif)
// ============================================================

export async function getLinksForAdmin(barId: string): Promise<LinkTreeItem[]> {
  await requireAdminForBar(barId);
  const rows = await db
    .select({
      id: barLinks.id,
      label: barLinks.label,
      url: barLinks.url,
      icon: barLinks.icon,
      description: barLinks.description,
      isActive: barLinks.isActive,
      sortOrder: barLinks.sortOrder,
    })
    .from(barLinks)
    .where(eq(barLinks.barId, barId))
    .orderBy(asc(barLinks.sortOrder), asc(barLinks.createdAt));
  return rows;
}

export async function getLinkTreeConfig(
  barId: string
): Promise<LinkTreeConfig> {
  await requireAdminForBar(barId);
  const [row] = await db
    .select({ cfg: bars.linkTreeConfig })
    .from(bars)
    .where(eq(bars.id, barId));
  return {
    ...DEFAULT_LINK_TREE_CONFIG,
    ...((row?.cfg as Partial<LinkTreeConfig>) ?? {}),
  };
}

// ============================================================
// WRITE
// ============================================================

const linkSchema = z.object({
  label: z.string().trim().min(1, "Label is required").max(60),
  url: z.string().trim().min(1, "URL is required").max(500),
  icon: z.string().trim().min(1).max(40),
  description: z.string().trim().max(120).optional().or(z.literal("")),
  isActive: z.boolean(),
});

/**
 * Normalisasi URL: tambah https:// kalau admin cuma menulis domain.
 * Tanpa ini "instagram.com/soho" jadi tautan RELATIF & mengarah ke
 * link.<domain>/instagram.com/soho.
 */
function normalizeUrl(raw: string): string | null {
  const v = raw.trim();
  // Skema khusus yang sah untuk tombol tautan.
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v;
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return null; // skema lain → tolak
  return `https://${v}`;
}

export async function createLink(
  barId: string,
  input: z.infer<typeof linkSchema>
): Promise<{ ok: boolean; error?: string }> {
  const ctx = await requireAdminForBar(barId);
  const data = linkSchema.parse(input);

  if (!isLinkIcon(data.icon)) {
    return { ok: false, error: "Pick an icon from the list" };
  }
  const url = normalizeUrl(data.url);
  if (!url) {
    return { ok: false, error: "URL must start with http://, https://, mailto:, or tel:" };
  }

  // Taruh di paling bawah: MAX(sort_order) + 1.
  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(${barLinks.sortOrder}), 0)::int` })
    .from(barLinks)
    .where(eq(barLinks.barId, barId));

  await db.insert(barLinks).values({
    barId,
    label: data.label,
    url,
    icon: data.icon,
    description: data.description?.trim() || null,
    isActive: data.isActive,
    sortOrder: Number(maxRow?.max ?? 0) + 1,
  });

  await logActivity({
    actorId: ctx.profile.id,
    barId,
    action: "link.created",
    category: "admin",
    summary: `Added link "${data.label}" to the link page`,
    meta: { label: data.label, url },
  });

  revalidatePath("/admin/links");
  revalidatePath("/link");
  return { ok: true };
}

export async function updateLink(
  linkId: string,
  input: z.infer<typeof linkSchema>
): Promise<{ ok: boolean; error?: string }> {
  const [existing] = await db
    .select({ barId: barLinks.barId })
    .from(barLinks)
    .where(eq(barLinks.id, linkId));
  if (!existing) return { ok: false, error: "Link not found" };

  const ctx = await requireAdminForBar(existing.barId);
  const data = linkSchema.parse(input);

  if (!isLinkIcon(data.icon)) {
    return { ok: false, error: "Pick an icon from the list" };
  }
  const url = normalizeUrl(data.url);
  if (!url) {
    return { ok: false, error: "URL must start with http://, https://, mailto:, or tel:" };
  }

  await db
    .update(barLinks)
    .set({
      label: data.label,
      url,
      icon: data.icon,
      description: data.description?.trim() || null,
      isActive: data.isActive,
    })
    .where(eq(barLinks.id, linkId));

  await logActivity({
    actorId: ctx.profile.id,
    barId: existing.barId,
    action: "link.updated",
    category: "admin",
    summary: `Updated link "${data.label}"`,
    meta: { linkId, label: data.label },
  });

  revalidatePath("/admin/links");
  revalidatePath("/link");
  return { ok: true };
}

export async function deleteLink(
  linkId: string
): Promise<{ ok: boolean; error?: string }> {
  const [existing] = await db
    .select({ barId: barLinks.barId, label: barLinks.label })
    .from(barLinks)
    .where(eq(barLinks.id, linkId));
  if (!existing) return { ok: true }; // sudah tak ada — anggap selesai

  const ctx = await requireAdminForBar(existing.barId);
  await db.delete(barLinks).where(eq(barLinks.id, linkId));

  await logActivity({
    actorId: ctx.profile.id,
    barId: existing.barId,
    action: "link.deleted",
    category: "admin",
    summary: `Deleted link "${existing.label}"`,
    meta: { linkId },
  });

  revalidatePath("/admin/links");
  revalidatePath("/link");
  return { ok: true };
}

/** Simpan urutan baru (drag & drop / tombol naik-turun). */
export async function reorderLinks(
  barId: string,
  orderedIds: string[]
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminForBar(barId);
  if (orderedIds.length === 0) return { ok: true };

  // Satu transaksi: urutan tak boleh setengah tersimpan.
  await db.transaction(async (tx) => {
    for (const [i, id] of orderedIds.entries()) {
      await tx
        .update(barLinks)
        .set({ sortOrder: i + 1 })
        .where(and(eq(barLinks.id, id), eq(barLinks.barId, barId)));
    }
  });

  revalidatePath("/admin/links");
  revalidatePath("/link");
  return { ok: true };
}

const configSchema = z.object({
  headline: z.string().trim().max(60),
  tagline: z.string().trim().max(120),
  showApp: z.boolean(),
  showWhatsapp: z.boolean(),
  showAddress: z.boolean(),
  // Kosong = pakai nilai otomatis.
  appUrl: z.string().trim().max(500),
  appLabel: z.string().trim().max(60),
  whatsappUrl: z.string().trim().max(500),
  whatsappLabel: z.string().trim().max(60),
  addressUrl: z.string().trim().max(500),
  addressLabel: z.string().trim().max(60),
});

export async function updateLinkTreeConfig(
  barId: string,
  input: z.infer<typeof configSchema>
): Promise<{ ok: boolean; error?: string }> {
  await requireAdminForBar(barId);
  const cfg = configSchema.parse(input);

  // URL kustom dinormalisasi & divalidasi SAMA seperti tautan biasa —
  // tanpa ini "wa.me/628..." jadi tautan relatif ke link.<domain>, dan
  // skema berbahaya (javascript:) bisa lolos ke halaman publik.
  const urlFields = ["appUrl", "whatsappUrl", "addressUrl"] as const;
  for (const f of urlFields) {
    const raw = cfg[f];
    if (!raw) continue; // kosong = pakai otomatis
    const norm = normalizeUrl(raw);
    if (!norm) {
      return {
        ok: false,
        error: "URL must start with http://, https://, mailto:, or tel:",
      };
    }
    cfg[f] = norm;
  }

  await db.update(bars).set({ linkTreeConfig: cfg }).where(eq(bars.id, barId));

  revalidatePath("/admin/links");
  revalidatePath("/link");
  return { ok: true };
}
