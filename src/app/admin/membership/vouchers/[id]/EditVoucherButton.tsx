"use client";

import * as React from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AdminVoucherRow } from "@/lib/membership-actions";
import { VoucherDialog } from "../VoucherDialog";

/** Tombol edit aturan template di halaman detail — buka dialog bersama. */
export function EditVoucherButton({
  voucher,
  levelNames,
}: {
  voucher: AdminVoucherRow;
  levelNames: Record<string, string>;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="h-4 w-4" /> Edit rules
      </Button>
      {open && (
        <VoucherDialog
          target={{ mode: "edit", voucher }}
          levelNames={levelNames}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
