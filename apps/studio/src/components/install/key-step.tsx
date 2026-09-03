"use client";

import { useState, useTransition } from "react";
import { CheckIcon, CopyIcon, TriangleAlertIcon } from "lucide-react";
import { Badge, Button, Input, Label } from "@cms/ui";
import { createReadKeyAction } from "@/app/(studio)/[site]/install/actions";
import { FormattedDate } from "@/components/format";

/**
 * Step one: the credential.
 *
 * Everything else on this page can be pre-filled from the site's settings. This
 * cannot: keys are stored as a SHA-256 digest and the plaintext exists exactly
 * once, in the response to `create_api_key`. So the listing shows prefixes —
 * all the server holds — and the only way to obtain a usable key is to mint a
 * new one and copy it here, now.
 *
 * Minting is owner-only, which is a capability rule rather than a page rule:
 * `create_api_key` and `list_api_keys` both refuse a non-owner outright. An
 * editor therefore sees the step and its explanation but no listing and no
 * button, because there is nothing the server would return to them — while the
 * other seven steps, which are the part they actually need, render normally.
 */

export interface InstallKeyView {
  id: string;
  name: string;
  type: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}


export function KeyStep({
  siteSlug,
  canManageKeys,
  keys,
}: {
  siteSlug: string;
  canManageKeys: boolean;
  /** Live keys only, and only ever their prefixes. Empty for a non-owner. */
  keys: InstallKeyView[];
}) {
  const [name, setName] = useState("Website");
  const [created, setCreated] = useState<{ plaintext: string; notice: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const readKeys = keys.filter((key) => key.type === "read");
  const hasReadKey = readKeys.length > 0;

  if (!canManageKeys) {
    return (
      <p className="max-w-2xl text-sm text-[var(--color-ink-secondary)]">
        Your site needs a server read key — one that starts{" "}
        <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-xs">
          cms_sk_
        </code>
        . Only an owner can see or create one, so ask an owner of this site to send you a key from
        Settings → API keys. Everything below is ready to copy once you have it.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-2xl text-sm text-[var(--color-ink-secondary)]">
        Your site reads through a server key — one that starts{" "}
        <code className="rounded bg-[var(--color-muted)] px-1 py-0.5 font-mono text-xs">
          cms_sk_
        </code>
        . It reads published content and analytics and can write nothing, which is what you want in
        a build that runs unattended. Keys are stored as a digest, so the list below shows prefixes
        and there is no way to recover one — if you have lost yours, mint another.
      </p>

      {keys.length > 0 ? (
        <table className="w-full max-w-2xl border-collapse text-sm">
          <caption className="sr-only">Live API keys for this site, by prefix</caption>
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left">
              <th scope="col" className="py-1.5 pr-3 font-medium text-[var(--color-ink-secondary)]">
                Name
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium text-[var(--color-ink-secondary)]">
                Prefix
              </th>
              <th scope="col" className="py-1.5 pr-3 font-medium text-[var(--color-ink-secondary)]">
                Type
              </th>
              <th scope="col" className="py-1.5 font-medium text-[var(--color-ink-secondary)]">
                Last used
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key.id} className="border-b border-[var(--color-border)] last:border-b-0">
                <td className="py-1.5 pr-3 text-[var(--color-ink)]">{key.name}</td>
                <td className="py-1.5 pr-3 font-mono text-xs text-[var(--color-ink-muted)]">
                  {key.keyPrefix}…
                </td>
                <td className="py-1.5 pr-3">
                  <Badge variant="outline">{key.type}</Badge>
                </td>
                {/* The date is formatted in the reader's own locale, which is
                    not the server's — so the two renders legitimately differ
                    and the warning would be noise rather than a bug. */}
                <td className="py-1.5 text-[var(--color-ink-muted)]" suppressHydrationWarning>
                  {<FormattedDate iso={key.lastUsedAt} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-[var(--color-ink-muted)]">This site has no API keys yet.</p>
      )}

      {!hasReadKey && (
        <p className="max-w-2xl text-sm text-[var(--color-ink)]">
          <strong className="font-semibold">There is no read key on this site yet.</strong> Create
          one now — the rest of this guide assumes it.
        </p>
      )}

      <form
        className="flex max-w-2xl flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          startTransition(async () => {
            const result = await createReadKeyAction(siteSlug, name.trim() || "Website");
            if (!result.ok || !result.data) {
              setError(result.message ?? "The key could not be created.");
              return;
            }
            setCreated({ plaintext: result.data.plaintext, notice: result.data.notice });
          });
        }}
      >
        {/* The name is how this key is recognised in the list, and in an audit
            row months from now, so it defaults to something useful rather than
            to an empty box. */}
        <div className="min-w-48 flex-1">
          <Label htmlFor="install-key-name">Name</Label>
          <Input
            id="install-key-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={120}
            placeholder="Website"
          />
        </div>
        <Button type="submit" variant={hasReadKey ? "secondary" : "default"} disabled={pending}>
          {pending ? "Creating…" : hasReadKey ? "Create another read key" : "Create a read key"}
        </Button>
      </form>

      {error !== null && (
        <p role="alert" className="text-sm text-[var(--color-ink)]">
          {error}
        </p>
      )}

      {created !== null && (
        <CopyOnceKey
          value={created.plaintext}
          notice={created.notice}
          onDismiss={() => setCreated(null)}
        />
      )}
    </div>
  );
}

/**
 * The only place this page ever renders a secret.
 *
 * Loud, and deliberately awkward to dismiss: the value cannot be shown again,
 * and the failure this exists to prevent is someone closing the panel assuming
 * the key is in the list above, then discovering days later that it never was.
 * Shown in full rather than masked — masking would defeat the one thing the
 * panel is for, and the person reading it just chose to create the credential.
 */
function CopyOnceKey({
  value,
  notice,
  onDismiss,
}: {
  value: string;
  notice: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <section
      // `alert`, not `status`: this interrupts, because the information is
      // perishable and there is no second chance to read it.
      role="alert"
      className="max-w-2xl rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-sunken)] p-4"
    >
      <div className="flex items-start gap-2">
        <TriangleAlertIcon
          className="mt-0.5 size-4 shrink-0 text-[var(--color-ink)]"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">
            Copy this key now — it will not be shown again
          </h3>
          <p className="mt-1 text-sm text-[var(--color-ink-secondary)]">{notice}</p>

          <div className="mt-3 flex items-center gap-2">
            <code className="ui-scroll ui-focus-ring-inset min-w-0 flex-1 overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-xs whitespace-nowrap text-[var(--color-ink)]">
              {value}
            </code>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Copy the new API key"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(value);
                  setCopied(true);
                } catch {
                  setCopied(false);
                  window.alert(
                    "Copying was blocked by the browser. Select the key and copy it manually — it cannot be shown again.",
                  );
                }
              }}
            >
              {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
            It goes after <code className="font-mono">CMS_API_KEY=</code> in step three.
          </p>

          <label className="mt-3 flex items-center gap-2 text-sm text-[var(--color-ink)]">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
              className="ui-focus-ring size-4 accent-[var(--color-accent)]"
            />
            I have stored this somewhere safe.
          </label>

          {/* Gated on the checkbox rather than being a plain close button: the
              panel cannot be reopened, so a stray click here is a lost key. */}
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
