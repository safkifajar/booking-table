// Admin-side data fetching helpers
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { PaymentMethod } from "@/types/db";

export interface AdminBar {
  id: string;
  slug: string;
  name: string;
  role: "admin" | "manager" | "waiter";
}

/**
 * Server-side guard: redirect kalau bukan admin atau manager.
 * Return bar context + role kalau valid.
 */
export async function requireAdmin(): Promise<AdminBar> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth?next=/admin");

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("staff_roles")
    .select("role, bar_id, bars!inner(id, slug, name)")
    .eq("profile_id", profile.id)
    .eq("is_active", true)
    .in("role", ["admin", "manager"])
    .limit(1)
    .maybeSingle();

  if (!staff) redirect("/");

  const bar = Array.isArray(staff.bars) ? staff.bars[0] : staff.bars;
  return {
    id: bar.id,
    slug: bar.slug,
    name: bar.name,
    role: staff.role as "admin" | "manager",
  };
}

export interface SalesSummary {
  total_revenue: number;
  transaction_count: number;
  unique_visitors: number;
  avg_bill: number;
  total_items: number;
  avg_items_per_transaction: number;
}

export interface SummaryWithDelta extends SalesSummary {
  prev: SalesSummary;
  delta_revenue_pct: number | null;
  delta_transaction_pct: number | null;
  delta_visitors_pct: number | null;
}

/**
 * Hitung period sebelumnya dengan durasi sama.
 * Range "Bulan ini" → prev = "Bulan lalu" (durasi sama dari from).
 */
export function getPreviousRange(from: string, to: string): { from: string; to: string } {
  const fromMs = new Date(from).getTime();
  const toMs = new Date(to).getTime();
  const duration = toMs - fromMs;
  return {
    from: new Date(fromMs - duration).toISOString(),
    to: from,
  };
}

function pctDelta(curr: number, prev: number): number | null {
  if (prev === 0) {
    if (curr === 0) return 0;
    return null; // ∞ — tampilkan "Baru"
  }
  return Math.round(((curr - prev) / prev) * 100);
}

export interface TopItem {
  menu_item_id: string;
  name: string;
  category_name: string;
  total_qty: number;
  total_revenue: number;
  transaction_count: number;
}

export interface SalesByHour {
  hour_of_day: number;
  total_revenue: number;
  transaction_count: number;
}

export interface SalesByDay {
  sale_date: string;
  total_revenue: number;
  transaction_count: number;
}

export interface PaymentMethodSummary {
  method: PaymentMethod;
  total_amount: number;
  payment_count: number;
  pct_share: number;
}

export interface AdminTransaction {
  session_id: string;
  closed_at: string;
  started_at: string;
  duration_minutes: number;
  table_label: string;
  area_name: string;
  host_name: string;
  member_count: number;
  item_count: number;
  subtotal: number;
  paid_total: number;
  session_title: string | null;
}

export async function getSalesSummary(
  barId: string,
  from: string,
  to: string
): Promise<SalesSummary> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_sales_summary", {
    p_bar_id: barId,
    p_from: from,
    p_to: to,
  });
  const row = Array.isArray(data) ? data[0] : data;
  return {
    total_revenue: Number(row?.total_revenue ?? 0),
    transaction_count: Number(row?.transaction_count ?? 0),
    unique_visitors: Number(row?.unique_visitors ?? 0),
    avg_bill: Number(row?.avg_bill ?? 0),
    total_items: Number(row?.total_items ?? 0),
    avg_items_per_transaction: Number(row?.avg_items_per_transaction ?? 0),
  };
}

export async function getSummaryWithDelta(
  barId: string,
  from: string,
  to: string
): Promise<SummaryWithDelta> {
  const prev = getPreviousRange(from, to);
  const [curr, prevSummary] = await Promise.all([
    getSalesSummary(barId, from, to),
    getSalesSummary(barId, prev.from, prev.to),
  ]);
  return {
    ...curr,
    prev: prevSummary,
    delta_revenue_pct: pctDelta(curr.total_revenue, prevSummary.total_revenue),
    delta_transaction_pct: pctDelta(
      curr.transaction_count,
      prevSummary.transaction_count
    ),
    delta_visitors_pct: pctDelta(curr.unique_visitors, prevSummary.unique_visitors),
  };
}

export async function getTopItems(
  barId: string,
  from: string,
  to: string,
  limit = 20
): Promise<TopItem[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_top_items", {
    p_bar_id: barId,
    p_from: from,
    p_to: to,
    p_limit: limit,
  });
  return (data ?? []) as TopItem[];
}

/**
 * Semua menu item di bar (termasuk yang belum laku di periode ini).
 * Sort by revenue desc — yang paling laris di atas, yang belum terjual di bawah.
 */
