"use client";

import { useEffect, useState } from "react";

/**
 * Locale-aware formatting that survives hydration.
 *
 * `toLocaleDateString()` and `toLocaleString()` resolve against the *host's*
 * locale and timezone. Rendered on the server they produce Node's answer —
 * "Sep 2, 2026", UTC — and the browser then produces the reader's — "2 Sept
 * 2026", their zone. React sees different text, and in 19 it does not patch it
 * up: it discards the server HTML for that root and re-renders the whole thing
 * on the client, logging a hydration error each time. The page still works, so
 * it looks cosmetic; what it actually costs is the server render.
 *
 * `suppressHydrationWarning` is not the fix. It silences the message and keeps
 * whatever the server produced, which freezes Node's locale and timezone into
 * the page for every reader — the opposite of what a locale-aware format is
 * for.
 *
 * So: render something stable and correct on the server, then upgrade to the
 * reader's own formatting once mounted. The first paint is an ISO date, which
 * is unambiguous in every locale; the second is theirs. Both are wrapped in
 * `<time dateTime>` so the machine-readable value never depends on either.
 */

function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  // Deliberately after paint: reading it during render would put us back where
  // we started, with the server and client disagreeing on the first output.
  useEffect(() => setMounted(true), []);
  return mounted;
}

export interface FormattedDateProps {
  iso: string | Date | null | undefined;
  /** Include the time. Off by default: most tables only need the day. */
  withTime?: boolean;
  /** Shown when there is no date, rather than an empty cell. */
  fallback?: string;
  className?: string;
}

export function FormattedDate({
  iso,
  withTime = false,
  fallback = "—",
  className,
}: FormattedDateProps) {
  const mounted = useMounted();
  if (!iso) return <span className={className}>{fallback}</span>;

  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return <span className={className}>{fallback}</span>;

  const machine = date.toISOString();
  const stable = machine.slice(0, withTime ? 16 : 10).replace("T", " ");

  const text = mounted
    ? date.toLocaleString(undefined, {
        dateStyle: "medium",
        ...(withTime ? { timeStyle: "short" as const } : {}),
      })
    : stable;

  return (
    <time dateTime={machine} title={machine} className={className}>
      {text}
    </time>
  );
}

/**
 * Digit grouping is locale-dependent too — 1,234 against 1.234 — so a
 * server-rendered `toLocaleString()` on a number mismatches for exactly the
 * same reason. The stable form groups with a plain comma, which is what Node
 * would have produced anyway for the common case.
 */
export function FormattedNumber({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const mounted = useMounted();
  const stable = value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return <span className={className}>{mounted ? value.toLocaleString() : stable}</span>;
}
