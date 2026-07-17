import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAdmin, getTransactionDetail } from "@/lib/admin";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  MapPin,
  Clock,
  Users,
  ChevronRight,
  ArrowRightLeft,
} from "lucide-react";
import { formatIDR, initials } from "@/lib/utils";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { InvoicePrintButton } from "./InvoicePrintButton";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * Status TAMPILAN pembayaran: pending yg QR-nya lewat expiry → "cancelled"
 * (samakan sisi customer/kasir/waiter). failed juga "cancelled".
 * `nowMs` di-pass supaya tak panggil Date.now() saat render.
 */
function nowMs(): number {
  return Date.now();
}
function paymentDisplayStatus(status: string, expiresAt: string | null): string {
  const expired =
    status === "pending" && expiresAt != null && new Date(expiresAt).getTime() <= nowMs();
  if (expired || status === "failed") return "cancelled";
  return status;
}

export default async function InvoiceDetailPage({ params }: PageProps) {
  const bar = await requireAdmin();
  const { id } = await params;

  // Pakai admin.ts getTransactionDetail — sudah cek bar_id match
  const detail = await getTransactionDetail(bar.id, id);
  if (!detail) notFound();

  // Convenience aliases match UI binding original
  const session = {
    title: detail.title,
    started_at: detail.started_at,
    closed_at: detail.closed_at,
  };
  const table = { label: detail.table_label, shape: detail.table_shape };
  const area = { name: detail.area_name };
  const host = { display_name: detail.host_name };
  const items = detail.items;
  const payments = detail.payments;
  const members = detail.members;
  const memberCount = detail.member_count;
  const subtotal = detail.subtotal;
  const totalPaid = detail.total_paid;

  const startedAt = new Date(detail.started_at);
  const closedAt = detail.closed_at ? new Date(detail.closed_at) : null;
  const durationMin = closedAt
    ? Math.floor((closedAt.getTime() - startedAt.getTime()) / 60_000)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 print:p-0 print:max-w-none">
      {/* Top bar — hidden on print */}
      <div className="flex items-center justify-between mb-6 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/transactions">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <InvoicePrintButton />
      </div>

      {/* Invoice */}
      <Card className="p-8 sm:p-10 print:border-none print:shadow-none print:bg-white print:text-black print:p-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-6 pb-6 border-b border-border print:border-black/20">
          <div>
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
            <div className="text-muted-foreground print:text-black/60 mb-1">Session</div>
            <div className="font-medium">{session.title ?? "Open Table"}</div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Started</div>
            <div>{startedAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })}</div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Ended</div>
            <div>
              {closedAt
                ? closedAt.toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" })
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Location</div>
            <div className="flex items-center gap-1">
              <MapPin className="h-3 w-3" /> {area.name} · {table.shape}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground print:text-black/60 mb-1">Members</div>
            <div className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {memberCount ?? 0} people
              {durationMin !== null && (
                <span className="ml-2 flex items-center gap-1 text-muted-foreground print:text-black/60">
                  <Clock className="h-3 w-3" /> {durationMin}m
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Daftar anggota meja — klik untuk lihat detail customer (sembunyi saat print) */}
        <div className="border-t border-border pt-4 print:hidden">
          <div className="flex items-center gap-1.5 text-sm font-semibold mb-3">
            <Users className="h-4 w-4" /> Table Members
            <span className="font-normal text-muted-foreground">
              ({members.length})
            </span>
          </div>
          {members.length === 0 ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {members.map((m) => {
                const roleLabel =
                  m.role === "host" ? "Host" : m.is_guest ? "Guest" : "Member";
                const statusLabel =
                  m.status === "joined"
                    ? null
                    : m.status === "left"
                      ? "left"
                      : m.status === "kicked"
                        ? "removed"
                        : m.status === "pending"
                          ? "pending"
                          : m.status;
                const inner = (
                  <>
                    <Avatar className="h-9 w-9 shrink-0">
                      {m.avatar && <AvatarImage src={m.avatar} />}
                      <AvatarFallback className="text-xs">
                        {initials(m.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate">
                          {m.name}
                        </span>
                        {m.role === "host" && (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1.5 bg-primary/15 text-primary border-primary/30"
                          >
                            Host
                          </Badge>
                        )}
                      </div>
                      <span className="text-[11px] text-muted-foreground">
                        {roleLabel}
                        {statusLabel && ` · ${statusLabel}`}
                        {!m.is_customer && " · no account"}
                      </span>
                    </div>
                  </>
                );
                // Hanya customer terdaftar (bukan guest/staff) yg punya halaman detail.
                return m.is_customer ? (
                  <Link
                    key={m.profile_id}
                    href={`/admin/users/${m.profile_id}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-2.5 transition hover:bg-muted/40 group"
                  >
                    {inner}
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition shrink-0" />
                  </Link>
                ) : (
                  <div
                    key={m.profile_id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-2.5 cursor-default opacity-80"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Move history — riwayat pindah meja (kalau pernah pindah) */}
        {detail.move_history.length > 0 && (
          <div className="border-t border-border print:border-black/20 pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold mb-3">
              <ArrowRightLeft className="h-4 w-4" /> Table Moves
              <span className="text-xs font-normal text-muted-foreground">
                ({detail.move_history.length})
              </span>
            </div>
            <ol className="space-y-2">
              {detail.move_history.map((mv) => (
                <li
                  key={mv.id}
                  className="flex items-center gap-2 text-sm flex-wrap"
                >
                  <span className="tabular-nums text-xs text-muted-foreground">
                    {new Date(mv.at).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                  <span className="font-medium">
                    Table {mv.from_label} →{" "}
                    <span className="text-primary">{mv.to_label}</span>
                  </span>
                  {mv.status !== "approved" && (
                    <Badge variant="secondary" className="text-[10px] capitalize">
                      {mv.status}
                    </Badge>
                  )}
                  {mv.by_staff_name && (
                    <span className="text-xs text-muted-foreground">
                      by {mv.by_staff_name}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Items table */}
        <div className="border-t border-border print:border-black/20 pt-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground print:text-black/60 border-b border-border print:border-black/20">
                <th className="text-left py-2 w-12">#</th>
                <th className="text-left py-2">Item</th>
                <th className="text-right py-2 w-12">Qty</th>
                <th className="text-right py-2 w-24">Price</th>
                <th className="text-right py-2 w-28">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr
                  key={i.id}
                  className="border-b border-border/40 print:border-black/10 align-top"
                >
                  <td className="py-2 text-xs text-muted-foreground print:text-black/60 tabular-nums">
                    {i.queue_number !== null ? `#${String(i.queue_number).padStart(3, "0")}` : "—"}
                  </td>
                  <td className="py-2">
                    <div className="font-medium">{i.menu_item_name}</div>
                    <div className="text-[10px] text-muted-foreground print:text-black/60">
                      by {i.added_by_name}
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
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No items.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Totals — charge (tax/service sesuai toggle) TAMPIL & Total =
            subtotal + charge (dulu Total salah = subtotal saja, sementara
            Paid sudah termasuk charge). */}
        <div className="pt-4 mt-4 border-t border-border print:border-black/20 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground print:text-black/70">Subtotal</span>
            <span className="font-semibold tabular-nums">{formatIDR(subtotal)}</span>
          </div>
          {detail.charge > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground print:text-black/70">
                {detail.charge_label} ({detail.charge_percent}%)
              </span>
              <span className="font-semibold tabular-nums">
                {formatIDR(detail.charge)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground print:text-black/70">Paid</span>
            <span className="font-semibold tabular-nums text-emerald-400 print:text-black">
              {formatIDR(totalPaid)}
            </span>
          </div>
          {detail.total - totalPaid > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground print:text-black/70">Remaining</span>
              <span className="font-semibold tabular-nums text-amber-400 print:text-black">
                {formatIDR(detail.total - totalPaid)}
              </span>
            </div>
          )}
          <div className="flex justify-between text-base pt-2 border-t border-border print:border-black/20 mt-2">
            <span className="font-semibold">Total</span>
            <span className="font-bold text-primary text-lg tabular-nums print:text-black">
              {formatIDR(detail.total)}
            </span>
          </div>
        </div>

        {/* Payment details */}
        {payments.length > 0 && (
          <div className="pt-4 mt-4 border-t border-border print:border-black/20">
            <h3 className="text-[10px] uppercase tracking-widest text-muted-foreground print:text-black/60 mb-2">
              Payments
            </h3>
            <div className="space-y-1.5 text-xs">
              {payments.map((p) => (
                <div key={p.id} className="flex justify-between gap-3">
                  <div className="min-w-0">
                    <div>
                      {p.paid_by_name}
                      <span className="text-muted-foreground print:text-black/60">
                        {" "}
                        · {p.method.toUpperCase()} · {p.split_mode}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground print:text-black/50 mt-0.5 flex flex-wrap items-center gap-x-2">
                      <span className="font-mono">
                        #{p.id.slice(0, 8).toUpperCase()}
                      </span>
                      <span>
                        {p.paid_at
                          ? new Date(p.paid_at).toLocaleString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })
                          : "Not paid yet"}
                      </span>
                      {p.at_table && (
                        <span className="inline-flex items-center gap-0.5">
                          <MapPin className="h-2.5 w-2.5" /> Table {p.at_table}
                        </span>
                      )}
                    </div>
                    {/* Rincian item (pembayaran itemized). */}
                    {p.items.length > 0 && (
                      <div className="mt-1 space-y-0.5 text-[10px] text-muted-foreground print:text-black/60">
                        {p.items.map((it, idx) => (
                          <div key={idx} className="flex justify-between gap-2">
                            <span className="truncate">
                              {it.quantity}× {it.name}
                            </span>
                            <span className="tabular-nums shrink-0">
                              {formatIDR(it.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="tabular-nums shrink-0">
                    {formatIDR(p.amount)}
                    {p.status !== "paid" && (
                      <span className="ml-1 text-[10px] text-amber-400">
                        ({paymentDisplayStatus(p.status, p.expires_at)})
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="pt-6 mt-6 border-t border-border print:border-black/20 text-center">
          <p className="text-xs text-muted-foreground print:text-black/60">
            Thank you for visiting
          </p>
          <p className="text-[10px] text-muted-foreground/60 print:text-black/40 mt-1">
            Printed via booking-table · {new Date().toLocaleDateString("en-US")}
          </p>
        </div>
      </Card>
    </div>
  );
}
