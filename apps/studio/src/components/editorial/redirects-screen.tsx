"use client";

import { useActionState, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  EmptyState,
  Field,
  Input,
} from "@cms/ui";
import { INITIAL_STATE, type EditorialState } from "./action-state";
import { FormStatus } from "./form-status";
import type { RedirectChain, RedirectRow, SlugHistoryRow } from "./types";

/**
 * Two kinds of redirect, kept visibly apart.
 *
 * The distinction is the whole point of this screen. Slug history is a record
 * of something that already happened — it is appended in the same transaction
 * as a published slug change, and there is no capability anywhere that edits
 * one. Manual rules are decisions someone made. Presenting them in one table
 * with one set of buttons would imply history is editable, and the first thing
 * an editor would try is to "fix" it.
 *
 * So the automatic section has no row click, no edit control and no delete: it
 * is a list of facts, and it says so.
 */

type Action = (state: EditorialState, formData: FormData) => Promise<EditorialState>;

const STATUS_NOTE: Record<number, string> = {
  301: "Permanent. Passes the ranking signal on and gets cached by browsers — the right answer for a page that has genuinely moved.",
  302: "Temporary. The original URL keeps the signal, which is what you want while a page is briefly elsewhere.",
  307: "Temporary, preserving the request method.",
  308: "Permanent, preserving the request method.",
};

function formatDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function RedirectsScreen({
  site,
  redirects,
  slugHistory,
  chains,
  blogBasePath,
  saveAction,
  deleteAction,
}: {
  site: string;
  redirects: RedirectRow[];
  slugHistory: SlugHistoryRow[];
  chains: RedirectChain[];
  blogBasePath: string;
  saveAction: Action;
  deleteAction: Action;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const selected = editing && editing !== "new" ? redirects.find((r) => r.id === editing) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg leading-tight font-semibold text-[var(--color-ink)]">
            Redirects
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
            Two separate things, listed separately: what the CMS recorded when a published slug
            changed, and the rules you wrote by hand.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>New rule</Button>
      </div>

      {chains.length > 0 ? <ChainsNotice chains={chains} /> : null}

      <section aria-labelledby="manual-heading" className="flex flex-col gap-3">
        <div>
          <h2
            id="manual-heading"
            className="text-sm font-semibold text-[var(--color-ink)]"
          >
            Manual rules
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
            Rules you decide: a retired landing page, a vanity path, a move to somewhere off this
            site. These are yours to edit and delete.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
          <DataTable
            caption="Hand-written redirect rules"
            rows={redirects}
            getRowKey={(rule) => rule.id}
            onRowClick={(rule) => setEditing(rule.id)}
            empty={
              <EmptyState
                title="No manual rules"
                description="Slug changes are already handled automatically below. Add a rule here when a URL moves for some other reason."
                action={<Button onClick={() => setEditing("new")}>New rule</Button>}
              />
            }
            columns={[
              {
                key: "source",
                header: "From",
                render: (rule) => (
                  <button
                    type="button"
                    onClick={() => setEditing(rule.id)}
                    className="ui-focus-ring rounded text-left font-mono text-xs text-[var(--color-ink)]"
                  >
                    {rule.source}
                  </button>
                ),
              },
              {
                key: "destination",
                header: "To",
                render: (rule) => (
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-xs break-all">{rule.destination}</span>
                    {rule.isExternal ? <Badge variant="outline">External</Badge> : null}
                  </span>
                ),
              },
              {
                key: "status",
                header: "Status",
                render: (rule) => <Badge variant="outline">{rule.statusCode}</Badge>,
              },
              {
                key: "hits",
                header: "Hits",
                align: "right",
                render: (rule) => <span className="tabular-nums">{rule.hits}</span>,
              },
            ]}
          />

          {editing ? (
            <RedirectForm
              key={editing}
              site={site}
              rule={selected ?? null}
              saveAction={saveAction}
              deleteAction={deleteAction}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </div>
      </section>

      <SlugHistorySection history={slugHistory} blogBasePath={blogBasePath} />
    </div>
  );
}

function ChainsNotice({ chains }: { chains: RedirectChain[] }) {
  return (
    <section
      aria-labelledby="chains-heading"
      className="rounded-md border border-[var(--color-warn)] bg-[color-mix(in_oklch,var(--color-warn)_12%,var(--color-surface))] px-3 py-2"
    >
      <h2 id="chains-heading" className="text-sm font-semibold text-[var(--color-ink)]">
        {chains.length === 1 ? "One redirect chain" : `${chains.length} redirect chains`}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-[var(--color-ink)]">
        A chain is a rule whose destination is itself redirected. Every extra hop is somewhere a
        crawler can stop following, which spends exactly the signal these rules exist to carry.
        Point the first rule straight at the final URL.
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {chains.map((chain) => (
          <li key={`${chain.from.id}-${chain.to.id}`} className="font-mono text-xs">
            {chain.from.source} → {chain.from.destination} → {chain.to.destination}
            {chain.to.origin === "slug_history" ? (
              <span className="ml-1.5 font-sans text-[var(--color-ink-muted)]">
                (second hop is automatic slug history)
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function SlugHistorySection({
  history,
  blogBasePath,
}: {
  history: SlugHistoryRow[];
  blogBasePath: string;
}) {
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h2 id="history-heading" className="text-sm font-semibold text-[var(--color-ink)]">
            Automatic — slug history
          </h2>
          <Badge variant="outline">Read-only</Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
          Written by the CMS whenever a <em>published</em> document&rsquo;s slug changes, inside
          the same save. It is a record of what happened, not a setting, so there is nothing here
          to edit or delete. A draft never appears — it had no URL anyone could have linked to.
          To retire one of these, change the document&rsquo;s slug back.
        </p>
      </div>

      <DataTable
        caption="Slug changes recorded automatically. Not editable."
        rows={history}
        getRowKey={(row) => row.id}
        empty={
          <EmptyState
            title="No slug changes recorded"
            description="Rename a published document and the old URL will keep working, listed here."
          />
        }
        columns={[
          {
            key: "old",
            header: "Old URL",
            render: (row) => (
              <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                {blogBasePath}/{row.oldSlug}
              </span>
            ),
          },
          {
            key: "new",
            header: "Now resolves to",
            render: (row) => (
              <span className="font-mono text-xs">
                {blogBasePath}/{row.newSlug}
              </span>
            ),
          },
          {
            key: "document",
            header: "Document",
            render: (row) => (
              <span className="flex flex-col">
                <span className="text-[var(--color-ink)]">{row.documentTitle}</span>
                {row.documentSlug !== row.newSlug ? (
                  <span className="text-xs text-[var(--color-warn)]">
                    Has since moved again, to /{row.documentSlug}
                  </span>
                ) : null}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            render: (row) => <Badge variant="outline">{row.statusCode}</Badge>,
          },
          {
            key: "when",
            header: "Recorded",
            render: (row) => (
              <span className="text-xs text-[var(--color-ink-muted)]">
                {formatDate(row.createdAt)}
              </span>
            ),
          },
        ]}
      />
    </section>
  );
}

function RedirectForm({
  site,
  rule,
  saveAction,
  deleteAction,
  onClose,
}: {
  site: string;
  rule: RedirectRow | null;
  saveAction: Action;
  deleteAction: Action;
  onClose: () => void;
}) {
  const [saveState, save, saving] = useActionState(saveAction, INITIAL_STATE);
  const [deleteState, remove, deleting] = useActionState(deleteAction, INITIAL_STATE);
  const [statusCode, setStatusCode] = useState<number>(rule?.statusCode ?? 301);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{rule ? "Edit rule" : "New rule"}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <form action={save} className="flex flex-col gap-4">
          <input type="hidden" name="site" value={site} />
          {rule ? <input type="hidden" name="id" value={rule.id} /> : null}

          <FormStatus state={saveState} />

          <Field
            label="From"
            required
            description="A path on this site, like /old-pricing. Pasting a full URL is fine — the origin is stripped, and a trailing slash is ignored."
          >
            {(props) => (
              <Input
                {...props}
                name="source"
                required
                defaultValue={rule?.source ?? ""}
                placeholder="/old-pricing"
              />
            )}
          </Field>

          <Field
            label="To"
            required
            description="A path on this site, or a full URL to send visitors somewhere else entirely."
          >
            {(props) => (
              <Input
                {...props}
                name="destination"
                required
                defaultValue={rule?.destination ?? ""}
                placeholder="/pricing"
              />
            )}
          </Field>

          <Field label="Status code" description={STATUS_NOTE[statusCode]}>
            {(props) => (
              <select
                {...props}
                name="statusCode"
                value={statusCode}
                onChange={(event) => setStatusCode(Number(event.currentTarget.value))}
                className="ui-focus-ring h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink)]"
              >
                {[301, 302, 307, 308].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : rule ? "Save rule" : "Create rule"}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>

        {rule ? (
          <form
            action={remove}
            className="mt-4 flex flex-col gap-2 border-t border-[var(--color-border)] pt-4"
          >
            <input type="hidden" name="site" value={site} />
            <input type="hidden" name="id" value={rule.id} />

            <FormStatus state={deleteState} />

            <p className="text-sm text-[var(--color-ink-muted)]">
              Deleting this rule makes <span className="font-mono text-xs">{rule.source}</span>{" "}
              return 404 again. It has been followed {rule.hits}{" "}
              {rule.hits === 1 ? "time" : "times"}.
            </p>
            <div>
              <Button type="submit" variant="danger" size="sm" disabled={deleting}>
                {deleting ? "Deleting…" : "Delete rule"}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
