"use client";

import * as React from "react";
import { formatRelativeTime } from "@/lib/utils";

/**
 * Renders relative time ("5 mnt yang lalu") only on client to avoid
 * hydration mismatch (server clock vs client clock).
 *
 * Optionally updates every `intervalMs` ms (default 60s).
 */
export function RelativeTime({
  date,
  intervalMs = 60_000,
  className,
}: {
  date: string | Date;
  intervalMs?: number;
  className?: string;
}) {
  const [text, setText] = React.useState<string>("");

  React.useEffect(() => {
    setText(formatRelativeTime(date));
    const id = setInterval(() => setText(formatRelativeTime(date)), intervalMs);
    return () => clearInterval(id);
  }, [date, intervalMs]);

  return <span className={className} suppressHydrationWarning>{text || "—"}</span>;
}
