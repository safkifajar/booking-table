/**
 * Format & tipe reservation yang CLIENT-SAFE (tanpa "server-only").
 *
 * Dipisah dari reservation-helpers.ts supaya komponen "use client"
 * (mis. OpenTableForm) bisa pakai formatGroupLabel / tipe AvailableSlot
 * tanpa menyeret modul server-only ke client bundle.
 *
 * Semua di sini pure function — aman dipakai di server maupun client.
 */

export interface AvailableSlot {
  /** ISO string untuk submit ke server */
  iso: string;
  /** Display "Hari ini · 14:00" atau "Sabtu 14 Jun · 14:00" */
  label: string;
  /** Group date-only "today" | "tomorrow" | "YYYY-MM-DD" */
  groupKey: string;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

export const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function formatSlotLabel(date: Date, now: Date): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const time = `${hh}:${mm}`;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (isSameDay(date, now)) return `Today · ${time}`;
  if (isSameDay(date, tomorrow)) return `Tomorrow · ${time}`;

  const day = DAY_NAMES[date.getDay()];
  const dd = date.getDate();
  const month = MONTH_NAMES[date.getMonth()];
  return `${day} ${dd} ${month} · ${time}`;
}

export function formatGroupKey(date: Date, now: Date): string {
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(date, now)) return "today";
  if (isSameDay(date, tomorrow)) return "tomorrow";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatGroupLabel(groupKey: string): string {
  if (groupKey === "today") return "Today";
  if (groupKey === "tomorrow") return "Tomorrow";
  const [y, m, d] = groupKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = DAY_NAMES[date.getDay()];
  return `${day}, ${d} ${MONTH_NAMES[m - 1]}`;
}
