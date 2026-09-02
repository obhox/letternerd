"use client";

import { useEffect, useState } from "react";
import { CopyIcon, ListTreeIcon } from "lucide-react";
import { Badge, Button, cn } from "@cms/ui";
import type { SourceHeading } from "./document-scan";
import type { EditorHeading } from "./types";

/**
 * The document's shape, and the ids it will be cited by.
 *
 * Two things are joined here that are usually kept apart. The rows come from
 * the *source*, so clicking one can scroll the editor to a line — the server's
 * rendered outline has no line numbers in it and never could. The anchors come
 * from the *render*, because the id under a heading is not a slug this screen
 * is free to guess: `renderForSite` reconciles it against the ids the document
 * has been published with before, so a reworded heading keeps its old anchor
 * and the links that already point at it keep resolving. Recomputing it in the
 * browser would produce a plausible id that is sometimes not the real one,
 * which is worse than showing none.
 *
 * Those anchors are the addresses answer engines and other people's articles
 * cite, so they are shown rather than hidden, and each one can be copied.
 */

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

interface Row extends SourceHeading {
  /** Null until a render comes back, or where the two lists cannot be paired. */
  id: string | null;
  aliases: string[];
}

/**
 * Pair each source heading with its rendered anchor, in order.
 *
 * The lists are not always the same length — a `### question` inside a
 * `:::faq` is a heading in the markdown and a classed paragraph in the output
 * — so this walks both and advances the rendered pointer only on a text match,
 * leaving the unmatched rows with a null id rather than borrowing their
 * neighbour's.
 */
function pair(source: readonly SourceHeading[], rendered: readonly EditorHeading[]): Row[] {
  let cursor = 0;
  return source.map((heading) => {
    const text = normalise(heading.text);
    let index = cursor;
    while (index < rendered.length && normalise(rendered[index]!.text) !== text) index += 1;

    if (index >= rendered.length) return { ...heading, id: null, aliases: [] };
    cursor = index + 1;
    const match = rendered[index]!;
    return { ...heading, id: match.id, aliases: match.aliases };
  });
}

function CopyAnchor({ anchor }: { anchor: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      size="icon"
      variant="ghost"
      className="size-6 shrink-0"
      aria-label={copied ? `Copied ${anchor}` : `Copy the anchor ${anchor}`}
      title={`Copy ${anchor}`}
      onClick={() => {
        void navigator.clipboard?.writeText(anchor).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
    >
      <CopyIcon
        aria-hidden="true"
        className={copied ? "text-[var(--color-ink)]" : "text-[var(--color-ink-muted)]"}
      />
    </Button>
  );
}

export interface OutlinePanelProps {
  source: readonly SourceHeading[];
  rendered: readonly EditorHeading[];
  onGoToLine: (line: number) => void;
  className?: string;
}

export function OutlinePanel({ source, rendered, onGoToLine, className }: OutlinePanelProps) {
  const rows = pair(source, rendered);

  return (
    <section
      aria-label="Outline"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
        <ListTreeIcon className="size-3.5 text-[var(--color-ink-muted)]" aria-hidden="true" />
        <h2 className="text-sm font-medium">Outline</h2>
        <Badge variant="outline" className="ml-auto">
          {rows.length}
        </Badge>
      </header>

      {rows.length === 0 ? (
        <p className="px-3 py-3 text-xs text-[var(--color-ink-muted)]">
          No headings yet. Headings are what the outline, the anchors and the on-page navigation
          are all built from.
        </p>
      ) : (
        <ul className="ui-scroll max-h-80 overflow-auto py-1">
          {rows.map((row) => (
            <li key={`${row.line}-${row.id ?? row.text}`} className="flex items-start gap-1 px-1">
              <button
                type="button"
                onClick={() => onGoToLine(row.line)}
                title={`Go to line ${row.line}`}
                className="ui-focus-ring min-w-0 flex-1 rounded px-2 py-1 text-left hover:bg-[var(--color-muted)]"
                style={{ paddingLeft: `${0.5 + Math.max(0, row.depth - 1) * 0.6}rem` }}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="shrink-0 font-[family-name:var(--font-mono)] text-2xs text-[var(--color-ink-faint)]">
                    h{row.depth}
                  </span>
                  <span
                    className={cn(
                      "truncate text-xs",
                      row.depth <= 2
                        ? "font-medium text-[var(--color-ink)]"
                        : "text-[var(--color-ink-secondary)]",
                    )}
                  >
                    {row.text.length > 0 ? row.text : "Untitled heading"}
                  </span>
                </span>
                <span className="mt-0.5 block truncate font-[family-name:var(--font-mono)] text-2xs text-[var(--color-ink-muted)]">
                  {row.id === null ? "anchor pending the next render" : `#${row.id}`}
                  {row.aliases.length > 0 && ` · also ${row.aliases.map((a) => `#${a}`).join(", ")}`}
                </span>
              </button>
              {row.id !== null && <CopyAnchor anchor={`#${row.id}`} />}
            </li>
          ))}
        </ul>
      )}

      <p className="border-t border-[var(--color-border)] px-3 py-2 text-2xs text-[var(--color-ink-muted)]">
        Anchor ids survive a heading being reworded, so citations keep resolving.
      </p>
    </section>
  );
}
