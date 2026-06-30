import { MapPin } from "lucide-react";
import type { UserTableHistoryEntry, SessionVisibility } from "@/types/db";

function visibilityLabel(v: SessionVisibility): string {
  if (v === "public") return "Public";
  if (v === "friends") return "Friends";
  return "Invite-only";
}

const STATUS_LABEL: Record<UserTableHistoryEntry["status"], string> = {
  closed: "Done",
  cancelled: "Cancelled",
  overdue: "Unpaid",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Daftar riwayat meja user (read-only, untuk profil publik). Tidak di-link ke
 * sesi (sesi sudah selesai & bisa privat). Cuma menampilkan jejak nongkrong.
 */
export function TableHistoryList({
  entries,
}: {
  entries: UserTableHistoryEntry[];
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No hangout history yet.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {entries.map((e) => (
        <div
          key={e.session_id}
          className="flex items-center gap-3 rounded-lg border border-border bg-card/40 p-3"
        >
          <div className="h-9 w-9 rounded-md bg-muted/60 flex items-center justify-center shrink-0">
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              Table {e.table_label}
              <span className="font-normal text-muted-foreground">
                {" "}
                · {e.area_name}
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDate(e.started_at)} · {visibilityLabel(e.visibility)}
              {e.is_host && " · host"}
            </p>
          </div>
          <span className="shrink-0 text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
            {STATUS_LABEL[e.status]}
          </span>
        </div>
      ))}
    </div>
  );
}
