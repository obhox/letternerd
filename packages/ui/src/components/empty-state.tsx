import type { ComponentType, ReactNode } from "react";
import { cn } from "../cn";

export interface EmptyStateProps {
  /** A lucide icon component, e.g. `FileTextIcon`. Rendered decoratively. */
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  title: ReactNode;
  description?: ReactNode;
  /** Usually the same primary button the page header offers. */
  action?: ReactNode;
  /**
   * Draw a panel around it.
   *
   * Off by default, because the common case is sitting inside a table body or
   * a card that already has an edge, where a second border is a box in a box.
   * Turn it on for an empty state that stands alone on the canvas.
   */
  bordered?: boolean;
  className?: string;
}

/**
 * Nothing here — which is usually fine.
 *
 * The old drawing was a dashed rectangle, and a dashed rectangle means
 * "something is missing from here" or "drop a file". An empty list is neither:
 * it is the normal first state of every screen in a new site. So the panel is
 * solid when there is one at all, the icon is small and sits in a muted puck
 * rather than looming at the top, and the description is one quiet line under
 * a title that is the only thing with any weight. If there is something to do
 * about it, the action is the loudest element — as it should be, because it is
 * the only part of this component anybody is meant to act on.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  bordered = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        bordered &&
          "rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      {Icon && (
        // Decorative: the heading below already says what is missing, and a
        // second announcement of "file icon" adds nothing.
        <span
          aria-hidden="true"
          className="mb-3 flex size-9 items-center justify-center rounded-full bg-[var(--color-muted)]"
        >
          <Icon className="size-4 text-[var(--color-ink-muted)]" aria-hidden="true" />
        </span>
      )}
      <p className="text-sm font-medium text-[var(--color-ink)]">{title}</p>
      {description !== undefined && description !== null && (
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-[var(--color-ink-muted)]">
          {description}
        </p>
      )}
      {action !== undefined && action !== null && <div className="mt-4">{action}</div>}
    </div>
  );
}
