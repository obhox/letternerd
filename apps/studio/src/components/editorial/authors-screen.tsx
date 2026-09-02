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
  Textarea,
} from "@cms/ui";
import { INITIAL_STATE } from "./action-state";
import { authorCompleteness, sameAsAdvice, type CompletenessItem } from "./completeness";
import { FormStatus } from "./form-status";
import { StringListField } from "./string-list-field";
import type { AuthorRow } from "./types";

/**
 * The authors screen.
 *
 * Weighted deliberately towards the structured-data fields. A CMS author form
 * is usually a name, a photo and a bio, and the fields that actually make a
 * byline verifiable — the profile links, the job title, the topics — are left
 * blank because nothing ever said what they were for. Here they are the body
 * of the form, each one carries its reason, and the list shows at a glance
 * which authors are still thin.
 */

interface Draft {
  id: string | null;
  slug: string;
  name: string;
  userId: string;
  jobTitle: string;
  bioMd: string;
  avatarAssetId: string;
  email: string;
  url: string;
  sameAs: string[];
  knowsAbout: string;
  isActive: boolean;
}

function draftFrom(author: AuthorRow | null): Draft {
  return {
    id: author?.id ?? null,
    slug: author?.slug ?? "",
    name: author?.name ?? "",
    userId: author?.userId ?? "",
    jobTitle: author?.jobTitle ?? "",
    bioMd: author?.bioMd ?? "",
    avatarAssetId: author?.avatarAssetId ?? "",
    email: author?.email ?? "",
    url: author?.url ?? "",
    sameAs: author?.sameAs ?? [],
    knowsAbout: (author?.knowsAbout ?? []).join("\n"),
    isActive: author?.isActive ?? true,
  };
}

function completenessOf(author: AuthorRow) {
  return authorCompleteness({
    name: author.name,
    jobTitle: author.jobTitle,
    bioMd: author.bioMd,
    avatarAssetId: author.avatarAssetId,
    url: author.url,
    sameAs: author.sameAs,
    knowsAbout: author.knowsAbout,
  });
}

