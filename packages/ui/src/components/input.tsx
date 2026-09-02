"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export type InputProps = ComponentPropsWithoutRef<"input">;

/**
 * The border is `--grey-5`, not `--color-border-strong`.
 *
 * A form control has to be *findable* — WCAG 1.4.11 asks for 3:1 on the
 * boundary that identifies it. On this ramp `--color-border-strong` measures
 * 2.04:1 on the light surface and 1.46:1 on the dark one, so a hairline input
 * would be a control you have to hunt for in both themes. `--grey-5` is the
 * one stop that clears 3:1 against both ends of the ramp (3.85:1 light,
 * 5.14:1 dark) — the mid-tone is the only value that survives inversion — so
 * every control boundary in this library is drawn with it.
 */
export function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type ?? "text"}
      className={cn(
        "ui-focus-ring h-8 w-full rounded-md border border-[var(--grey-5)] bg-[var(--color-surface)] px-2.5 text-base text-[var(--color-ink)] transition-colors",
        "placeholder:text-[var(--color-ink-muted)]",
        "disabled:cursor-not-allowed disabled:bg-[var(--color-muted)] disabled:opacity-70",
        // Field owns the error styling, but a bare Input used outside one
        // should still show its invalid state rather than looking healthy.
        // Doubling the border weight is the monotone equivalent of turning it
        // red: the field gets heavier, not warmer.
        "aria-[invalid=true]:border-2 aria-[invalid=true]:border-[var(--color-danger)]",
        "file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--color-ink)]",
        className,
      )}
      {...props}
    />
  );
}
