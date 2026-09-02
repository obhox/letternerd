"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@cms/ui";

/**
 * The one place a secret is ever rendered.
 *
 * Every secret in this system — API keys, webhook signing secrets, invitation
 * tokens — is stored as a digest and returned exactly once, by the call that
 * created it. So this panel is deliberately loud and deliberately awkward to
 * dismiss: the failure it exists to prevent is someone closing a dialog,
 * assuming the value is in a list somewhere, and discovering days later that it
 * is unrecoverable.
 *
 * The value is shown in full rather than masked. Masking would protect against
 * a shoulder-surfer at the cost of the one thing this panel is for, and the
 * person reading it has just chosen to create the credential.
 */
export function CopyOnceSecret({
  label,
  value,
  notice,
  onDismiss,
}: {
  label: string;
  value: string;
  notice: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <section
      // `alert` rather than `status`: this interrupts, because the information
      // is perishable and there is no second chance to read it.
      role="alert"
      className="rounded-lg border border-[var(--color-warn)] bg-[color-mix(in_oklch,var(--color-warn)_10%,var(--color-surface))] p-4"
    >
      <div className="flex items-start gap-2">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-[var(--color-warn)]" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">{label}</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{notice}</p>

          <div className="mt-3 flex items-center gap-2">
            <code className="ui-scroll min-w-0 flex-1 overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-xs whitespace-nowrap text-[var(--color-ink)]">
              {value}
            </code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(value);
                  setCopied(true);
                } catch {
                  // Clipboard access can be refused outright. Saying so beats a
                  // button that silently does nothing, because the value is
                  // still selectable by hand.
                  setCopied(false);
                  window.alert("Copying was blocked by the browser. Select the value and copy it manually.");
                }
              }}
            >
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="ui-focus-ring size-4 accent-[var(--color-accent)]"
            />
            I have stored this somewhere safe.
          </label>

          {/* Dismissal is gated on the checkbox rather than being a plain
              close button: the panel cannot be reopened, so an accidental
              click here is a lost credential. */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2"
            disabled={!acknowledged}
            onClick={onDismiss}
          >
            Done
          </Button>
        </div>
      </div>
    </section>
  );
}
