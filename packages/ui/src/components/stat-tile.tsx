import type { ComponentType, ReactNode } from "react";
import { cn } from "../cn";

export type StatTileSize = "md" | "lg";

export interface StatTileProps {
  /** What the figure counts. Set small, uppercase and tracked out. */
  label: ReactNode;
  /** The figure itself. Numbers are rendered with tabular figures. */
  value: ReactNode;
  /** One line under the figure: a caveat, a delta, a period. */
  hint?: ReactNode;
  /** A lucide icon, rendered decoratively beside the label. */
  icon?: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  /** `lg` is 36px, for the one number on a screen that matters most. */
  size?: StatTileSize;
  /** Anything trailing the figure — a badge, a link. */
  children?: ReactNode;
  /** Drop the panel, for a tile inside a card that already has an edge. */
  bare?: boolean;
  className?: string;
}

/**
 * A label, a number, and optionally a line about the number.
 *
 * The whole component is a hierarchy argument: the figure is three steps up
 * the scale from its own label, which is what makes a dashboard scannable when
 * every tile is the same grey. Pulling the tracking in at 28px and 36px is
 * most of what stops large type looking merely enlarged.
 *
 * The figure is set in tabular figures deliberately. A count that ticks from
 * 9 to 10 must not shift the tile beside it, and a column of tiles whose
 * digits do not line up reads as sloppy long before anyone works out why.
 */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  size = "md",
  children,
  bare = false,
  className,
}: StatTileProps) {
  return (
    <div
      className={cn(
        "flex flex-col",
        bare
          ? "gap-0"
          : "gap-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5",
        className,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-2xs font-semibold tracking-[0.06em] text-[var(--color-ink-muted)] uppercase">
          {label}
        </span>
        {Icon && (
          <Icon className="size-3.5 text-[var(--color-ink-muted)]" aria-hidden="true" />
        )}
      </div>

      <p
        className={cn(
          "mt-1.5 font-semibold tabular-nums text-[var(--color-ink)]",
          size === "lg" ? "text-3xl tracking-tighter" : "text-2xl tracking-tight",
        )}
      >
        {value}
      </p>

      {hint !== undefined && hint !== null && (
        <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{hint}</p>
      )}

      {children !== undefined && children !== null && <div className="mt-2.5">{children}</div>}
    </div>
  );
}
