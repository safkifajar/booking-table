"use client";

import * as React from "react";
import { BellRing, Loader2, X } from "lucide-react";
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

const DISMISS_KEY = "push-banner-dismissed";

/**
 * Hook bersama: register SW diam-diam + tentukan apakah perlu menawarkan
 * aktivasi push (didukung, izin belum granted/denied, belum subscribe).
 * Return { canOffer, enable, busy }.
 */
function usePushSetup() {
  const [canOffer, setCanOffer] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!pushSupported()) return;
      await registerServiceWorker();
      const perm = notificationPermission();
      const existing = await getExistingSubscription();
      if (!cancelled && perm !== "denied" && (perm !== "granted" || !existing)) {
        setCanOffer(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = React.useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const sub = await subscribePush();
      if (!sub) {
        toast.error("Izin notifikasi ditolak atau tidak didukung");
        if (notificationPermission() === "denied") setCanOffer(false);
        return false;
      }
      await saveSubscription(sub);
      toast.success("Notifikasi diaktifkan untuk perangkat ini");
      setCanOffer(false);
      return true;
    } catch (err) {
      toast.error(getActionErrorMessage(err, "Gagal aktifkan notifikasi"));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { canOffer, enable, busy };
}

/**
 * Tombol "Aktifkan notifikasi" di header. Tampil kalau push bisa ditawarkan.
 */
export function PushSetup() {
  const { canOffer, enable, busy } = usePushSetup();
  if (!canOffer) return null;
  return (
    <button
      type="button"
      onClick={() => void enable()}
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

/**
 * Soft-banner proaktif: muncul saat user pertama akses (kalau push bisa
 * ditawarkan & belum di-dismiss sesi ini). [Aktifkan] → prompt izin.
 * [Nanti] → sembunyikan (sessionStorage, muncul lagi sesi berikutnya).
 * BUKAN auto-prompt browser (yg anti-pattern) — prompt cuma setelah klik.
 */
export function PushBanner() {
  const { canOffer, enable, busy } = usePushSetup();
  // Lazy init dari sessionStorage (sekali saat mount, hindari setState-in-effect).
  const [dismissed, setDismissed] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  if (!canOffer || dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  return (
    <div className="mx-4 sm:mx-6 mt-3 rounded-xl border border-primary/30 bg-primary/[0.07] p-3 flex items-center gap-3">
      <BellRing className="h-5 w-5 text-primary shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Aktifkan notifikasi</p>
        <p className="text-xs text-muted-foreground">
          Biar gak ketinggalan undangan meja & update penting.
        </p>
      </div>
      <button
        type="button"
        onClick={async () => {
          const ok = await enable();
          if (ok) dismiss();
        }}
        disabled={busy}
        className="h-8 px-3 rounded-full bg-primary text-primary-foreground text-xs font-medium flex items-center gap-1.5 disabled:opacity-50 shrink-0"
      >
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Aktifkan
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Nanti"
        className="text-muted-foreground hover:text-foreground shrink-0"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
