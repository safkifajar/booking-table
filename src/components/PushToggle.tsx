"use client";

import * as React from "react";
import { BellRing, BellOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  pushSupported,
  registerServiceWorker,
  getExistingSubscription,
  subscribePush,
  unsubscribePush,
  notificationPermission,
} from "@/lib/push-client";
import { saveSubscription, removeSubscription } from "@/lib/push";
import { getActionErrorMessage } from "@/lib/utils";

/**
 * Toggle aktif/nonaktif notifikasi push untuk perangkat ini. Dua arah:
 * - OFF→ON: minta izin browser + subscribe + simpan ke server.
 * - ON→OFF: unsubscribe dari browser + hapus subscription di server.
 *
 * "Aktif" = ada subscription tersimpan di perangkat ini & izin granted.
 * Kalau izin browser sudah "denied", toggle dikunci + arahkan ke setelan browser.
 */
export function PushToggle() {
  const [supported, setSupported] = React.useState(true);
  const [enabled, setEnabled] = React.useState(false);
  const [perm, setPerm] = React.useState<NotificationPermission | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) {
        if (!cancelled) {
          setSupported(false);
          setLoading(false);
        }
        return;
      }
      await registerServiceWorker();
      const existing = await getExistingSubscription();
      if (!cancelled) {
        setPerm(notificationPermission());
        setEnabled(!!existing);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function turnOn() {
    setBusy(true);
    try {
      const sub = await subscribePush();
      if (!sub) {
        setPerm(notificationPermission());
        toast.error("Izin notifikasi ditolak atau tidak didukung");
        return;
      }
      await saveSubscription(sub);
      setEnabled(true);
      setPerm("granted");
      toast.success("Notifikasi diaktifkan untuk perangkat ini");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal aktifkan notifikasi"));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const endpoint = await unsubscribePush();
      if (endpoint) await removeSubscription(endpoint);
      setEnabled(false);
      toast.success("Notifikasi dimatikan untuk perangkat ini");
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal matikan notifikasi"));
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <div className="flex items-center gap-3 px-4 py-3.5">
        <span className="h-8 w-8 rounded-md bg-muted border border-border flex items-center justify-center shrink-0 text-muted-foreground">
          <BellOff className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Notifikasi</p>
          <p className="text-xs text-muted-foreground">
            Perangkat/browser ini tidak mendukung notifikasi push.
          </p>
        </div>
      </div>
    );
  }

  const denied = perm === "denied";

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <span
        className={`h-8 w-8 rounded-md border flex items-center justify-center shrink-0 ${
          enabled
            ? "bg-primary/15 border-primary/30 text-primary"
            : "bg-muted border-border text-muted-foreground"
        }`}
      >
        {enabled ? (
          <BellRing className="h-4 w-4" />
        ) : (
          <BellOff className="h-4 w-4" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Notifikasi push</p>
        <p className="text-xs text-muted-foreground">
          {denied
            ? "Izin diblokir — aktifkan lewat setelan browser."
            : enabled
              ? "Aktif di perangkat ini (request pindah meja, dll)."
              : "Dapat notif walau aplikasi ditutup."}
        </p>
      </div>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          disabled={busy || denied}
          onClick={() => (enabled ? void turnOff() : void turnOn())}
          className={`relative inline-flex items-center h-6 w-11 rounded-full transition shrink-0 disabled:opacity-50 ${
            enabled ? "bg-primary" : "bg-muted-foreground/30"
          }`}
        >
          {busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mx-auto text-white" />
          ) : (
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                enabled ? "translate-x-[22px]" : "translate-x-0.5"
              }`}
            />
          )}
        </button>
      )}
    </div>
  );
}
