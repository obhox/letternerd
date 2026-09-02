"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn.js";

export type TextareaProps = ComponentPropsWithoutRef<"textarea">;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "ui-focus-ring ui-scroll min-h-20 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-sm text-[var(--color-ink)] transition-colors",
        "placeholder:text-[var(--color-ink-muted)]",
        "disabled:cursor-not-allowed disabled:bg-[var(--color-muted)] disabled:opacity-70",
        "aria-[invalid=true]:border-[var(--color-danger)]",
        className,
      )}
      {...props}
    />
  );
}
