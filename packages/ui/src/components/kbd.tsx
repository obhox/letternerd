import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn.js";

export type KbdProps = ComponentPropsWithoutRef<"kbd">;

/** A keyboard key, for shortcut hints in menus, tooltips and empty states. */
export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-[var(--color-border)] bg-[var(--color-muted)] px-1 font-[family-name:var(--font-mono)] text-[0.6875rem] leading-none font-medium text-[var(--color-ink-muted)]",
        className,
      )}
      {...props}
    />
  );
}
