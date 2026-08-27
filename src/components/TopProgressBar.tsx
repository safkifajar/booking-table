"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Lightweight top progress bar — gold gradient bar, ~3px height.
 *
 * Triggers:
 * - Route change (detected via usePathname / useSearchParams)
 * - Manual: call `window.dispatchEvent(new Event("progress:start"))` and
 *   `window.dispatchEvent(new Event("progress:done"))` for Server Actions
 *   that don't change the URL.
 */
/**
 * Cari <a> terdekat ke ATAS dari elemen yang diklik.
 *
 * Ditulis manual, tidak memakai Element.closest(): di WebKit (Safari &
 * Chrome iOS, yang memakai mesin yang sama) closest() pada pohon DOM yang
 * dalam bisa melempar "Maximum call stack size exceeded" — galatnya muncul
 * dari dalam mesin browser sehingga stack-nya menunjuk `undefined` dan tak
 * bisa ditelusuri. Perulangan di bawah berjalan datar dan dibatasi
 * kedalamannya, jadi tak bisa menghabiskan stack.
 */
const MAX_DEPTH = 25;

function findAnchor(el: HTMLElement | null): HTMLAnchorElement | null {
  let node: HTMLElement | null = el;
  for (let i = 0; node && i < MAX_DEPTH; i++) {
    if (node.tagName === "A") return node as HTMLAnchorElement;
    node = node.parentElement;
  }
  return null;
}

export function TopProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const tickRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = React.useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (doneRef.current) clearTimeout(doneRef.current);
    setVisible(true);
    setProgress(15);

    tickRef.current = setInterval(() => {
      setProgress((p) => {
        if (p >= 85) return p;
        return p + Math.max(0.5, (90 - p) * 0.06);
      });
    }, 120);
  }, []);

  const done = React.useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setProgress(100);
    doneRef.current = setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 280);
  }, []);

  // Manual events (Server Action redirects, fetch, etc.)
  React.useEffect(() => {
    const onStart = () => start();
    const onDone = () => done();
    window.addEventListener("progress:start", onStart);
    window.addEventListener("progress:done", onDone);
    return () => {
      window.removeEventListener("progress:start", onStart);
      window.removeEventListener("progress:done", onDone);
    };
  }, [start, done]);

  // Intercept anchor clicks to fire start (Next Link goes through anchor too)
  React.useEffect(() => {
    function onClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      const anchor = findAnchor(target);
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      if (anchor.target === "_blank") return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      // Same path → no navigation, skip
      try {
        const url = new URL(href, window.location.origin);
        if (
          url.pathname === window.location.pathname &&
          url.search === window.location.search
        ) {
          return;
        }
      } catch {
        return;
      }
      start();
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [start]);

  // Form submissions (Server Actions)
  React.useEffect(() => {
    function onSubmit() {
      start();
    }
    document.addEventListener("submit", onSubmit);
    return () => document.removeEventListener("submit", onSubmit);
  }, [start]);

  // Done when path/search changes
  React.useEffect(() => {
    done();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      if (doneRef.current) clearTimeout(doneRef.current);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        zIndex: 9999,
        pointerEvents: "none",
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease-out",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${progress}%`,
          background:
            "linear-gradient(90deg, #ff4d57 0%, #e11d2a 50%, #b3141f 100%)",
          boxShadow: "0 0 10px rgba(225, 29, 42, 0.6)",
          transition: "width 200ms ease-out",
        }}
      />
    </div>
  );
}