export async function getAllItemsPerformance(
  barId: string,
  from: string,
  to: string
): Promise<TopItem[]> {
  const supabase = await createClient();

  // Get all menu items in bar
  const { data: allItems } = await supabase
    .from("menu_items")
    .select(
      `id, name,
       category:menu_categories!inner(name, bar_id)`
    )
    .eq("category.bar_id", barId);

  // Get stats untuk periode
  const stats = await getTopItems(barId, from, to, 10000);
  const statsMap = new Map(stats.map((s) => [s.menu_item_id, s]));

  // Merge: kalau ada di stats pakai stats, kalau tidak buat dengan 0
  const merged: TopItem[] = (allItems ?? []).map((it) => {
    const cat = Array.isArray(it.category) ? it.category[0] : it.category;
    const s = statsMap.get(it.id);
    if (s) return s;
    return {
      menu_item_id: it.id,
      name: it.name,
      category_name: cat.name,
      total_qty: 0,
      total_revenue: 0,
      transaction_count: 0,
    };
  });

  // Sort by revenue desc, lalu qty desc, lalu nama
  merged.sort((a, b) => {
    if (b.total_revenue !== a.total_revenue)
      return b.total_revenue - a.total_revenue;
    if (b.total_qty !== a.total_qty) return b.total_qty - a.total_qty;
    return a.name.localeCompare(b.name);
  });

  return merged;
}

export async function getSalesByHour(
  barId: string,
  from: string,
  to: string
): Promise<SalesByHour[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_sales_by_hour", {
    p_bar_id: barId,
    p_from: from,
    p_to: to,
  });
  return (data ?? []) as SalesByHour[];
}

export async function getSalesByDay(
  barId: string,
  from: string,
  to: string
): Promise<SalesByDay[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_sales_by_day", {
    p_bar_id: barId,
    p_from: from,
    p_to: to,
  });
  return (data ?? []) as SalesByDay[];
}

export async function getPaymentMethods(
  barId: string,
  from: string,
  to: string
): Promise<PaymentMethodSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_payment_methods", {
    p_bar_id: barId,
    p_from: from,
    p_to: to,
  });
  return (data ?? []) as PaymentMethodSummary[];
}

export async function getTransactions(
  barId: string,
  from: string,
  to: string,
  limit = 100,
  offset = 0
): Promise<AdminTransaction[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_transactions", {
    p_bar_id: barId,
    p_from: from,
    p_to: to,
    p_limit: limit,
    p_offset: offset,
  });
  return (data ?? []) as AdminTransaction[];
}

// ============================================================
// TRANSACTION DETAIL — untuk drawer
// ============================================================

export interface TransactionDetailItem {
  id: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  status: string;
  queue_number: number | null;
  menu_item_name: string;
  added_by_name: string;
}

export interface TransactionDetailPayment {
  id: string;
  amount: number;
  method: string;
  status: string;
  split_mode: string;
  paid_at: string | null;
  paid_by_name: string;
}

export interface TransactionDetail {
  session_id: string;
  status: string;
  title: string | null;
  visibility: string;
  vibe_tags: string[];
  started_at: string;
  closed_at: string | null;
  table_label: string;
  table_shape: string;
  table_capacity: number;
  area_name: string;
  host_name: string;
  host_avatar: string | null;
  member_count: number;
  items: TransactionDetailItem[];
  payments: TransactionDetailPayment[];
  subtotal: number;
  total_paid: number;
}

