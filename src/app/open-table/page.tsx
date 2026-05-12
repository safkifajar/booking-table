import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
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

  const supabase = await createClient();
  const { data: table } = await supabase
    .from("tables")
    .select("*, floor_areas(name, bars(name, slug))")
    .eq("id", tableId)
    .maybeSingle();

  if (!table) redirect("/");

  const area = Array.isArray(table.floor_areas)
    ? table.floor_areas[0]
    : table.floor_areas;
  const bar = area?.bars
    ? Array.isArray(area.bars)
      ? area.bars[0]
      : area.bars
    : null;

  return (
    <main className="flex-1 flex items-center justify-center px-4 py-8">
      <Suspense>
        <OpenTableForm
          table={{
            id: table.id,
            label: table.label,
            shape: table.shape,
            capacity: table.capacity,
            min_spend: table.min_spend ?? 0,
          }}
          areaName={area?.name ?? ""}
          barName={bar?.name ?? ""}
          barSlug={bar?.slug ?? ""}
        />
      </Suspense>
    </main>
  );
}
