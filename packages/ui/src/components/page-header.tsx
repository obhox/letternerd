import type { ReactNode } from "react";
import { cn } from "../cn";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Primary and secondary actions, aligned to the title's own line. */
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/**
 * The one heading on the page.
 *
 * At 22px with the tracking pulled in it reads as a title rather than as an
 * unusually confident paragraph — which is what an 18px semibold line looks
 * like once the body around it is 13px. In a monotone system the type scale is
 * carrying the whole hierarchy, so the top of it has to actually be at the top.
 *
 * The actions sit in a row of the same minimum height as the title's line box
 * and are centred within it, so a 32px button lines up with the title instead
 * of floating somewhere beside it. The description hangs below both, which is
 * where it belongs: it explains the page, not the buttons.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: PageHeaderProps) {
  const hasActions = actions !== undefined && actions !== null;

  return (
    <header className={cn("flex flex-col gap-4 pb-6", className)}>
      <div className="flex flex-col gap-1.5">
        <div className="flex min-w-0 items-center justify-between gap-4">
          {/* Every screen renders exactly one of these, so it owns the h1 and
              the page's document outline starts where a reader expects. */}
          <h1 className="min-h-8 min-w-0 flex-1 truncate text-xl leading-8 font-semibold tracking-tight text-[var(--color-ink)]">
            {title}
          </h1>
          {hasActions && (
            <div className="flex min-h-8 shrink-0 items-center gap-2">{actions}</div>
          )}
        </div>
        {description !== undefined && description !== null && (
          <p className="max-w-2xl text-sm text-[var(--color-ink-secondary)]">{description}</p>
        )}
      </div>
      {children}
    </header>
  );
}
