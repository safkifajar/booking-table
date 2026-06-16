"use client";

import * as React from "react";
import { BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  pushSupported,
  registerServiceWorker,
  getExistingSubscription,
  subscribePush,
  notificationPermission,
} from "@/lib/push-client";
import { saveSubscription } from "@/lib/push";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * Tombol "Aktifkan notifikasi" — register SW diam-diam saat mount, lalu tampil
 * tombol HANYA kalau push didukung & belum aktif (permission default + belum
 * subscribe). Klik → minta izin → subscribe → simpan ke server.
 *
 * Disembunyikan kalau: tidak didukung, sudah granted+subscribed, atau denied.
 */
export function PushSetup() {
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) return;
      await registerServiceWorker();
      const perm = notificationPermission();
      const existing = await getExistingSubscription();
      // Tampilkan tombol kalau belum granted ATAU belum punya subscription.
      if (!cancelled && perm !== "denied" && (perm !== "granted" || !existing)) {
        setShow(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleEnable() {
    setBusy(true);
    try {
      const sub = await subscribePush();
      if (!sub) {
        toast.error("Izin notifikasi ditolak atau tidak didukung");
        // Kalau ditolak permanen, sembunyikan tombol.
        if (notificationPermission() === "denied") setShow(false);
        return;
      }
      await saveSubscription(sub);
      toast.success("Notifikasi diaktifkan untuk perangkat ini");
      setShow(false);
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal aktifkan notifikasi"));
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  return (
    <button
      type="button"
      onClick={handleEnable}
      disabled={busy}
      className="h-9 px-3 rounded-full flex items-center gap-1.5 text-xs font-medium border border-primary/40 text-primary hover:bg-primary/10 transition disabled:opacity-50"
      aria-label="Aktifkan notifikasi"
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <BellRing className="h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">Aktifkan notifikasi</span>
    </button>
  );
}
