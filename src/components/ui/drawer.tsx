"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const Drawer = DialogPrimitive.Root;
const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-radix-drawer-overlay=""
    className={cn(
      // Tipis & no-blur supaya halaman belakang tetap kelihatan jelas
      "fixed inset-0 z-50 bg-black/25",
      className
    )}
    {...props}
  />
));
DrawerOverlay.displayName = "DrawerOverlay";

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideClose?: boolean;
    /** Lebar drawer di desktop. Default: max-w-2xl */
    sizeClass?: string;
  }
>(({ className, children, hideClose, sizeClass = "max-w-2xl", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DrawerOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-drawer-content=""
      className={cn(
        "fixed right-0 top-0 bottom-0 z-50 w-full bg-card border-l border-border shadow-2xl",
        "flex flex-col overflow-hidden",
        sizeClass,
        className
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close
          className="absolute right-4 top-4 z-10 rounded-md p-1 opacity-70 transition hover:opacity-100 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DrawerContent.displayName = "DrawerContent";

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "shrink-0 px-6 py-5 border-b border-border",
      className
    )}
    {...props}
  />
);
DrawerHeader.displayName = "DrawerHeader";

const DrawerBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex-1 overflow-y-auto px-6 py-5", className)}
    {...props}
  />
);
DrawerBody.displayName = "DrawerBody";

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "shrink-0 px-6 py-4 border-t border-border bg-card/80",
      "flex items-center justify-end gap-2",
      className
    )}
    {...props}
  />
);
DrawerFooter.displayName = "DrawerFooter";

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-tight tracking-tight",
      className
    )}
    {...props}
  />
));
DrawerTitle.displayName = "DrawerTitle";

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DrawerDescription.displayName = "DrawerDescription";

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerBody,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