export function AuthorsScreen({
  site,
  authors,
  saveAction,
  deleteAction,
}: {
  site: string;
  authors: AuthorRow[];
  saveAction: (state: typeof INITIAL_STATE, formData: FormData) => Promise<typeof INITIAL_STATE>;
  deleteAction: (state: typeof INITIAL_STATE, formData: FormData) => Promise<typeof INITIAL_STATE>;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const selected = editing && editing !== "new" ? authors.find((a) => a.id === editing) : null;

  const thin = authors.filter((author) => completenessOf(author).done < 5).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-lg leading-tight font-semibold text-[var(--color-ink)]">Authors</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
            A byline, not a login. An author can be a guest contributor with no account, and
            deleting an account never removes a byline.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>New author</Button>
      </div>

      {thin > 0 ? (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm text-[var(--color-ink)]">
          {thin === 1 ? "One author is" : `${thin} authors are`} missing most of their profile
          fields.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_30rem]">
        <div>
          <DataTable
            caption="Authors on this site"
            rows={authors}
            getRowKey={(author) => author.id}
            onRowClick={(author) => setEditing(author.id)}
            empty={
              <EmptyState
                title="No authors yet"
                description="Every published document credits an author."
                action={<Button onClick={() => setEditing("new")}>New author</Button>}
              />
            }
            columns={[
              {
                key: "name",
                header: "Name",
                render: (author) => (
                  <span className="flex flex-col">
                    {/* A real control in the row, so the table is usable by
                        keyboard without relying on the row's own handler. */}
                    <button
                      type="button"
                      onClick={() => setEditing(author.id)}
                      className="ui-focus-ring self-start rounded text-left font-medium text-[var(--color-ink)]"
                    >
                      {author.name}
                    </button>
                    <span className="text-xs text-[var(--color-ink-muted)]">/{author.slug}</span>
                  </span>
                ),
              },
              {
                key: "account",
                header: "Account",
                render: (author) =>
                  author.userId ? (
                    <Badge variant="outline">Linked</Badge>
                  ) : (
                    <Badge variant="outline" title="A byline with no linked account.">
                      Guest
                    </Badge>
                  ),
              },
              {
                key: "credits",
                header: "Credits",
                align: "right",
                render: (author) => (
                  <span className="tabular-nums">
                    {author.references.asPrimary + author.references.asByline}
                  </span>
                ),
              },
              {
                key: "profile",
                header: "Profile",
                render: (author) => {
                  const { done, total } = completenessOf(author);
                  return (
                    <Badge variant={done >= 6 ? "success" : done >= 4 ? "warning" : "danger"}>
                      {done}/{total} fields
                    </Badge>
                  );
                },
              },
              {
                key: "status",
                header: "Status",
                render: (author) =>
                  author.isActive ? null : <Badge variant="outline">Retired</Badge>,
              },
            ]}
          />
        </div>

        {editing ? (
          <AuthorForm
            key={editing}
            site={site}
            authors={authors}
            author={selected ?? null}
            saveAction={saveAction}
            deleteAction={deleteAction}
            onClose={() => setEditing(null)}
          />
        ) : (
          <WhyItMatters />
        )}
      </div>
    </div>
  );
}

/** Shown when nothing is being edited, so the reasoning is not hidden behind a click. */
function WhyItMatters() {
  const { items } = authorCompleteness({
    name: "",
    jobTitle: null,
    bioMd: null,
    avatarAssetId: null,
    url: null,
    sameAs: [],
    knowsAbout: [],
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Author profile fields</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <p className="text-sm text-[var(--color-ink-muted)]">
          Emitted as a schema.org <code>Person</code> on everything that author writes.
        </p>
        <dl className="mt-3 flex flex-col gap-3">
          {items.map((item) => (
            <div key={item.key}>
              <dt className="text-sm font-medium text-[var(--color-ink)]">{item.label}</dt>
              <dd className="text-sm text-[var(--color-ink-muted)]">{item.why}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function AuthorForm({
  site,
  authors,
  author,
  saveAction,
  deleteAction,
  onClose,
}: {
  site: string;
  authors: AuthorRow[];
  author: AuthorRow | null;
  saveAction: (state: typeof INITIAL_STATE, formData: FormData) => Promise<typeof INITIAL_STATE>;
  deleteAction: (state: typeof INITIAL_STATE, formData: FormData) => Promise<typeof INITIAL_STATE>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFrom(author));
  const [saveState, save, saving] = useActionState(saveAction, INITIAL_STATE);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  // Recomputed from the draft rather than from the saved row, so the checklist
  // responds while the form is being filled in — which is the moment the
  // explanation is worth reading.
  const completeness = authorCompleteness({
    name: draft.name,
    jobTitle: draft.jobTitle,
    bioMd: draft.bioMd,
    avatarAssetId: draft.avatarAssetId,
    url: draft.url,
    sameAs: draft.sameAs,
    knowsAbout: draft.knowsAbout.split("\n").filter((line) => line.trim().length > 0),
  });
  const advice = sameAsAdvice(draft.sameAs);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <CardTitle>{author ? `Edit ${author.name}` : "New author"}</CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pb-4">
          <form action={save} className="flex flex-col gap-4">
            <input type="hidden" name="site" value={site} />
            {author ? <input type="hidden" name="id" value={author.id} /> : null}
            <input type="hidden" name="hadUserId" value={author?.userId ? "1" : "0"} />

            <FormStatus state={saveState} />

            <Field label="Display name" required>
              {(props) => (
                <Input
                  {...props}
                  name="name"
                  required
                  maxLength={200}
                  value={draft.name}
                  onChange={(event) => set("name", event.currentTarget.value)}
                />
              )}
            </Field>

            <Field
              label="Slug"
              required
              description="Lowercase and hyphenated. Changing it moves the author page."
            >
              {(props) => (
                <Input
                  {...props}
                  name="slug"
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={draft.slug}
                  onChange={(event) => set("slug", event.currentTarget.value)}
                />
              )}
            </Field>

            <Field
              label="Job title"
              description="Person.jobTitle."
            >
              {(props) => (
                <Input
                  {...props}
                  name="jobTitle"
                  maxLength={200}
                  placeholder="Staff engineer, Databases"
                  value={draft.jobTitle}
                  onChange={(event) => set("jobTitle", event.currentTarget.value)}
                />
              )}
            </Field>

            <Field
              label="Biography"
              description="Markdown."
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="bioMd"
                  rows={4}
                  maxLength={8000}
                  value={draft.bioMd}
                  onChange={(event) => set("bioMd", event.currentTarget.value)}
                />
              )}
            </Field>

            <StringListField
              name="sameAs"
              legend="Profile links"
              description="Person.sameAs — LinkedIn, ORCID, GitHub, a speaker page."
              values={draft.sameAs}
              onChange={(next) => set("sameAs", next)}
              placeholder="https://www.linkedin.com/in/…"
            />
            {advice ? (
              <p className="-mt-2 text-xs text-[var(--color-ink-muted)]">{advice}</p>
            ) : null}

            <Field
              label="Topics"
              description="Person.knowsAbout, one per line."
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="knowsAbout"
                  rows={3}
                  placeholder={"PostgreSQL\nquery planning"}
                  value={draft.knowsAbout}
                  onChange={(event) => set("knowsAbout", event.currentTarget.value)}
                />
              )}
            </Field>

            <Field
              label="Personal site"
              description="Person.url."
            >
              {(props) => (
                <Input
                  {...props}
                  type="url"
                  name="url"
                  value={draft.url}
                  onChange={(event) => set("url", event.currentTarget.value)}
                />
              )}
            </Field>

            <Field label="Photo" description="Person.image.">
              {(props) => (
                <Input
                  {...props}
                  name="avatarAssetId"
                  placeholder="Media asset id"
                  value={draft.avatarAssetId}
                  onChange={(event) => set("avatarAssetId", event.currentTarget.value)}
                />
              )}
            </Field>

            <Field label="Email" description="Never published; editorial notifications only.">
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  name="email"
                  value={draft.email}
                  onChange={(event) => set("email", event.currentTarget.value)}
                />
              )}
            </Field>

            <Field
              label="Linked account"
              description="Optional. Clearing it unlinks the account and keeps the name, bio and every credit."
            >
              {(props) => (
                <Input
                  {...props}
                  name="userId"
                  placeholder="No account"
                  value={draft.userId}
                  onChange={(event) => set("userId", event.currentTarget.value)}
                />
              )}
            </Field>

            <label className="flex items-center gap-2 text-sm text-[var(--color-ink)]">
              <input
                type="checkbox"
                name="isActive"
                className="ui-focus-ring size-4"
                checked={draft.isActive}
                onChange={(event) => set("isActive", event.currentTarget.checked)}
              />
              Active — offer this author when choosing a byline
            </label>

            <div className="flex items-center gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : author ? "Save author" : "Create author"}
              </Button>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <CompletenessPanel items={completeness.items} done={completeness.done} total={completeness.total} percent={completeness.percent} />

      {author ? (
        <DeleteAuthorPanel
          site={site}
          author={author}
          others={authors.filter((a) => a.id !== author.id)}
          deleteAction={deleteAction}
        />
      ) : null}
    </div>
  );
}

