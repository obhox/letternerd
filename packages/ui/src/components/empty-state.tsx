import type { ComponentType, ReactNode } from "react";
import { cn } from "../cn.js";

export interface EmptyStateProps {
  /** A lucide icon component, e.g. `FileTextIcon`. Rendered decoratively. */
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: ReactNode;
  description?: ReactNode;
  /** Usually the same primary button the page header offers. */
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--color-border)] px-6 py-12 text-center",
        className,
      )}
    >
      {Icon && (
        // Decorative: the heading below already says what is missing, and a
        // second announcement of "file icon" adds nothing.
        <Icon className="size-6 text-[var(--color-ink-muted)]" aria-hidden="true" />
      )}
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      {description !== undefined && description !== null && (
        <p className="max-w-sm text-sm text-[var(--color-ink-muted)]">{description}</p>
      )}
      {action !== undefined && action !== null && <div className="mt-2">{action}</div>}
    </div>
  );
}
