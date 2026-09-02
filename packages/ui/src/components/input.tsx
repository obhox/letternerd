"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export type InputProps = ComponentPropsWithoutRef<"input">;

export function Input({ className, type, ...props }: InputProps) {
  return (
    <input
      type={type ?? "text"}
      className={cn(
        "ui-focus-ring h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink)] transition-colors",
        "placeholder:text-[var(--color-ink-muted)]",
        "disabled:cursor-not-allowed disabled:bg-[var(--color-muted)] disabled:opacity-70",
        // Field owns the error styling, but a bare Input used outside one
        // should still show its invalid state rather than looking healthy.
        "aria-[invalid=true]:border-[var(--color-danger)]",
        "file:mr-2 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--color-ink)]",
        className,
      )}
      {...props}
    />
  );
}
