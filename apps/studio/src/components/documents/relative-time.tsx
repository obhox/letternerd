"use client";

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const STEPS: Array<{ unit: Intl.RelativeTimeFormatUnit; ms: number }> = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
];

function relative(date: Date): string {
  const delta = date.getTime() - Date.now();
  const magnitude = Math.abs(delta);
  if (magnitude < 45 * 1000) return "just now";

  for (const step of STEPS) {
    if (magnitude >= step.ms) {
      return RELATIVE.format(Math.round(delta / step.ms), step.unit);
    }
  }
  return RELATIVE.format(Math.round(delta / 1000), "second");
}

export interface RelativeTimeProps {
  value: Date | string | null | undefined;
  className?: string;
  /** Rendered when there is no timestamp at all. */
  fallback?: string;
}

/**
 * A timestamp shown the way people scan lists — "3 days ago" — with the exact
 * moment on the element's `title` and in `dateTime`.
 *
 * Relative wording is the useful form for "is this stale?", but it is also the
 * form that loses an audit trail, so the absolute value is always one hover or
 * one accessibility-tree read away rather than gone.
 *
 * Hydration warnings are suppressed deliberately: the server renders against
 * its own clock and locale and the browser re-renders against the reader's, so
 * a wording or timezone difference here is the component working, not a bug.
 */
export function RelativeTime({ value, className, fallback = "—" }: RelativeTimeProps) {
  if (value === null || value === undefined) {
    return <span className={className}>{fallback}</span>;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <span className={className}>{fallback}</span>;
  }

  return (
    <time
      dateTime={date.toISOString()}
      title={date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
      className={className}
      suppressHydrationWarning
    >
      {relative(date)}
    </time>
  );
}
