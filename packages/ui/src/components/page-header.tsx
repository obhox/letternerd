import type { ReactNode } from "react";
import { cn } from "../cn";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Primary and secondary actions, right-aligned and vertically centred. */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3 pb-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {/* Every screen renders exactly one of these, so it owns the h1 and
              the page's document outline starts where a reader expects. */}
          <h1 className="truncate text-lg leading-tight font-semibold text-[var(--color-ink)]">
            {title}
          </h1>
          {description !== undefined && description !== null && (
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{description}</p>
          )}
        </div>
        {actions !== undefined && actions !== null && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </header>
  );
}
