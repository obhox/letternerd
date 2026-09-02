"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../cn.js";

export type DataTableAlign = "left" | "center" | "right";

export interface DataTableColumn<T> {
  /** Stable identity for React keys. Not required to be a field of `T`. */
  key: string;
  header: ReactNode;
  /** Any CSS length. Columns without one share the remaining space. */
  width?: string | number;
  align?: DataTableAlign;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: readonly T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Shown in place of the body when there are no rows and nothing is loading. */
  empty?: ReactNode;
  loading?: boolean;
  /** How many skeleton rows to draw. Match the usual page size to avoid a jump. */
  loadingRows?: number;
  /** Describes the table to assistive technology; visually hidden. */
  caption?: string;
  className?: string;
}

const ALIGN: Record<DataTableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * A presentational table. Sorting, filtering and pagination stay on the screen
 * that owns the data — this renders whatever order it is handed.
 *
 * That boundary is the point: the post list sorts on the server and the media
 * grid sorts in memory, and a table that owned sort state would force both to
 * fight it.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  empty,
  loading = false,
  loadingRows = 8,
  caption,
  className,
}: DataTableProps<T>) {
  const clickable = onRowClick !== undefined;

  // Rows are not buttons: wrapping a whole <tr> in a role would strip the
  // table semantics that make a long list navigable in the first place. So the
  // row stays a row, gains a tab stop, and answers Enter/Space the way an
  // activatable thing should. Screens should also put a real link or button in
  // one cell, so the row click is a shortcut rather than the only route.
  function handleKeyDown(event: KeyboardEvent<HTMLTableRowElement>, row: T): void {
    if (!onRowClick) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onRowClick(row);
  }

  const showEmpty = !loading && rows.length === 0;

  return (
    <div
      className={cn(
        "ui-scroll relative overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <table className="w-full border-collapse text-sm">
        {caption !== undefined && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width === undefined ? undefined : { width: column.width }}
                className={cn(
                  // Sticky against the scroll container above, with an opaque
                  // background so rows do not show through as they pass under.
                  "sticky top-0 z-10 bg-[var(--color-muted)] px-3 py-2 text-xs font-medium whitespace-nowrap text-[var(--color-ink-muted)]",
                  // A real border would scroll away with the cell box, so the
                  // rule under the header is drawn as a shadow instead.
                  "shadow-[inset_0_-1px_0_var(--color-border)]",
                  ALIGN[column.align ?? "left"],
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: loadingRows }, (_, index) => (
              <tr key={`skeleton-${index}`} className="border-b border-[var(--color-border)]">
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-2">
                    <span
                      className="block h-3.5 animate-pulse rounded bg-[var(--color-muted)]"
                      // Varied widths so a loading table reads as text arriving
                      // rather than as a rendering glitch.
                      style={{ width: `${55 + ((index * 7 + column.key.length * 5) % 35)}%` }}
                    />
                  </td>
                ))}
              </tr>
            ))}

          {!loading &&
            rows.map((row) => (
              <tr
                key={getRowKey(row)}
                {...(clickable
                  ? {
                      tabIndex: 0,
                      onClick: () => onRowClick(row),
                      onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) =>
                        handleKeyDown(event, row),
                    }
                  : {})}
                className={cn(
                  "border-b border-[var(--color-border)] last:border-b-0",
                  clickable &&
                    "ui-focus-ring-inset cursor-pointer transition-colors hover:bg-[var(--color-muted)]",
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-3 py-2 align-middle text-[var(--color-ink)]",
                      ALIGN[column.align ?? "left"],
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}

          {showEmpty && (
            <tr>
              <td colSpan={Math.max(columns.length, 1)} className="p-0">
                {empty ?? (
                  <p className="px-3 py-10 text-center text-sm text-[var(--color-ink-muted)]">
                    Nothing here yet.
                  </p>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