export async function getTransactionDetail(
  barId: string,
  sessionId: string
): Promise<TransactionDetail | null> {
  const supabase = await createClient();

  const { data: session } = await supabase
    .from("table_sessions")
    .select(
      `id, status, title, visibility, vibe_tags, started_at, closed_at,
       tables!inner(label, capacity, shape, area_id,
         floor_areas!inner(name, bar_id)
       ),
       host:profiles!table_sessions_host_id_fkey(display_name, avatar_url)`
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (!session) return null;
  const table = Array.isArray(session.tables) ? session.tables[0] : session.tables;
  const area = Array.isArray(table.floor_areas) ? table.floor_areas[0] : table.floor_areas;
  if (area.bar_id !== barId) return null;

  const host = Array.isArray(session.host) ? session.host[0] : session.host;

  const { data: order } = await supabase
    .from("orders")
    .select("id")
    .eq("session_id", sessionId)
    .order("created_at")
    .limit(1)
    .maybeSingle();

  let items: TransactionDetailItem[] = [];
  let payments: TransactionDetailPayment[] = [];

  if (order) {
    const { data: itemsData } = await supabase
      .from("order_items")
      .select(
        `id, quantity, unit_price, notes, status, queue_number,
         menu_item:menu_items!inner(name),
         added_by:session_members!inner(profile:profiles!inner(display_name))`
      )
      .eq("order_id", order.id)
      .neq("status", "void")
      .order("queue_number");

    items = (itemsData ?? []).map((oi) => {
      const mi = Array.isArray(oi.menu_item) ? oi.menu_item[0] : oi.menu_item;
      const ab = Array.isArray(oi.added_by) ? oi.added_by[0] : oi.added_by;
      const abp = Array.isArray(ab.profile) ? ab.profile[0] : ab.profile;
      return {
        id: oi.id,
        quantity: oi.quantity,
        unit_price: oi.unit_price,
        notes: oi.notes,
        status: oi.status,
        queue_number: oi.queue_number,
        menu_item_name: mi.name,
        added_by_name: abp.display_name,
      };
    });

    const { data: paymentsData } = await supabase
      .from("payments")
      .select(
        `id, amount, method, status, split_mode, paid_at,
         member:session_members!inner(profile:profiles!inner(display_name))`
      )
      .eq("order_id", order.id)
      .order("created_at");

    payments = (paymentsData ?? []).map((p) => {
      const m = Array.isArray(p.member) ? p.member[0] : p.member;
      const mp = Array.isArray(m.profile) ? m.profile[0] : m.profile;
      return {
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        split_mode: p.split_mode,
        paid_at: p.paid_at,
        paid_by_name: mp.display_name,
      };
    });
  }

  const { count: memberCount } = await supabase
    .from("session_members")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const totalPaid = payments
    .filter((p) => p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);

  return {
    session_id: session.id,
    status: session.status,
    title: session.title,
    visibility: session.visibility,
    vibe_tags: session.vibe_tags ?? [],
    started_at: session.started_at,
    closed_at: session.closed_at,
    table_label: table.label,
    table_shape: table.shape,
    table_capacity: table.capacity,
    area_name: area.name,
    host_name: host.display_name,
    host_avatar: host.avatar_url,
    member_count: memberCount ?? 0,
    items,
    payments,
    subtotal,
    total_paid: totalPaid,
  };
}

// ============================================================
// Date range helpers
// ============================================================

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "this_month"
  | "last_month"
  | "custom";

export interface DateRange {
  from: string; // ISO timestamp
  to: string; // ISO timestamp (exclusive)
  preset: DateRangePreset;
  label: string;
}

/**
 * Resolve preset / custom dates to actual UTC range.
 * Semua perhitungan pakai timezone Asia/Jakarta (offset +07:00).
 */
export function resolveDateRange(
  preset: DateRangePreset = "today",
  customFrom?: string,
  customTo?: string
): DateRange {
  const TZ_OFFSET_HOURS = 7;

  // "Now" di Jakarta
  const nowUtc = new Date();
  const nowJkt = new Date(nowUtc.getTime() + TZ_OFFSET_HOURS * 60 * 60 * 1000);

  // Today @ 00:00 Jakarta → konversi balik ke UTC
  const startOfTodayJkt = new Date(
    Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), nowJkt.getUTCDate())
  );
  const startOfToday = new Date(
    startOfTodayJkt.getTime() - TZ_OFFSET_HOURS * 60 * 60 * 1000
  );

  const day = 24 * 60 * 60 * 1000;

  let from: Date;
  let to: Date;
  let label: string;

  switch (preset) {
    case "today":
      from = startOfToday;
      to = new Date(startOfToday.getTime() + day);
      label = "Hari ini";
      break;
    case "yesterday":
      from = new Date(startOfToday.getTime() - day);
      to = startOfToday;
      label = "Kemarin";
      break;
    case "last7":
      from = new Date(startOfToday.getTime() - 7 * day);
      to = new Date(startOfToday.getTime() + day);
      label = "7 hari terakhir";
      break;
    case "last30":
      from = new Date(startOfToday.getTime() - 30 * day);
      to = new Date(startOfToday.getTime() + day);
      label = "30 hari terakhir";
      break;
    case "this_month": {
      const firstJkt = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), 1)
      );
      from = new Date(firstJkt.getTime() - TZ_OFFSET_HOURS * 60 * 60 * 1000);
      to = new Date(startOfToday.getTime() + day);
      label = "Bulan ini";
      break;
    }
    case "last_month": {
      const firstThisJkt = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth(), 1)
      );
      const firstLastJkt = new Date(
        Date.UTC(nowJkt.getUTCFullYear(), nowJkt.getUTCMonth() - 1, 1)
      );
      from = new Date(firstLastJkt.getTime() - TZ_OFFSET_HOURS * 60 * 60 * 1000);
      to = new Date(firstThisJkt.getTime() - TZ_OFFSET_HOURS * 60 * 60 * 1000);
      label = "Bulan lalu";
      break;
    }
    case "custom":
    default: {
      // customFrom, customTo expected as YYYY-MM-DD (jakarta date)
      const f = customFrom ? new Date(`${customFrom}T00:00:00+07:00`) : startOfToday;
      const t = customTo
        ? new Date(`${customTo}T00:00:00+07:00`)
        : new Date(startOfToday.getTime() + day);
      from = f;
      // to is exclusive, but custom usually means inclusive end → add 1 day
      to = new Date(t.getTime() + day);
      label = `${customFrom ?? ""} → ${customTo ?? ""}`;
      break;
    }
  }

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    preset,
    label,
  };
}
