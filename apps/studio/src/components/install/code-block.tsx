"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@cms/ui";

/**
 * A copyable, selectable block of code.
 *
 * Real `<pre><code>` with the monospace token and nothing else. No highlighter:
 * a syntax-highlighting library on this page would ship a tokenizer and a
 * colour theme into the studio bundle to decorate ten static snippets, and in a
 * monotone system there are no hues to give the tokens anyway — so it would
 * cost a dependency to produce grey-on-grey. Plain text also means the copy
 * button and a manual selection yield exactly the same characters, which a
 * highlighter's injected spans do not always guarantee.
 *
 * The block is focusable (`tabIndex={0}`) because it scrolls horizontally, and
 * a scrollable region a keyboard cannot reach is content a keyboard user cannot
 * read. It is labelled, so a screen reader announces which file it is rather
 * than reading eight unlabelled code regions in a row.
 */
export function CodeBlock({
  code,
  label,
  caption,
  describedAs,
}: {
  code: string;
  /** The visible caption: a file path, or "terminal". */
  label: string;
  /** Optional right-hand note: the URL a route serves, say. */
  caption?: string;
  /**
   * What to call this block in the accessibility tree, when the visible label
   * is too generic to distinguish it — seven blocks all captioned "terminal"
   * are seven identical announcements. Defaults to `label`.
   */
  describedAs?: string;
}) {
  const name = describedAs ?? label;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
      <figcaption className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-3 py-1.5">
        <code className="truncate font-mono text-2xs text-[var(--color-ink-secondary)]">
          {label}
        </code>
        <div className="flex shrink-0 items-center gap-2">
          {caption !== undefined && (
            <span className="hidden truncate text-2xs text-[var(--color-ink-muted)] sm:inline">
              {caption}
            </span>
          )}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            // The visible word is "Copy"; the accessible name says what of.
            aria-label={`Copy ${name}`}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setCopied(true);
                setCopyFailed(false);
                window.setTimeout(() => setCopied(false), 2000);
              } catch {
                // Clipboard access can be refused outright. Saying so beats a
                // button that silently does nothing — the text is selectable.
                setCopied(false);
                setCopyFailed(true);
              }
            }}
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </figcaption>

      <pre
        // Labelled and focusable: this scrolls sideways, and a scroll container
        // no keyboard can reach hides the end of every long line.
        role="region"
        aria-label={name}
        tabIndex={0}
        className="ui-scroll ui-focus-ring-inset overflow-x-auto px-3 py-2.5"
      >
        <code className="font-mono text-xs leading-relaxed whitespace-pre text-[var(--color-ink)]">
          {code}
        </code>
      </pre>

      {copyFailed && (
        <p role="alert" className="border-t border-[var(--color-border)] px-3 py-1.5 text-2xs text-[var(--color-ink-secondary)]">
          The browser blocked the clipboard. Select the block and copy it by hand.
        </p>
      )}
    </figure>
  );
}
