import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

/**
 * A panel on the canvas.
 *
 * One hairline and a surface fill, no shadow. The page background is already a
 * stop darker than the card, so the edge is doing confirmation rather than
 * separation — and a drop shadow under every panel on a dense screen is a lot
 * of grey spent on saying "this is a rectangle".
 */
export function Card({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col gap-0.5 px-4 pt-3.5 pb-2.5", className)} {...props} />;
}

/**
 * 15px, a step above the 13px body and a step below a section heading.
 *
 * A card title set at body size is not a title, it is the first line of the
 * card — which is exactly how the old 13px one read.
 */
export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<"h3">) {
  return (
    <h3
      className={cn(
        "text-md leading-tight font-semibold tracking-tight text-[var(--color-ink)]",
        className,
      )}
      {...props}
    />
  );
}

/** Sits under the title at 12px muted, so it reads as an aside to it. */
export function CardDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("text-xs text-[var(--color-ink-muted)]", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("px-4 py-3", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-2.5",
        className,
      )}
      {...props}
    />
  );
}
