import { notFound } from "next/navigation";
import { getBarBySlug, getFloorAreas, getTablesByArea, getActiveSessionsForArea } from "@/lib/queries";
import { BarFloorView } from "./BarFloorView";
import type { FloorMapTable } from "@/components/floor/FloorMap";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export default async function BarPage({ params }: PageProps) {
  const { slug } = await params;
  const bar = await getBarBySlug(slug);
  if (!bar) notFound();

  const areas = await getFloorAreas(bar.id);

  const areasWithTables = await Promise.all(
    areas.map(async (area) => {
      const [tables, sessions] = await Promise.all([
        getTablesByArea(area.id),
        getActiveSessionsForArea(area.id),
      ]);
      const tablesWithSession: FloorMapTable[] = tables.map((t) => ({
        ...t,
        active_session: sessions.find((s) => s.table_id === t.id) ?? null,
      }));
      return { area, tables: tablesWithSession };
    })
  );

  return <BarFloorView bar={bar} areasWithTables={areasWithTables} />;
}
