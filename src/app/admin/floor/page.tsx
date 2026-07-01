import { requireAdmin } from "@/lib/admin";
import { getFloorAreas, getTablesByAreaForEditor } from "@/lib/queries";
import { FloorEditor } from "./FloorEditor";

/**
 * Admin page: Kelola Denah.
 * Editor visual letak meja per area — drag-drop posisi + CRUD meja & area.
 */
export default async function AdminFloorPage() {
  const bar = await requireAdmin();
  const areas = await getFloorAreas(bar.id);
  const areasWithTables = await Promise.all(
    areas.map(async (area) => ({
      area,
      tables: await getTablesByAreaForEditor(area.id),
    }))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Manage Floor Plan</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Arrange tables per area: drag a table to move it, add/remove tables &
          areas, set capacity, shape, and size.
        </p>
      </div>

      <FloorEditor initialAreas={areasWithTables} />
    </div>
  );
}
