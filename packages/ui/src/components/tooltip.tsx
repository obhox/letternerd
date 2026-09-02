"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export type TooltipContentProps = ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>;

/**
 * Tooltips here are hints, never the only place a label exists.
 *
 * They do not appear on touch and are easy to miss, so an icon-only control
 * still carries its own `aria-label` (see `Button`) and the tooltip merely
 * repeats it for sighted mouse users.
 */
export function TooltipContent({ className, sideOffset = 6, ...props }: TooltipContentProps) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink)] shadow-md",
          "data-[state=delayed-open]:animate-[ui-fade-in_100ms_ease-out]",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
