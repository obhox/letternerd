"use client";

import { useId, useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@cms/ui";

/**
 * A block of configuration, and a button that puts it on the clipboard.
 *
 * Everything on the MCP screen is meant to be pasted somewhere else, so the
 * copy button is the primary control and the text is there to be read for
 * confidence rather than retyped. It is still selectable: clipboard access can
 * be refused outright by the browser, and a button that silently does nothing
 * is worse than no button at all — so a refusal says so, in text, next to the
 * value the reader can still select by hand.
 */
export function CopyBlock({
  label,
  value,
  description,
}: {
  label: string;
  value: string;
  description?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span
          id={`${bodyId}-label`}
          className="text-xs font-medium tracking-wide text-[var(--color-ink-muted)] uppercase"
        >
          {label}
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          // The visible word is "Copy" on every one of these blocks, so the
          // accessible name has to say which block it belongs to.
          aria-label={`Copy ${label.toLowerCase()}`}
          aria-describedby={bodyId}
          onClick={async () => {
            setError(null);
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
            } catch {
              setCopied(false);
              setError("The browser blocked copying. Select the text and copy it manually.");
            }
          }}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      {description !== undefined && (
        <p className="text-sm text-[var(--color-ink-secondary)]">{description}</p>
      )}

      <pre
        id={bodyId}
        className="ui-scroll overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 font-mono text-xs leading-relaxed text-[var(--color-ink)]"
      >
        <code>{value}</code>
      </pre>

      {/* Announced rather than merely shown: the button's own label changes,
          but a screen-reader user who has moved on would otherwise never hear
          that the copy succeeded. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? `${label} copied.` : ""}
      </span>

      {error !== null && (
        <p role="alert" className="text-sm font-medium text-[var(--color-ink)]">
          {error}
        </p>
      )}
    </div>
  );
}
