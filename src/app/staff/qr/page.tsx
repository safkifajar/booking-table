import { redirect } from "next/navigation";
import Link from "next/link";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft } from "lucide-react";
import { QrPageActions } from "./QrPageActions";

export default async function StaffQrPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth?next=/staff/qr");

  const supabase = await createClient();
  const { data: staff } = await supabase
    .from("staff_roles")
    .select("bar_id, bars!inner(name, slug)")
    .eq("profile_id", profile.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!staff) redirect("/");

  const bar = Array.isArray(staff.bars) ? staff.bars[0] : staff.bars;

  // Fetch all active tables grouped by area
  const { data: areas } = await supabase
    .from("floor_areas")
    .select("id, name, slug")
    .eq("bar_id", staff.bar_id)
    .order("sort_order");

  const { data: tables } = await supabase
    .from("tables")
    .select("id, label, capacity, shape, area_id")
    .in("area_id", (areas ?? []).map((a) => a.id))
    .eq("is_active", true)
    .order("label");

  // Base URL for QR — di production ambil dari env, di dev pakai window.location.
  // Untuk SSR sederhana, kita pakai header host.
  const { headers } = await import("next/headers");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  // Generate QR data URL (PNG base64) untuk tiap meja
  const tablesWithQr = await Promise.all(
    (tables ?? []).map(async (t) => {
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

  // Group by area
  const grouped = (areas ?? []).map((area) => ({
    area,
    tables: tablesWithQr.filter((t) => t.area_id === area.id),
  }));

  return (
    <main className="flex-1 pb-12 bg-background print:bg-white print:text-black">
      {/* Header — hidden on print */}
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-md print:hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <Button asChild variant="ghost" size="icon">
            <Link href="/staff" aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-widest text-primary/70">
              QR Code Generator
            </div>
            <h1 className="text-base sm:text-lg font-semibold truncate">{bar.name}</h1>
          </div>
          <QrPageActions />
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 print:py-0 print:px-0 print:max-w-none">
        {/* Intro — hidden on print */}
        <Card className="p-5 mb-6 bg-primary/5 border-primary/30 print:hidden">
          <h2 className="text-sm font-semibold mb-1">Cara pakai</h2>
          <p className="text-xs text-muted-foreground">
            Print halaman ini, lalu tempel QR code di meja masing-masing (laminating
            disarankan). Customer scan QR → otomatis ke meja yang benar, baik buka meja
            kosong, gabung ke meja yang lagi open, atau lihat status meja.
          </p>
        </Card>

        {/* Per area */}
        <div className="space-y-8 print:space-y-0">
          {grouped.map(({ area, tables }) => (
            <section key={area.id} className="print:break-before-page first:print:break-before-auto">
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
      {/* Branded header for print */}
      <div className="text-[10px] uppercase tracking-widest text-primary/70 mb-1 print:text-black/60">
        {barName}
      </div>
      <Badge variant="default" className="text-lg font-bold py-1 px-3 mb-2 print:bg-transparent print:text-black print:border print:border-black">
        {label}
      </Badge>

      {/* QR Image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrImage}
        alt={`QR for ${label}`}
        className="w-full max-w-[200px] aspect-square rounded-lg bg-white p-2 print:p-1 print:max-w-none"
      />

      {/* Info */}
      <div className="mt-2 text-xs text-muted-foreground print:text-black/70 capitalize">
        {shape} · {capacity} seats
      </div>

      {/* URL for fallback (small print) */}
      <div className="mt-1 text-[8px] text-muted-foreground/60 break-all print:text-black/40">
        {qrUrl}
      </div>

      {/* Tagline for print */}
      <div className="mt-2 text-[10px] text-primary print:text-black/70 italic">
        Scan untuk buka / gabung meja
      </div>
    </Card>
  );
}
