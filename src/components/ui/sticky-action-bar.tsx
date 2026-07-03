import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Bar aksi sticky di bawah layar (ala onboarding) — kontainer fixed bottom
 * dengan blur + border atas. Isi biasanya satu tombol gold full-width pill.
 *
 * Contoh:
 *   <StickyActionBar>
 *     <Button variant="gold" size="lg" className="w-full rounded-full h-14">
 *       Save
 *     </Button>
 *   </StickyActionBar>
 *
 * `maxWidth` menyamakan lebar konten dgn container halaman (default max-w-2xl).
 * Beri `pb-24` pada konten halaman supaya tak tertutup bar ini.
 */
export function StickyActionBar({
  children,
  className,
  maxWidth = "max-w-2xl",
}: {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur-md">
      <div
        className={cn(
          "mx-auto px-4 sm:px-6 py-3",
          maxWidth,
          className
        )}
      >
        {children}
      </div>
    </div>
  );
}
