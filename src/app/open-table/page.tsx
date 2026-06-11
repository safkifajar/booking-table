import { Suspense } from "react";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tables, floorAreas, bars } from "@/lib/db/schema/venue";
import { getCurrentUser } from "@/lib/auth-v2/current";
import { OpenTableForm } from "./OpenTableForm";

interface PageProps {
  searchParams: Promise<{ tableId?: string }>;
}

export default async function OpenTablePage({ searchParams }: PageProps) {
  const { tableId } = await searchParams;
  if (!tableId) redirect("/");

  const user = await getCurrentUser();
  if (!user) {
    redirect(`/auth?next=${encodeURIComponent(`/open-table?tableId=${tableId}`)}`);
  }

  // Single join: table → area → bar
  const [row] = await db
    .select({
      table_id: tables.id,
      label: tables.label,
      shape: tables.shape,
      capacity: tables.capacity,
      min_spend: tables.minSpend,
      area_name: floorAreas.name,
      bar_name: bars.name,
      bar_slug: bars.slug,
    })
    .from(tables)
    .innerJoin(floorAreas, eq(floorAreas.id, tables.areaId))
    .innerJoin(bars, eq(bars.id, floorAreas.barId))
    .where(eq(tables.id, tableId));

  if (!row) redirect("/");

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-8">
      <Suspense>
        <OpenTableForm
          table={{
            id: row.table_id,
            label: row.label,
            shape: row.shape,
            capacity: row.capacity,
            min_spend: row.min_spend ?? 0,
          }}
          areaName={row.area_name}
          barName={row.bar_name}
          barSlug={row.bar_slug}
        />
      </Suspense>
    </main>
  );
}
