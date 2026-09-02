import type { ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

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
  return <div className={cn("flex flex-col gap-1 px-4 pt-3 pb-2", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentPropsWithoutRef<"h3">) {
  return <h3 className={cn("text-sm leading-tight font-semibold", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentPropsWithoutRef<"p">) {
  return <p className={cn("text-sm text-[var(--color-ink-muted)]", className)} {...props} />;
}

export function CardContent({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("px-4 py-2", className)} {...props} />;
}

export function CardFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 border-t border-[var(--color-border)] px-4 py-2",
        className,
      )}
      {...props}
    />
  );
}
