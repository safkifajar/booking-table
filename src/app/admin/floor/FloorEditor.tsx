"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  Plus,
  Trash2,
  Save,
  Pencil,
  Loader2,
  LayoutGrid,
  Check,
  CloudOff,
} from "lucide-react";
import { cn, getActionErrorMessage } from "@/lib/utils";
import {
  createArea,
  updateArea,
  deleteArea,
  createTable,
  updateTable,
  deleteTable,
  saveDraftPositions,
  publishPositions,
} from "@/lib/floor-actions";
import { tableSize } from "@/lib/table-size";
import type { FloorArea, BarTable, TableShape } from "@/types/db";

type AreaWithTables = { area: FloorArea; tables: BarTable[] };

const SHAPES: { value: TableShape; label: string }[] = [
  { value: "round", label: "Bulat" },
  { value: "square", label: "Kotak" },
  { value: "rect", label: "Persegi panjang" },
  { value: "booth", label: "Booth" },
];

interface Props {
  initialAreas: AreaWithTables[];
}

export function FloorEditor({ initialAreas }: Props) {
  const router = useRouter();

  const [activeAreaId, setActiveAreaId] = React.useState<string>(
    initialAreas[0]?.area.id ?? ""
  );
  const active = initialAreas.find((a) => a.area.id === activeAreaId) ?? null;

  const [areaModal, setAreaModal] = React.useState<FloorArea | "new" | null>(
    null
  );

  const confirm = useConfirm();

  async function handleDeleteArea(area: FloorArea) {
    const ok = await confirm({
      title: `Hapus area "${area.name}"?`,
      description:
        "Semua meja di area ini ikut terhapus. Tidak bisa kalau ada meja yang sedang dipakai.",
      confirmText: "Hapus",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteArea(area.id);
      toast.success("Area dihapus");
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus area"));
    }
  }

  if (initialAreas.length === 0) {
    return (
      <Card className="p-8 text-center space-y-3 border-dashed">
        <LayoutGrid className="h-8 w-8 mx-auto text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Belum ada area. Buat area dulu (mis. Indoor Lounge, Rooftop).
        </p>
        <Button variant="gold" onClick={() => setAreaModal("new")}>
          <Plus className="h-4 w-4" /> Buat Area
        </Button>
        {areaModal && (
          <AreaDialog
            target={areaModal}
            onClose={() => setAreaModal(null)}
            onSaved={() => {
              setAreaModal(null);
              router.refresh();
            }}
          />
        )}
      </Card>
    );
  }

  // seedKey: berubah saat area ganti / posisi meja berubah dari server →
  // remount AreaWorkspace utk re-seed posisi (tanpa setState-in-effect).
  const seedKey = active
    ? active.area.id +
      "|" +
      active.tables.map((t) => `${t.id}:${t.pos_x}:${t.pos_y}`).join(",")
    : "";

  return (
    <div className="space-y-4">
      {/* Tabs area + kelola */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-2 overflow-x-auto flex-1">
          {initialAreas.map(({ area }) => (
            <button
              key={area.id}
              type="button"
              onClick={() => setActiveAreaId(area.id)}
              className={cn(
                "shrink-0 px-3.5 py-1.5 rounded-full border text-sm font-medium transition",
                activeAreaId === area.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
              )}
            >
              {area.name}
            </button>
          ))}
        </div>
        <Button variant="outline" size="sm" onClick={() => setAreaModal("new")}>
          <Plus className="h-4 w-4" /> Area
        </Button>
      </div>

      {active && (
        <AreaWorkspace
          key={seedKey}
          area={active.area}
          tables={active.tables}
          onEditArea={() => setAreaModal(active.area)}
          onDeleteArea={() => handleDeleteArea(active.area)}
        />
      )}

      {areaModal && (
        <AreaDialog
          target={areaModal}
          onClose={() => setAreaModal(null)}
          onSaved={() => {
            setAreaModal(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// AREA WORKSPACE — toolbar + kanvas drag + panel meja (1 area)
// Di-remount via key={seedKey} jadi posisi di-seed dari props tanpa effect.
// ============================================================

function AreaWorkspace({
  area,
  tables,
  onEditArea,
  onDeleteArea,
}: {
  area: FloorArea;
  tables: BarTable[];
  onEditArea: () => void;
  onDeleteArea: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();

  // Seed posisi dari props (lazy init — remount saat seedKey ganti).
  const [positions, setPositions] = React.useState<
    Record<string, { x: number; y: number }>
  >(() => {
    const seed: Record<string, { x: number; y: number }> = {};
    for (const t of tables) seed[t.id] = { x: t.pos_x, y: t.pos_y };
    return seed;
  });

  // Status auto-save (draft): saved = tersimpan ke draft, unsaved/saving/error.
  type SaveStatus = "saved" | "unsaved" | "saving" | "error";
  const [status, setStatus] = React.useState<SaveStatus>("saved");

  // Ada draft belum di-publish? Awal dari props (data server), lalu jadi true
  // begitu ada auto-save draft baru. Reset false setelah publish.
  const [hasDraft, setHasDraft] = React.useState(
    tables.some(
      (t) => t.draft_pos_x != null || t.draft_pos_y != null || t.is_draft
    )
  );
  const [publishing, setPublishing] = React.useState(false);

  const [selectedTableId, setSelectedTableId] = React.useState<string | null>(
    null
  );
  const [editTarget, setEditTarget] = React.useState<BarTable | "new" | null>(
    null
  );
  const selectedTable = tables.find((t) => t.id === selectedTableId) ?? null;

  // Latest positions via ref — di-update di event handler (handleMove), BUKAN
  // saat render. Dipakai debounce callback tanpa stale closure.
  const positionsRef = React.useRef(positions);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Simpan draft ke server (auto-save).
  async function saveDraftNow() {
    setStatus("saving");
    try {
      await saveDraftPositions({
        areaId: area.id,
        positions: tables.map((t) => ({
          id: t.id,
          posX: Math.round(positionsRef.current[t.id]?.x ?? t.pos_x),
          posY: Math.round(positionsRef.current[t.id]?.y ?? t.pos_y),
        })),
      });
      setStatus("saved");
      setHasDraft(true); // ada draft baru → tombol publish aktif
    } catch {
      setStatus("error");
    }
  }

  // Dipanggil saat drag (event handler): update posisi lokal + ref + jadwalkan
  // auto-save (debounce).
  function handleMove(id: string, x: number, y: number) {
    const next = { ...positionsRef.current, [id]: { x, y } };
    positionsRef.current = next;
    setPositions(next);
    setStatus("unsaved");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void saveDraftNow();
    }, 700);
  }

  // Flush draft tertunda sebelum aksi lain (tambah/edit/hapus meja).
  async function flushDraft() {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    if (status === "unsaved" || status === "saving") {
      await saveDraftNow();
    }
  }

  async function handlePublish() {
    setPublishing(true);
    try {
      await flushDraft(); // pastikan draft terbaru tersimpan dulu
      await publishPositions(area.id);
      toast.success("Posisi dipublish — tampilan customer diperbarui");
      setHasDraft(false);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal publish posisi"));
    } finally {
      setPublishing(false);
    }
  }

  async function openTableDialog(target: BarTable | "new") {
    await flushDraft();
    setEditTarget(target);
  }

  async function handleDeleteTable(t: BarTable) {
    const ok = await confirm({
      title: `Hapus meja ${t.label}?`,
      description: "Meja dihapus permanen. Tidak bisa kalau sedang dipakai.",
      confirmText: "Hapus",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await flushDraft();
      await deleteTable(t.id);
      toast.success(`Meja ${t.label} dihapus`);
      setSelectedTableId(null);
      router.refresh();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal hapus meja"));
    }
  }

  // Bisa publish kalau ada draft belum dipublish, atau lagi/baru ada perubahan.
  const canPublish = hasDraft || status !== "saved";

  return (
    <>
      {/* Toolbar area */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">
          {area.name} · {area.canvas_width}×{area.canvas_height} ·{" "}
          {tables.length} meja
        </span>
        <SaveStatusBadge status={status} published={!hasDraft} />
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onEditArea}>
          <Pencil className="h-4 w-4" /> Edit Area
        </Button>
        <Button variant="ghost" size="sm" onClick={onDeleteArea}>
          <Trash2 className="h-4 w-4 text-red-400" /> Hapus Area
        </Button>
        <Button variant="outline" size="sm" onClick={() => openTableDialog("new")}>
          <Plus className="h-4 w-4" /> Tambah Meja
        </Button>
        <Button
          variant="gold"
          size="sm"
          disabled={!canPublish || publishing || status === "saving"}
          onClick={handlePublish}
        >
          {publishing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Simpan Posisi
        </Button>
      </div>

      <EditorCanvas
        area={area}
        tables={tables}
        positions={positions}
        selectedId={selectedTableId}
        onSelect={setSelectedTableId}
        onMove={handleMove}
      />

      {selectedTable ? (
        <Card className="p-4 flex flex-wrap items-center gap-3">
          <Badge variant="default" className="text-xs">
            {selectedTable.label}
          </Badge>
          <span className="text-sm text-muted-foreground capitalize">
            {selectedTable.shape} · {selectedTable.capacity} kursi
            {selectedTable.min_spend
              ? ` · min ${selectedTable.min_spend.toLocaleString("id-ID")}`
              : ""}
          </span>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => openTableDialog(selectedTable)}
          >
            <Pencil className="h-4 w-4" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleDeleteTable(selectedTable)}
          >
            <Trash2 className="h-4 w-4 text-red-400" /> Hapus
          </Button>
        </Card>
      ) : (
        <p className="text-xs text-muted-foreground text-center">
          Tap meja di denah untuk pilih & edit. Tarik untuk pindah posisi.
        </p>
      )}

      {editTarget && (
        <TableDialog
          target={editTarget}
          areaId={area.id}
          canvas={{ w: area.canvas_width, h: area.canvas_height }}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

// ============================================================
// CANVAS — drag-drop meja (SVG)
// ============================================================

function EditorCanvas({
  area,
  tables,
  positions,
  selectedId,
  onSelect,
  onMove,
}: {
  area: FloorArea;
  tables: BarTable[];
  positions: Record<string, { x: number; y: number }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const svgRef = React.useRef<SVGSVGElement>(null);
  const dragRef = React.useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  // Konversi koordinat client → koordinat kanvas (memperhitungkan scale).
  function toCanvas(clientX: number, clientY: number) {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const scaleX = area.canvas_width / rect.width;
    const scaleY = area.canvas_height / rect.height;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(e: React.PointerEvent, t: BarTable) {
    e.preventDefault();
    onSelect(t.id);
    const pos = positions[t.id] ?? { x: t.pos_x, y: t.pos_y };
    const p = toCanvas(e.clientX, e.clientY);
    dragRef.current = { id: t.id, offsetX: p.x - pos.x, offsetY: p.y - pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const t = tables.find((x) => x.id === d.id);
    if (!t) return;
    const p = toCanvas(e.clientX, e.clientY);
    let x = p.x - d.offsetX;
    let y = p.y - d.offsetY;
    // Clamp dalam kanvas.
    x = Math.max(0, Math.min(area.canvas_width - t.width, x));
    y = Math.max(0, Math.min(area.canvas_height - t.height, y));
    onMove(d.id, x, y);
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-gradient-to-br from-[#0f0f0f] to-[#0a0a0a]">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${area.canvas_width} ${area.canvas_height}`}
        className="w-full touch-none select-none"
        style={{ aspectRatio: `${area.canvas_width} / ${area.canvas_height}` }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {/* Grid */}
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width={area.canvas_width} height={area.canvas_height} fill="url(#grid)" />

        {tables.map((t) => {
          const pos = positions[t.id] ?? { x: t.pos_x, y: t.pos_y };
          const cx = pos.x + t.width / 2;
          const cy = pos.y + t.height / 2;
          const selected = selectedId === t.id;
          // Meja draft (baru, belum publish) → stroke biru putus-putus.
          const isDraft = !!t.is_draft;
          const stroke = selected
            ? "#ff4d57"
            : isDraft
              ? "#60a5fa"
              : "#e11d2a";
          const fill = isDraft
            ? "rgba(96,165,250,0.12)"
            : "rgba(225, 29, 42,0.18)";
          const dash = isDraft ? "6 4" : undefined;
          return (
            <g
              key={t.id}
              onPointerDown={(e) => onPointerDown(e, t)}
              className="cursor-move"
            >
              {t.shape === "round" ? (
                <ellipse
                  cx={cx}
                  cy={cy}
                  rx={t.width / 2}
                  ry={t.height / 2}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={selected ? 3 : 2}
                  strokeDasharray={dash}
                  transform={t.rotation ? `rotate(${t.rotation} ${cx} ${cy})` : undefined}
                />
              ) : (
                <rect
                  x={pos.x}
                  y={pos.y}
                  width={t.width}
                  height={t.height}
                  rx={t.shape === "booth" ? 16 : 8}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={selected ? 3 : 2}
                  strokeDasharray={dash}
                  transform={t.rotation ? `rotate(${t.rotation} ${cx} ${cy})` : undefined}
                />
              )}
              <text
                x={cx}
                y={cy - 2}
                textAnchor="middle"
                fontSize="14"
                fontWeight="600"
                fill="#ff4d57"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {t.label}
              </text>
              <text
                x={cx}
                y={cy + 14}
                textAnchor="middle"
                fontSize="10"
                fill="rgba(255,255,255,0.4)"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {t.capacity} kursi
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ============================================================
// DIALOG MEJA
// ============================================================

function TableDialog({
  target,
  areaId,
  canvas,
  onClose,
  onSaved,
}: {
  target: BarTable | "new";
  areaId: string;
  canvas: { w: number; h: number };
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = target === "new";
  const t = isNew ? null : target;

  const [label, setLabel] = React.useState(t?.label ?? "");
  const [shape, setShape] = React.useState<TableShape>(t?.shape ?? "round");
  const [capacity, setCapacity] = React.useState(String(t?.capacity ?? 4));
  const [rotation, setRotation] = React.useState(String(t?.rotation ?? 0));
  const [minSpend, setMinSpend] = React.useState(String(t?.min_spend ?? 0));
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const common = {
        label: label.trim(),
        shape,
        capacity: Number(capacity),
        rotation: Number(rotation),
        minSpend: Number(minSpend) || 0,
      };
      if (isNew) {
        // Ukuran otomatis dari kapasitas+bentuk → taruh di tengah kanvas.
        const size = tableSize(shape, Number(capacity));
        await createTable({
          areaId,
          ...common,
          posX: Math.round((canvas.w - size.width) / 2),
          posY: Math.round((canvas.h - size.height) / 2),
        });
        toast.success("Meja dibuat");
      } else {
        await updateTable({
          id: t!.id,
          ...common,
          posX: t!.pos_x,
          posY: t!.pos_y,
        });
        toast.success("Meja diperbarui");
      }
      onSaved();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan meja"));
      setSaving(false);
    }
  }

  const inputCls =
    "w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "Tambah Meja" : `Edit Meja ${t!.label}`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Label">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                required
                maxLength={20}
                placeholder="mis. T1"
                className={inputCls}
              />
            </Field>
            <Field label="Kapasitas (kursi)">
              <input
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                required
                min={1}
                max={50}
                className={inputCls}
              />
            </Field>
          </div>
          <Field label="Bentuk">
            <select
              value={shape}
              onChange={(e) => setShape(e.target.value as TableShape)}
              className={inputCls}
            >
              {SHAPES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rotasi ° (0 = normal)">
            <input
              type="number"
              value={rotation}
              onChange={(e) => setRotation(e.target.value)}
              min={0}
              max={359}
              className={inputCls}
            />
          </Field>
          <p className="text-xs text-muted-foreground -mt-1">
            Ukuran meja otomatis menyesuaikan jumlah kursi & bentuk.
          </p>
          <Field label="Min spend (Rp, 0 = tidak ada)">
            <input
              type="number"
              value={minSpend}
              onChange={(e) => setMinSpend(e.target.value)}
              min={0}
              className={inputCls}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isNew ? "Buat" : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// DIALOG AREA
// ============================================================

function AreaDialog({
  target,
  onClose,
  onSaved,
}: {
  target: FloorArea | "new";
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = target === "new";
  const a = isNew ? null : target;

  const [name, setName] = React.useState(a?.name ?? "");
  const [w, setW] = React.useState(String(a?.canvas_width ?? 800));
  const [h, setH] = React.useState(String(a?.canvas_height ?? 600));
  const [saving, setSaving] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const common = {
        name: name.trim(),
        canvasWidth: Number(w),
        canvasHeight: Number(h),
      };
      if (isNew) {
        await createArea(common);
        toast.success("Area dibuat");
      } else {
        await updateArea({ id: a!.id, ...common });
        toast.success("Area diperbarui");
      }
      onSaved();
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal simpan area"));
      setSaving(false);
    }
  }

  const inputCls =
    "w-full h-10 px-3 rounded-md bg-input border border-border text-sm focus:outline-none focus:border-primary/60";

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isNew ? "Tambah Area" : `Edit Area`}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <Field label="Nama area">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              placeholder="mis. Indoor Lounge"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Lebar kanvas">
              <input
                type="number"
                value={w}
                onChange={(e) => setW(e.target.value)}
                required
                min={200}
                max={3000}
                className={inputCls}
              />
            </Field>
            <Field label="Tinggi kanvas">
              <input
                type="number"
                value={h}
                onChange={(e) => setH(e.target.value)}
                required
                min={200}
                max={3000}
                className={inputCls}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" variant="gold" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isNew ? "Buat" : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Status simpan ala Notion: Menyimpan… / Draft tersimpan / dipublish.
function SaveStatusBadge({
  status,
  published,
}: {
  status: "saved" | "unsaved" | "saving" | "error";
  published: boolean;
}) {
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Menyimpan…
      </span>
    );
  }
  if (status === "unsaved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-amber-400">
        <CloudOff className="h-3 w-3" /> Belum disimpan
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-red-400">
        <CloudOff className="h-3 w-3" /> Gagal simpan
      </span>
    );
  }
  // saved
  return (
    <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
      <Check className="h-3 w-3" />
      {published ? "Tersimpan & dipublish" : "Draft tersimpan"}
    </span>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
    </label>
  );
}
