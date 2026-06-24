import QRCode from "qrcode";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { floorAreas, tables } from "@/lib/db/schema/venue";
import { requireAdmin } from "@/lib/admin";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QrPageActions } from "./QrPageActions";

/**
 * Manage QR Table (admin). Generate + print QR per meja. Dulu di /staff/qr
 * (waiter/kasir) — dipindah ke admin sebagai satu menu manage QR.
 */
export default async function AdminQrPage() {
  const bar = await requireAdmin();
  const barId = bar.id;

  const areasList = await db
    .select({ id: floorAreas.id, name: floorAreas.name, slug: floorAreas.slug })
    .from(floorAreas)
    .where(eq(floorAreas.barId, barId))
    .orderBy(asc(floorAreas.sortOrder));

  const tablesList =
    areasList.length > 0
      ? await db
          .select({
            id: tables.id,
            label: tables.label,
            capacity: tables.capacity,
            shape: tables.shape,
            area_id: tables.areaId,
          })
          .from(tables)
          .where(
            and(
              inArray(
                tables.areaId,
                areasList.map((a) => a.id)
              ),
              eq(tables.isActive, true)
            )
          )
          .orderBy(asc(tables.label))
      : [];

  // Base URL — dari header host (SSR).
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  // QR mengarah ke domain customer (non-admin). Buang prefix "admin." kalau ada.
  const customerHost = host.replace(/^admin\./, "");
  const baseUrl = `${protocol}://${customerHost}`;

  const tablesWithQr = await Promise.all(
    tablesList.map(async (t) => {
      const url = `${baseUrl}/qr/${t.id}`;
      const dataUrl = await QRCode.toDataURL(url, {
        margin: 1,
        width: 300,
        color: { dark: "#0a0a0a", light: "#ffffff" },
        errorCorrectionLevel: "M",
      });
      return { ...t, qrUrl: url, qrImage: dataUrl };
    })
  );

  const grouped = areasList.map((area) => ({
    area,
    tables: tablesWithQr.filter((t) => t.area_id === area.id),
  }));

  return (
    <main className="flex-1 pb-12 print:bg-white print:text-black">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 print:py-0 print:px-0 print:max-w-none">
        {/* Header — hidden on print */}
        <div className="flex items-start justify-between gap-3 mb-5 print:hidden">
          <div>
            <div className="text-xs uppercase tracking-widest text-primary/70 mb-1">
              QR Table
            </div>
            <h1 className="text-2xl font-semibold">QR Meja</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Print & tempel QR di tiap meja. Customer scan → langsung ke meja
              yang benar (buka / gabung / lihat status).
            </p>
          </div>
          <QrPageActions />
        </div>

        {grouped.length === 0 || tablesList.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <p className="text-sm">Belum ada meja.</p>
            <p className="text-xs text-muted-foreground mt-1">
              Tambah meja dulu di Kelola Denah.
            </p>
          </Card>
        ) : (
          <div className="space-y-8 print:space-y-0">
            {grouped.map(({ area, tables }) => (
              <section
                key={area.id}
                className="print:break-before-page first:print:break-before-auto"
              >
                <h2 className="text-lg font-semibold mb-4 print:text-black print:text-xl">
                  {area.name}
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 print:grid-cols-3 print:gap-3">
                  {tables.map((t) => (
                    <QrCard
                      key={t.id}
                      label={t.label}
                      capacity={t.capacity}
                      shape={t.shape}
                      qrImage={t.qrImage}
                      qrUrl={t.qrUrl}
                      barName={bar.name}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function QrCard({
  label,
  capacity,
  shape,
  qrImage,
  qrUrl,
  barName,
}: {
  label: string;
  capacity: number;
  shape: string;
  qrImage: string;
  qrUrl: string;
  barName: string;
}) {
  return (
    <Card className="p-4 flex flex-col items-center text-center print:border print:border-black print:rounded-none print:bg-white print:text-black print:p-3 print:shadow-none">
      <div className="text-[10px] uppercase tracking-widest text-primary/70 mb-1 print:text-black/60">
        {barName}
      </div>
      <Badge
        variant="default"
        className="text-lg font-bold py-1 px-3 mb-2 print:bg-transparent print:text-black print:border print:border-black"
      >
        {label}
      </Badge>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrImage}
        alt={`QR for ${label}`}
        className="w-full max-w-[200px] aspect-square rounded-lg bg-white p-2 print:p-1 print:max-w-none"
      />

      <div className="mt-2 text-xs text-muted-foreground print:text-black/70 capitalize">
        {shape} · {capacity} seats
      </div>
      <div className="mt-1 text-[8px] text-muted-foreground/60 break-all print:text-black/40">
        {qrUrl}
      </div>
      <div className="mt-2 text-[10px] text-primary print:text-black/70 italic">
        Scan untuk buka / gabung meja
      </div>
    </Card>
  );
}
