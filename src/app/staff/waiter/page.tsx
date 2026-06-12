import Link from "next/link";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tableSessions, sessionMembers } from "@/lib/db/schema/sessions";
import { tables, floorAreas } from "@/lib/db/schema/venue";
import { profiles } from "@/lib/db/schema/profiles";
import { orders, orderItems } from "@/lib/db/schema/orders";
import { menuItems } from "@/lib/db/schema/menu";
import { getActiveSessionsByBar } from "@/lib/queries";
import { requireAnyRole } from "@/lib/auth-v2/permissions";
import { Button } from "@/components/ui/button";
import { StaffDashboard } from "../StaffDashboard";
import { ChefHat, QrCode } from "lucide-react";

/**
 * Waiter dashboard — queue order management + assist meja.
 *
 * Allowed roles: waiter, manager, admin.
 * (cashier diarahkan ke /staff/cashier, lihat permission helpers.)
 */
export default async function StaffWaiterPage() {
  const ctx = await requireAnyRole(
    ["waiter", "manager", "admin"],
    "/staff/waiter"
  );

  // Lookup bar info
  const barRow = await db.query.bars.findFirst({
    where: (b, { eq }) => eq(b.id, ctx.barId),
    columns: { id: true, name: true, slug: true },
  });
  if (!barRow) {
    return (
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <p className="text-sm text-muted-foreground">Bar tidak ditemukan</p>
      </main>
    );
  }
  const bar = barRow;

  // 1. Active sessions di bar
  const activeSessions = await getActiveSessionsByBar(bar.id);

  // 2. Queue items (sent/preparing)
  const sessionIds = activeSessions.map((s) => s.id);
  const queueRaw =
    sessionIds.length > 0
      ? await db
          .select({
            id: orderItems.id,
            quantity: orderItems.quantity,
            notes: orderItems.notes,
            status: orderItems.status,
            created_at: orderItems.createdAt,
            queue_number: orderItems.queueNumber,
            menu_item_name: menuItems.name,
            menu_item_prep_minutes: menuItems.prepMinutes,
            added_by_display_name: profiles.displayName,
            added_by_avatar_url: profiles.avatarUrl,
            session_id: tableSessions.id,
            session_title: tableSessions.title,
            table_label: tables.label,
            area_name: floorAreas.name,
          })
          .from(orderItems)
          .innerJoin(orders, eq(orders.id, orderItems.orderId))
          .innerJoin(tableSessions, eq(tableSessions.id, orders.sessionId))
          .innerJoin(tables, eq(tables.id, tableSessions.tableId))
          .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
          .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
          .innerJoin(
            sessionMembers,
            eq(sessionMembers.id, orderItems.addedByMemberId)
          )
          .innerJoin(profiles, eq(profiles.id, sessionMembers.profileId))
          .where(
            and(
              inArray(orderItems.status, ["sent", "preparing"]),
              inArray(tableSessions.id, sessionIds)
            )
          )
          .orderBy(asc(orderItems.queueNumber))
      : [];

  // 3. Bills per session
  const billsRaw =
    sessionIds.length > 0
      ? await db
          .select({
            session_id: orders.sessionId,
            subtotal: sql<number>`COALESCE(SUM(${orderItems.quantity} * ${orderItems.unitPrice}), 0)::int`,
            item_count: sql<number>`COUNT(${orderItems.id})::int`,
          })
          .from(orders)
          .leftJoin(
            orderItems,
            and(
              eq(orderItems.orderId, orders.id),
              sql`${orderItems.status} <> 'void'`
            )
          )
          .where(inArray(orders.sessionId, sessionIds))
          .groupBy(orders.sessionId)
      : [];

  const billMap = new Map(billsRaw.map((b) => [b.session_id, b]));

  const queue = queueRaw.map((qi) => ({
    id: qi.id,
    quantity: qi.quantity,
    notes: qi.notes,
    status: qi.status as "sent" | "preparing",
    created_at: qi.created_at.toISOString(),
    queue_number: qi.queue_number,
    menu_item: {
      name: qi.menu_item_name,
      prep_minutes: qi.menu_item_prep_minutes ?? 0,
    },
    added_by: {
      display_name: qi.added_by_display_name,
      avatar_url: qi.added_by_avatar_url,
    },
    table: { label: qi.table_label, area_name: qi.area_name },
    session_id: qi.session_id,
    session_title: qi.session_title,
  }));

  const tableSessionsList = activeSessions.map((s) => ({
    session_id: s.id,
    table_label: s.table_label,
    area_name: s.area_name,
    title: s.title,
    host_name: s.host_name,
    host_avatar: s.host_avatar,
    member_count: s.member_count,
    table_capacity: s.table_capacity,
    started_at: s.started_at,
    subtotal: Number(billMap.get(s.id)?.subtotal ?? 0),
    item_count: Number(billMap.get(s.id)?.item_count ?? 0),
  }));

  return (
    <main className="flex-1 pb-12">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
            <ChefHat className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-primary/70">
              Waiter Dashboard · {ctx.role}
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">
              {bar.name}
            </h1>
          </div>
          <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
            <Link href="/staff/qr">
              <QrCode className="h-4 w-4" /> QR Codes
            </Link>
          </Button>
        </div>
      </header>

      <StaffDashboard
        initialQueue={queue}
        initialTables={tableSessionsList}
        barId={bar.id}
      />
    </main>
  );
}
