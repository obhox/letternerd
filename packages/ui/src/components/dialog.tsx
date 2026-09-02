"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export type DialogOverlayProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>;

export function DialogOverlay({ className, ...props }: DialogOverlayProps) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-[color-mix(in_oklch,var(--color-ink)_45%,transparent)]",
        "data-[state=open]:animate-[ui-fade-in_120ms_ease-out]",
        className,
      )}
      {...props}
    />
  );
}

export interface DialogContentProps
  extends ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  /**
   * Hide the built-in close button. Only for dialogs that must be resolved by
   * an explicit choice — Escape still closes unless the caller prevents it.
   */
  hideClose?: boolean;
}

export function DialogContent({ className, children, hideClose, ...props }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-[var(--color-ink)] shadow-xl",
          "data-[state=open]:animate-[ui-pop-in_120ms_ease-out]",
          className,
        )}
        {...props}
      >
        {children}
        {!hideClose && (
          <DialogPrimitive.Close
            aria-label="Close"
            className="ui-focus-ring absolute top-3 right-3 rounded-md p-1 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-muted)] hover:text-[var(--color-ink)]"
          >
            <XIcon className="size-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col gap-1 pr-8", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div className={cn("flex flex-row items-center justify-end gap-2", className)} {...props} />
  );
}

export type DialogTitleProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;

export function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <DialogPrimitive.Title
      className={cn("text-base leading-tight font-semibold", className)}
      {...props}
    />
  );
}

export type DialogDescriptionProps = ComponentPropsWithoutRef<typeof DialogPrimitive.Description>;

export function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <DialogPrimitive.Description
      className={cn("text-sm text-[var(--color-ink-muted)]", className)}
      {...props}
    />
  );
}
