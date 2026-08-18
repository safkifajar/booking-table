/**
 * Util client-side untuk Web Push: register service worker + subscribe.
 * Dipakai komponen PushSetup. Bukan server action (jalan di browser).
 */

import * as Sentry from "@sentry/nextjs";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** Convert VAPID public key (base64url) → Uint8Array (applicationServerKey). */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    // Service Worker & Push API HANYA tersedia di secure context (HTTPS atau
    // localhost). Lewat LAN IP via HTTP (mis. 192.168.x.x) tidak — tanpa cek ini
    // toggle bisa menggantung di "loading". isSecureContext = true utk localhost.
    window.isSecureContext === true &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    VAPID_PUBLIC.length > 0
  );
}

/** Register /sw.js (diam-diam, idempotent). Return registration. */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

/** Apakah device ini sudah punya push subscription aktif? */
export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  // Jaring pengaman: serviceWorker.ready bisa menggantung kalau SW tak pernah
  // aktif. Race dgn timeout supaya UI tak stuck loading selamanya.
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/**
 * Minta izin + subscribe. Return PushSubscription (plain JSON) untuk dikirim
 * ke server, atau null kalau ditolak/gagal.
 */
export type PushSubscribeResult =
  | {
      ok: true;
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    }
  | { ok: false; reason: "unsupported" | "denied" | "service-error" };

export async function subscribePush(): Promise<PushSubscribeResult> {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "denied" };

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    }
    // Serialize ke plain object (PushSubscription tidak langsung serializable).
    const json = sub.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
      return { ok: false, reason: "service-error" };
    }
    return {
      ok: true,
      subscription: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      },
    };
  } catch (err) {
    // Izin SUDAH diberi, tapi layanan push browser (FCM/Mozilla) menolak —
    // mis. "Registration failed - push service error". Biasanya perangkat tak
    // bisa menjangkau server push: jaringan diblokir, jam sistem melenceng,
    // atau Google Play Services bermasalah. Pesan mentahnya tak berarti bagi
    // tamu, jadi dipetakan ke satu sebab yang bisa ditindaklanjuti — tapi
    // tetap dicatat agar kita bisa melihat kejadian nyatanya.
    reportPushFailure(err);
    return { ok: false, reason: "service-error" };
  }
}

/**
 * Pesan siap tampil untuk tiap sebab gagal — SATU sumber, dipakai semua
 * layar. Menyebut langkah yang bisa dicoba tamu; pesan mentah browser
 * ("Registration failed - push service error") tak berarti apa pun.
 */
export function pushFailureMessage(
  reason: "unsupported" | "denied" | "service-error"
): string {
  switch (reason) {
    case "denied":
      return "Notifications are blocked. Allow them in your browser settings, then try again.";
    case "unsupported":
      return "This browser can't receive notifications. Try Chrome, or install the app to your home screen.";
    case "service-error":
      return "Couldn't reach the notification service. Check your connection and try again.";
  }
}

/**
 * Catat kegagalan subscribe ke Sentry — diam-diam, tak mengganggu alur.
 *
 * Dikirim sebagai MESSAGE, bukan exception: galat layanan push bertipe
 * "AbortError", yang masuk daftar ignoreErrors di instrumentation-client
 * (di sana ia noise navigasi). Di sini ia justru sinyal yang kita cari,
 * jadi dikemas ulang supaya lolos filter itu.
 */
function reportPushFailure(err: unknown) {
  try {
    const detail =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    Sentry.captureMessage(`Push subscribe failed — ${detail}`, {
      level: "warning",
      tags: { area: "push-subscribe" },
      extra: { userAgent: navigator.userAgent },
    });
  } catch {
    /* jangan sampai pelaporan galat ikut menggagalkan alurnya */
  }
}

export function notificationPermission(): NotificationPermission | null {
  if (typeof window === "undefined" || !("Notification" in window)) return null;
  return Notification.permission;
}

/**
 * Unsubscribe push di device ini: browser pushManager.unsubscribe() +
 * hapus subscription di server. Return endpoint yg di-unsubscribe (atau null).
 * Catatan: ini TIDAK mencabut izin browser (cuma user di setting browser),
 * tapi tanpa subscription tidak ada push lagi.
 */
export async function unsubscribePush(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* ignore — tetap hapus di server */
  }
  return endpoint;
}
