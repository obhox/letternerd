import type { ReactNode } from "react";

/**
 * One numbered step.
 *
 * A `<section>` with an `<h2>`, in order, under the page's single `<h1>` — the
 * outline is the navigation for a page this long, and a heading level skipped
 * to get a size is a heading level a screen-reader user cannot skim past.
 *
 * The number is decorative and marked as such: "Step 3" read aloud before every
 * heading is noise, and the heading text already says what the step is.
 */
export function Step({
  number,
  title,
  id,
  children,
}: {
  number: number;
  title: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="border-t border-[var(--color-border)] pt-6 first:border-t-0 first:pt-0"
    >
      <div className="flex items-baseline gap-2.5">
        <span
          aria-hidden="true"
          className="font-mono text-xs text-[var(--color-ink-faint)] tabular-nums"
        >
          {String(number).padStart(2, "0")}
        </span>
        <h2
          id={`${id}-heading`}
          className="text-lg font-semibold tracking-tight text-[var(--color-ink)]"
        >
          {title}
        </h2>
      </div>
      <div className="mt-2 pl-0 sm:pl-[1.9rem]">{children}</div>
    </section>
  );
}

/** The one short paragraph a step is allowed. The code carries the rest. */
export function StepNote({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-2xl text-sm text-[var(--color-ink-secondary)]">{children}</p>
  );
}

/** A value pulled from this site's settings, shown inline in prose. */
export function Value({ children }: { children: ReactNode }) {
  return (
    <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-xs text-[var(--color-ink)]">
      {children}
    </code>
  );
}