function CompletenessPanel({
  items,
  done,
  total,
  percent,
}: {
  items: CompletenessItem[];
  done: number;
  total: number;
  percent: number;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile completeness</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <p className="text-sm text-[var(--color-ink-muted)]">
          {done} of {total} fields filled in.
        </p>
        {/* The bar restates the sentence above; the numbers are the accessible
            version, so it is hidden rather than given a redundant label. */}
        <div
          aria-hidden="true"
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-muted)]"
        >
          <div
            className="h-full rounded-full bg-[var(--color-accent)] transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>

        <ul className="mt-3 flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.key} className="flex gap-2">
              <span
                aria-hidden="true"
                className={
                  item.done
                    ? "mt-1.5 size-2 shrink-0 rounded-full bg-[var(--color-ok)]"
                    : "mt-1.5 size-2 shrink-0 rounded-full border border-[var(--color-ink-muted)]"
                }
              />
              <span className="min-w-0">
                <span className="text-sm font-medium text-[var(--color-ink)]">
                  {item.label}
                  <span className="sr-only">{item.done ? " — filled in" : " — empty"}</span>
                </span>
                <span className="block text-sm text-[var(--color-ink-muted)]">{item.why}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function DeleteAuthorPanel({
  site,
  author,
  others,
  deleteAction,
}: {
  site: string;
  author: AuthorRow;
  others: AuthorRow[];
  deleteAction: (state: typeof INITIAL_STATE, formData: FormData) => Promise<typeof INITIAL_STATE>;
}) {
  const [state, remove, pending] = useActionState(deleteAction, INITIAL_STATE);
  const credits = author.references.asPrimary + author.references.asByline;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delete this author</CardTitle>
      </CardHeader>
      <CardContent className="pb-4">
        <form action={remove} className="flex flex-col gap-3">
          <input type="hidden" name="site" value={site} />
          <input type="hidden" name="id" value={author.id} />

          <FormStatus state={state} />

          <p className="text-sm text-[var(--color-ink-muted)]">
            {credits === 0
              ? "Nothing currently credits this author, so deleting is safe."
              : `${credits} live ${credits === 1 ? "document credits" : "documents credit"} this author. Deleting is refused until those credits move, because a blank byline also drops the Person data.`}{" "}
            Retiring instead — clearing <em>Active</em> above — keeps every credit and only removes
            them from the byline picker.
          </p>

          {credits > 0 ? (
            <Field
              label="Reassign credits to"
              description="Optional. Moves the byline and any co-author credits, then deletes the original."
            >
              {(props) => (
                <select
                  {...props}
                  name="reassignToId"
                  defaultValue=""
                  className="ui-focus-ring h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink)]"
                >
                  <option value="">Do not reassign</option>
                  {others.map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}

          <div>
            <Button type="submit" variant="danger" disabled={pending}>
              {pending ? "Deleting…" : "Delete author"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
