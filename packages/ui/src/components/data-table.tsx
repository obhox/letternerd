"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../cn";

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
  /**
   * Tighten rows from 44px to 32px.
   *
   * For screens where the job is comparing many rows at once rather than
   * reading any one of them — a redirect map, a revision list — and the extra
   * dozen rows on screen are worth more than the breathing room.
   */
  dense?: boolean;
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
 *
 * On the drawing: there is no zebra striping. Alternating fills fight with the
 * hover and focus states — the only two stripes that actually mean something —
 * and in a monotone system they are the same tool spent on nothing. Rows are
 * separated by height and a hairline instead, which leaves the muted fill free
 * to mean "you are pointing at this" and nothing else.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  onRowClick,
  empty,
  loading = false,
  loadingRows = 8,
  dense = false,
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
    // Only when the row itself has focus. Without this, Space inside a cell's
    // own button or text input would also fire the row.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    onRowClick(row);
  }

  const showEmpty = !loading && rows.length === 0;

  const cellHeight = dense ? "h-8" : "h-11";
  const cellPad = dense ? "px-2.5" : "px-3";

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
                  "sticky top-0 z-10 h-9 bg-[var(--color-surface)] whitespace-nowrap",
                  cellPad,
                  // Small, uppercase and tracked out: a header should read as a
                  // different kind of thing from the data, and at 12px that is
                  // cheaper to do with case and letter-spacing than with size.
                  "text-xs font-semibold tracking-[0.06em] text-[var(--color-ink-muted)] uppercase",
                  // A real border belongs to the cell box and scrolls away with
                  // it under `position: sticky`, leaving the header floating on
                  // the rows. An inset shadow is painted, so it stays put.
                  "shadow-[inset_0_-1px_0_var(--color-border)]",
                  // The first column is the one people read; give it the same
                  // gutter the rows below get.
                  "first:pl-4 last:pr-4",
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
                  <td key={column.key} className={cn(cellHeight, cellPad, "first:pl-4 last:pr-4")}>
                    <span
                      className="block h-3 animate-pulse rounded-sm bg-[var(--color-border)]"
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
                    cn(
                      "ui-focus-ring-inset cursor-pointer transition-colors",
                      // Hover and keyboard arrival get the *same* fill, so the
                      // two ways of pointing at a row look like one idea. The
                      // outline from `ui-focus-ring-inset` is what separates
                      // them, and it survives forced-colors mode where the fill
                      // does not.
                      "hover:bg-[var(--color-muted)] focus-visible:bg-[var(--color-muted)]",
                    ),
                )}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      cellHeight,
                      cellPad,
                      "align-middle text-[var(--color-ink-secondary)]",
                      "first:pl-4 last:pr-4",
                      // The first column is the row's name. It gets full ink
                      // and a heavier weight so a long list reads as a list of
                      // titles with detail attached, rather than as a grid of
                      // equally loud cells.
                      "first:font-medium first:text-[var(--color-ink)]",
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
                  <p className="px-4 py-12 text-center text-sm text-[var(--color-ink-muted)]">
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
