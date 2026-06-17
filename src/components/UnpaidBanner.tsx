import Link from "next/link";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { formatIDR } from "@/lib/utils";
import type { UnpaidSessionView } from "@/lib/queries";

/**
 * Banner "tagihan belum lunas" di landing. Server Component — data dari
 * getUnpaidSessionsForProfile. Tidak render apa pun kalau tidak ada tunggakan.
 * Klik → ke sesi terkait (1 tagihan) / ke riwayat (banyak).
 */
export function UnpaidBanner({ sessions }: { sessions: UnpaidSessionView[] }) {
  if (sessions.length === 0) return null;

  const total = sessions.reduce((s, x) => s + x.outstanding, 0);
  const single = sessions.length === 1 ? sessions[0] : null;
  const href = single ? `/session/${single.id}` : "/profile/sessions";

  return (
    <Link
      href={href}
      className="mx-4 sm:mx-6 mt-3 flex items-center gap-3 rounded-xl border border-orange-500/40 bg-orange-500/[0.08] p-3 transition hover:bg-orange-500/[0.12]"
    >
      <span className="h-9 w-9 rounded-lg bg-orange-500/15 border border-orange-500/30 flex items-center justify-center shrink-0 text-orange-400">
        <AlertTriangle className="h-4 w-4" />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-orange-300">
          {single
            ? `Tagihan belum lunas di meja ${single.table_label}`
            : `${sessions.length} tagihan belum lunas`}
        </p>
        <p className="text-xs text-muted-foreground">
          Total sisa {formatIDR(total)} · ketuk untuk lunasi
        </p>
      </div>
      <ChevronRight className="h-4 w-4 text-orange-400/70 shrink-0" />
    </Link>
  );
}
