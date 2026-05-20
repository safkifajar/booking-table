"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, LogOut, Trash2, Check } from "lucide-react";

type Variant = "default" | "danger" | "destructive" | "success";

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: Variant;
  icon?: React.ReactNode;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = React.createContext<ConfirmContextValue | null>(null);

/**
 * useConfirm — imperative replacement for window.confirm().
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Tutup meja?",
 *     description: "Pesanan akan dikunci dan bill diserahkan ke kasir.",
 *     confirmText: "Tutup",
 *     variant: "danger",
 *   });
 *   if (!ok) return;
 */
export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used inside <ConfirmProvider>");
  }
  return ctx.confirm;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null);

  const confirm = React.useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...opts, resolve });
    });
  }, []);

  function handle(result: boolean) {
    pending?.resolve(result);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) handle(false);
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <IconBadge variant={pending?.variant ?? "default"} icon={pending?.icon} />
              <div className="flex-1 min-w-0">
                <DialogTitle>{pending?.title ?? ""}</DialogTitle>
                {pending?.description && (
                  <DialogDescription className="mt-1">
                    {pending.description}
                  </DialogDescription>
                )}
              </div>
            </div>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handle(false)}
              className="sm:min-w-[100px]"
            >
              {pending?.cancelText ?? "Batal"}
            </Button>
            <Button
              variant={confirmButtonVariant(pending?.variant)}
              onClick={() => handle(true)}
              className="sm:min-w-[100px]"
              autoFocus
            >
              {pending?.confirmText ?? "Lanjut"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

function confirmButtonVariant(v?: Variant) {
  if (v === "danger" || v === "destructive") return "destructive" as const;
  if (v === "success") return "gold" as const;
  return "gold" as const;
}

function IconBadge({
  variant,
  icon,
}: {
  variant: Variant;
  icon?: React.ReactNode;
}) {
  let defaultIcon: React.ReactNode = <AlertTriangle className="h-5 w-5" />;
  let bg = "bg-primary/15 text-primary border-primary/30";

  if (variant === "danger") {
    defaultIcon = <LogOut className="h-5 w-5" />;
    bg = "bg-amber-500/15 text-amber-400 border-amber-500/30";
  } else if (variant === "destructive") {
    defaultIcon = <Trash2 className="h-5 w-5" />;
    bg = "bg-red-500/15 text-red-400 border-red-500/30";
  } else if (variant === "success") {
    defaultIcon = <Check className="h-5 w-5" />;
    bg = "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
  }

  return (
    <div
      className={`h-10 w-10 rounded-full border flex items-center justify-center shrink-0 ${bg}`}
    >
      {icon ?? defaultIcon}
    </div>
  );
}
