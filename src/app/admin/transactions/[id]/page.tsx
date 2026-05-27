import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Printer, MapPin, Clock, Users } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import { InvoicePrintButton } from "./InvoicePrintButton";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const bar = await requireAdmin();
  const { id } = await params;
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
    .eq("id", id)
    .maybeSingle();

  if (!session) notFound();

  const table = Array.isArray(session.tables) ? session.tables[0] : session.tables;
  const area = Array.isArray(table.floor_areas) ? table.floor_areas[0] : table.floor_areas;
  if (area.bar_id !== bar.id) notFound();

  const host = Array.isArray(session.host) ? session.host[0] : session.host;

  // Order items
  const { data: order } = await supabase
    .from("orders")
    .select("id, closed_at")
    .eq("session_id", id)
    .neq("status", "void")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  const { data: items } = order
    ? await supabase
        .from("order_items")
        .select(
          `id, quantity, unit_price, notes, status, queue_number, created_at,
           menu_item:menu_items!inner(name),
           added_by:session_members!inner(
             profile:profiles!inner(display_name)
           )`
        )
        .eq("order_id", order.id)
        .neq("status", "void")
        .order("queue_number")
    : { data: [] };

  // Payments
  const { data: payments } = order
    ? await supabase
        .from("payments")
        .select(
          `id, amount, method, status, split_mode, paid_at,
           member:session_members!inner(
             profile:profiles!inner(display_name)
           )`
        )
        .eq("order_id", order.id)
        .order("created_at")
    : { data: [] };

  // Members count
  const { count: memberCount } = await supabase
    .from("session_members")
    .select("*", { count: "exact", head: true })
    .eq("session_id", id);

  const subtotal = (items ?? []).reduce(
    (sum, i) => sum + i.quantity * i.unit_price,
    0
  );
  const totalPaid = (payments ?? [])
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  const startedAt = new Date(session.started_at);
  const closedAt = session.closed_at ? new Date(session.closed_at) : null;
  const durationMin = closedAt
    ? Math.floor((closedAt.getTime() - startedAt.getTime()) / 60_000)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 print:p-0 print:max-w-none">
      {/* Top bar — hidden on print */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/transactions">
            <ArrowLeft className="h-4 w-4" /> Kembali
          </Link>
        </Button>
        <InvoicePrintButton />
      </div>

      {/* Invoice */}
      <Card className="p-8 sm:p-10 print:border-none print:shadow-none print:bg-white print:text-black print:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 pb-6 border-b border-border print:border-black/20">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-primary/70 print:text-black/60 mb-1">
              Invoice
            </div>
            <h1 className="text-2xl font-bold text-gold-gradient print:text-black">
              SOHO Social House
            </h1>
            <p className="text-xs text-muted-foreground mt-1 print:text-black/60">
              Jl. Jend. Soedirman, Purwokerto
            </p>
          </div>
          <div className="text-right">
            <Badge variant="default" className="mb-2 print:bg-transparent print:text-black print:border print:border-black">
              {table.label}
            </Badge>
            <div className="text-[10px] text-muted-foreground print:text-black/60">
              #{id.slice(0, 8).toUpperCase()}
            </div>
          </div>
        </div>

        {/* Meta */}
        <div className="grid grid-cols-2 gap-4 py-5 text-xs">
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Host</div>
            <div className="font-medium">{host.display_name}</div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Sesi</div>
            <div className="font-medium">{session.title ?? "Open Table"}</div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Mulai</div>
            <div>{startedAt.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })}</div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Selesai</div>
            <div>
              {closedAt
                ? closedAt.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Lokasi</div>
            <div className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {area.name} · {table.shape}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Anggota</div>
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {memberCount ?? 0} orang
              {durationMin !== null && (
                <span className="ml-2 flex items-center gap-1 text-muted-foreground print:text-black/60">
                  <Clock className="h-3 w-3" /> {durationMin}m
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Items table */}
        <div className="border-t border-border print:border-black/20 pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground print:text-black/60 border-b border-border print:border-black/20">
                <th className="text-left py-2 w-12">#</th>
                <th className="text-left py-2">Item</th>
                <th className="text-right py-2 w-12">Qty</th>
                <th className="text-right py-2 w-24">Harga</th>
                <th className="text-right py-2 w-28">Total</th>
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((i) => {
                const mi = Array.isArray(i.menu_item) ? i.menu_item[0] : i.menu_item;
                const addedBy = Array.isArray(i.added_by) ? i.added_by[0] : i.added_by;
                const addedByProfile = Array.isArray(addedBy.profile)
                  ? addedBy.profile[0]
                  : addedBy.profile;
                return (
                  <tr
                    key={i.id}
                    className="border-b border-border/40 print:border-black/10 align-top"
                  >
                    <td className="py-2 text-xs text-muted-foreground print:text-black/60 tabular-nums">
                      {i.queue_number !== null ? `#${String(i.queue_number).padStart(3, "0")}` : "—"}
                    </td>
                    <td className="py-2">
                      <div className="font-medium">{mi.name}</div>
                      <div className="text-[10px] text-muted-foreground print:text-black/60">
                        by {addedByProfile.display_name}
                        {i.notes && <> · note: {i.notes}</>}
                      </div>
                    </td>
                    <td className="py-2 text-right">{i.quantity}</td>
                    <td className="py-2 text-right text-muted-foreground print:text-black/60 tabular-nums">
                      {formatIDR(i.unit_price)}
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {formatIDR(i.quantity * i.unit_price)}
                    </td>
                  </tr>
                );
              })}
              {(items ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    Tidak ada item.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="pt-4 mt-4 border-t border-border print:border-black/20 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground print:text-black/70">Subtotal</span>
            <span className="font-semibold tabular-nums">{formatIDR(subtotal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground print:text-black/70">Terbayar</span>
            <span className="font-semibold tabular-nums text-emerald-400 print:text-black">
              {formatIDR(totalPaid)}
            </span>
          </div>
          {subtotal - totalPaid > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground print:text-black/70">Sisa</span>
              <span className="font-semibold tabular-nums text-amber-400 print:text-black">
                {formatIDR(subtotal - totalPaid)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-base pt-2 border-t border-border print:border-black/20 mt-2">
            <span className="font-semibold">Total</span>
            <span className="font-bold text-primary text-lg tabular-nums print:text-black">
              {formatIDR(subtotal)}
            </span>
          </div>
        </div>

        {/* Payment details */}
        {(payments ?? []).length > 0 && (
          <div className="pt-4 mt-4 border-t border-border print:border-black/20">
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground print:text-black/60 mb-2">
              Pembayaran
            </h3>
            <div className="space-y-1.5 text-xs">
              {(payments ?? []).map((p) => {
                const member = Array.isArray(p.member) ? p.member[0] : p.member;
                const profile = Array.isArray(member.profile)
                  ? member.profile[0]
                  : member.profile;
                return (
                  <div key={p.id} className="flex justify-between">
                    <span>
                      {profile.display_name}
                      <span className="text-muted-foreground print:text-black/60">
                        {" "}
                        · {p.method.toUpperCase()} · {p.split_mode}
                      </span>
                    </span>
                    <span className="tabular-nums">
                      {formatIDR(p.amount)}
                      {p.status !== "paid" && (
                        <span className="ml-1 text-[10px] text-amber-400">
                          ({p.status})
                        </span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-6 mt-6 border-t border-border print:border-black/20 text-center">
          <p className="text-xs text-muted-foreground print:text-black/60">
            Terima kasih sudah berkunjung
          </p>
          <p className="text-[10px] text-muted-foreground/60 print:text-black/40 mt-1">
            Cetak via booking-table · {new Date().toLocaleDateString("id-ID")}
          </p>
        </div>
      </Card>
    </div>
  );
}
