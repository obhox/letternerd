"use client";

import { useState, useTransition } from "react";
import { KeyRoundIcon } from "lucide-react";
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Field,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type DataTableColumn,
} from "@cms/ui";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/(studio)/[site]/settings/actions";
import { CopyOnceSecret } from "./copy-once";
import type { ApiKeyView } from "./types";

/**
 * API keys.
 *
 * The list shows prefixes and nothing else, because that is all the server
 * holds — keys are stored as a SHA-256 digest and the plaintext exists exactly
 * once, in the response to `create_api_key`. This component is therefore the
 * only place in the studio where a key is ever rendered, and it renders it
 * through `CopyOnceSecret`, which says so in as many words.
 */

const KEY_TYPES = [
  {
    value: "publishable",
    label: "Publishable (cms_pk_)",
    hint: "Safe in a browser bundle: published content and media reads, plus the analytics beacon. Cannot see drafts.",
  },
  {
    value: "read",
    label: "Server read (cms_sk_)",
    hint: "Reads, including analytics. Server-side only — it is not origin-checked and must never reach a browser.",
  },
  {
    value: "admin",
    label: "Admin (cms_ak_)",
    hint: "Writes and publishes content. Still cannot change site settings, manage members or mint further keys.",
  },
] as const;

function formatDate(iso: string | null): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function ApiKeysPanel({
  siteSlug,
  keys,
  revokedCount,
}: {
  siteSlug: string;
  keys: ApiKeyView[];
  revokedCount: number;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("read");
  const [created, setCreated] = useState<{ plaintext: string; notice: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const selected = KEY_TYPES.find((option) => option.value === type);

  const columns: DataTableColumn<ApiKeyView>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          {/* The prefix, never the key. Enough to recognise it in a log or an
              environment variable, nowhere near enough to use it. */}
          <code className="font-mono text-xs text-[var(--color-ink-muted)]">{row.keyPrefix}…</code>
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      render: (row) => <Badge variant="outline">{row.type}</Badge>,
    },
    {
      key: "lastUsed",
      header: "Last used",
      render: (row) =>
        row.lastUsedAt === null ? (
          // "Never used" and "used, we did not record when" are different
          // facts; only the first is true here, and it is worth saying.
          <span className="text-[var(--color-ink-muted)]">Never used</span>
        ) : (
          formatDate(row.lastUsedAt)
        ),
    },
    { key: "created", header: "Created", render: (row) => formatDate(row.createdAt) },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (row) =>
        row.revokedAt !== null ? (
          <Badge variant="danger">Revoked</Badge>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (
                !window.confirm(
                  `Revoke "${row.name}"? Every request using it fails from the next call onwards. This cannot be undone.`,
                )
              ) {
                return;
              }
              startTransition(async () => {
                const result = await revokeApiKeyAction(siteSlug, row.id);
                if (!result.ok) setError(result.message ?? "Could not revoke that key.");
              });
            }}
          >
            Revoke
          </Button>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {created && (
        <CopyOnceSecret
          label={`API key "${created.name}"`}
          value={created.plaintext}
          notice={created.notice}
          onDismiss={() => setCreated(null)}
        />
      )}

      <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <h2 className="text-sm font-semibold text-[var(--color-ink)]">Create a key</h2>
        <form
          className="mt-3 flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await createApiKeyAction(siteSlug, { name, type });
              if (!result.ok || !result.data) {
                setError(result.message ?? "Could not create that key.");
                return;
              }
              setCreated({
                plaintext: result.data.plaintext,
                notice: result.data.notice,
                name: result.data.key.name,
              });
              setName("");
            });
          }}
        >
          <Field
            label="Name"
            description="What this key is for — the deployment, the CI job, the MCP client. It is the only way to tell keys apart later."
          >
            {({ id, ...wiring }) => (
              <Input
                id={id}
                {...wiring}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production website"
                required
              />
            )}
          </Field>

          <Field label="Type" description={selected?.hint}>
            {({ id }) => (
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id={id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KEY_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <p className="text-sm text-[var(--color-ink-muted)]">
            The key is shown once, on the next screen, and never again.
          </p>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending || name.trim() === ""}>
              {pending ? "Creating…" : "Create key"}
            </Button>
            {error && (
              <p role="alert" className="text-sm text-[var(--color-danger)]">
                {error}
              </p>
            )}
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-ink)]">Existing keys</h2>
          {revokedCount > 0 && (
            <p className="text-xs text-[var(--color-ink-muted)]">
              {revokedCount} revoked {revokedCount === 1 ? "key is" : "keys are"} hidden.
            </p>
          )}
        </div>

        <DataTable
          columns={columns}
          rows={keys}
          getRowKey={(row) => row.id}
          caption="API keys issued for this site"
          empty={
            <EmptyState
              icon={KeyRoundIcon}
              title="No API keys yet"
              description="A consuming site, a CI job or an MCP client needs one of these to reach the content API."
            />
          }
        />
      </section>
    </div>
  );
}
