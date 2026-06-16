import { requireAdmin } from "@/lib/admin";
import { getFloorAreas, getTablesByArea } from "@/lib/queries";
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
      tables: await getTablesByArea(area.id),
    }))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Kelola Denah</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Atur letak meja per area: tarik meja untuk pindah posisi, tambah/hapus
          meja & area, atur kapasitas, bentuk, dan ukuran.
        </p>
      </div>

      <FloorEditor initialAreas={areasWithTables} />
    </div>
  );
}
