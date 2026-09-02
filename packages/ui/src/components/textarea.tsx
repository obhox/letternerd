"use client";

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export type TextareaProps = ComponentPropsWithoutRef<"textarea">;

/** Same boundary and same type size as `Input`; see the note there on `--grey-5`. */
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "ui-focus-ring ui-scroll min-h-20 w-full rounded-md border border-[var(--grey-5)] bg-[var(--color-surface)] px-2.5 py-1.5 text-base leading-relaxed text-[var(--color-ink)] transition-colors",
        "placeholder:text-[var(--color-ink-muted)]",
        "disabled:cursor-not-allowed disabled:bg-[var(--color-muted)] disabled:opacity-70",
        "aria-[invalid=true]:border-2 aria-[invalid=true]:border-[var(--color-danger)]",
        className,
      )}
      {...props}
    />
  );
}
