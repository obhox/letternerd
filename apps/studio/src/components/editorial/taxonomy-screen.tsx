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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "@cms/ui";
import { INITIAL_STATE, type EditorialState } from "./action-state";
import { FormStatus } from "./form-status";
import { StringListField } from "./string-list-field";
import type { TermKind, TermRow } from "./types";

/**
 * Tags, categories and entities on one screen, because the difference between
 * them is the thing people get wrong.
 *
 * Tags and categories are filing: they describe where a document sits in this
 * site's own structure. Entities describe what the document is *about*, in
 * terms that exist outside this site — which is why only they carry `sameAs`
 * and `wikidataId`. Each tab says so rather than assuming it is obvious.
 */

type Action = (state: EditorialState, formData: FormData) => Promise<EditorialState>;

const KIND_LABEL: Record<TermKind, { one: string; many: string; blurb: string }> = {
  tag: {
    one: "tag",
    many: "Tags",
    blurb:
      "Flat labels for filing. Useful for readers browsing the archive; they say nothing to a machine about what the subject actually is.",
  },
  category: {
    one: "category",
    many: "Categories",
    blurb:
      "The site's own hierarchy. A document sits in one, and the trail becomes its breadcrumbs.",
  },
  entity: {
    one: "entity",
    many: "Entities",
    blurb:
      "The named things your content is about. Unlike a tag, an entity points outward: sameAs and a Wikidata id are what let an answer engine work out that your “Postgres” is the same subject as everyone else's, instead of a word that happens to appear on your site.",
  },
};

const ENTITY_TYPES = [
  "Thing",
  "Person",
  "Organization",
  "Product",
  "Place",
  "Event",
  "CreativeWork",
  "SoftwareApplication",
];

export function TaxonomyScreen({
  site,
  tags,
  categories,
  entities,
  saveAction,
  deleteAction,
}: {
  site: string;
  tags: TermRow[];
  categories: TermRow[];
  entities: TermRow[];
  saveAction: Action;
  deleteAction: Action;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg leading-tight font-semibold text-[var(--color-ink)]">Taxonomy</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-ink-muted)]">
          How content is filed, and what it is about. Those are two different jobs — the tabs
          below keep them apart on purpose.
        </p>
      </div>

      <Tabs defaultValue="tag">
        <TabsList>
          <TabsTrigger value="tag">Tags</TabsTrigger>
          <TabsTrigger value="category">Categories</TabsTrigger>
          <TabsTrigger value="entity">Entities</TabsTrigger>
        </TabsList>

        <TabsContent value="tag">
          <TermPanel
            kind="tag"
            site={site}
            terms={tags}
            saveAction={saveAction}
            deleteAction={deleteAction}
          />
        </TabsContent>
        <TabsContent value="category">
          <TermPanel
            kind="category"
            site={site}
            terms={categories}
            saveAction={saveAction}
            deleteAction={deleteAction}
          />
        </TabsContent>
        <TabsContent value="entity">
          <TermPanel
            kind="entity"
            site={site}
            terms={entities}
            saveAction={saveAction}
            deleteAction={deleteAction}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TermPanel({
  kind,
  site,
  terms,
  saveAction,
  deleteAction,
}: {
  kind: TermKind;
  site: string;
  terms: TermRow[];
  saveAction: Action;
  deleteAction: Action;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const selected = editing && editing !== "new" ? terms.find((t) => t.id === editing) : null;
  const labels = KIND_LABEL[kind];

  const unreconciled =
    kind === "entity"
      ? terms.filter((term) => !term.wikidataId && (term.sameAs ?? []).length === 0).length
      : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-[var(--color-ink-muted)]">{labels.blurb}</p>
        <Button onClick={() => setEditing("new")}>New {labels.one}</Button>
      </div>

      {unreconciled > 0 ? (
        <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm text-[var(--color-ink)]">
          {unreconciled === 1 ? "One entity has" : `${unreconciled} entities have`} neither a
          Wikidata id nor a sameAs link. Without one of those an entity is only a tag with extra
          fields — nothing outside this site can tell what it refers to.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <DataTable
          caption={`${labels.many} on this site`}
          rows={terms}
          getRowKey={(term) => term.id}
          onRowClick={(term) => setEditing(term.id)}
          empty={
            <EmptyState
              title={`No ${labels.many.toLowerCase()} yet`}
              description={labels.blurb}
              action={<Button onClick={() => setEditing("new")}>New {labels.one}</Button>}
            />
          }
          columns={[
            {
              key: "name",
              header: "Name",
              render: (term) => (
                <span className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => setEditing(term.id)}
                    className="ui-focus-ring self-start rounded text-left font-medium text-[var(--color-ink)]"
                  >
                    {term.name}
                  </button>
                  <span className="text-xs text-[var(--color-ink-muted)]">/{term.slug}</span>
                </span>
              ),
            },
            ...(kind === "entity"
              ? [
                  {
                    key: "type",
                    header: "Type",
                    render: (term: TermRow) => (
                      <Badge variant="outline">{term.type ?? "Thing"}</Badge>
                    ),
                  },
                  {
                    key: "reconciled",
                    header: "Reconciled",
                    render: (term: TermRow) =>
                      term.wikidataId ? (
                        <Badge variant="success">{term.wikidataId}</Badge>
                      ) : (term.sameAs ?? []).length > 0 ? (
                        <Badge variant="warning">sameAs only</Badge>
                      ) : (
                        <Badge variant="danger">Not reconciled</Badge>
                      ),
                  },
                ]
              : []),
            {
              key: "documents",
              header: "Documents",
              align: "right",
              render: (term) => <span className="tabular-nums">{term.documentCount}</span>,
            },
          ]}
        />

        {editing ? (
          <TermForm
            key={`${kind}-${editing}`}
            kind={kind}
            site={site}
            term={selected ?? null}
            siblings={terms}
            saveAction={saveAction}
            deleteAction={deleteAction}
            onClose={() => setEditing(null)}
          />
        ) : null}
      </div>
    </div>
  );
}

function TermForm({
  kind,
  site,
  term,
  siblings,
  saveAction,
  deleteAction,
  onClose,
}: {
  kind: TermKind;
  site: string;
  term: TermRow | null;
  siblings: TermRow[];
  saveAction: Action;
  deleteAction: Action;
  onClose: () => void;
}) {
  const [saveState, save, saving] = useActionState(saveAction, INITIAL_STATE);
  const [deleteState, remove, deleting] = useActionState(deleteAction, INITIAL_STATE);
  const [sameAs, setSameAs] = useState<string[]>(term?.sameAs ?? []);
  const labels = KIND_LABEL[kind];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>{term ? `Edit ${term.name}` : `New ${labels.one}`}</CardTitle>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <form action={save} className="flex flex-col gap-4">
          <input type="hidden" name="site" value={site} />
          <input type="hidden" name="kind" value={kind} />
          {term ? <input type="hidden" name="id" value={term.id} /> : null}

          <FormStatus state={saveState} />

          <Field label="Name" required>
            {(props) => (
              <Input {...props} name="name" required defaultValue={term?.name ?? ""} maxLength={200} />
            )}
          </Field>

          <Field label="Slug" required description="Lowercase and hyphenated. Appears in archive URLs.">
            {(props) => (
              <Input
                {...props}
                name="slug"
                required
                pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                defaultValue={term?.slug ?? ""}
              />
            )}
          </Field>

          <Field label="Description">
            {(props) => (
              <Textarea {...props} name="description" rows={3} defaultValue={term?.description ?? ""} />
            )}
          </Field>

          {kind === "category" ? (
            <>
              <Field label="Parent" description="Leave unset for a top-level category.">
                {(props) => (
                  <select
                    {...props}
                    name="parentId"
                    defaultValue={term?.parentId ?? ""}
                    className="ui-focus-ring h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink)]"
                  >
                    <option value="">No parent</option>
                    {siblings
                      .filter((candidate) => candidate.id !== term?.id)
                      .map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                  </select>
                )}
              </Field>

              <Field label="Position" description="Lower numbers sort first within their parent.">
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    name="position"
                    min={0}
                    max={9999}
                    defaultValue={term?.position ?? 0}
                  />
                )}
              </Field>
            </>
          ) : null}

          {kind === "entity" ? (
            <>
              <Field
                label="schema.org type"
                description="What kind of thing this is. Emitted as the @type of the document's `about` node."
              >
                {(props) => (
                  <select
                    {...props}
                    name="type"
                    defaultValue={term?.type ?? "Thing"}
                    className="ui-focus-ring h-8 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm text-[var(--color-ink)]"
                  >
                    {ENTITY_TYPES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                )}
              </Field>

              <Field
                label="Wikidata id"
                description="A Q-number, like Q192490. The single most useful reconciliation key there is: it names the subject in a vocabulary every major answer engine already reads, so your entity stops being a local string."
              >
                {(props) => (
                  <Input
                    {...props}
                    name="wikidataId"
                    pattern="Q[1-9][0-9]*"
                    placeholder="Q192490"
                    defaultValue={term?.wikidataId ?? ""}
                  />
                )}
              </Field>

              <StringListField
                name="sameAs"
                legend="sameAs links"
                description="Authoritative URLs for this same subject — an official site, a Wikipedia article, a product page. Two independent ones that agree is what makes the identification checkable."
                values={sameAs}
                onChange={setSameAs}
                placeholder="https://www.postgresql.org"
              />

              <Field
                label="Aliases"
                description="One per line. Other names the same thing goes by, so a mention under any of them still counts."
              >
                {(props) => (
                  <Textarea
                    {...props}
                    name="aliases"
                    rows={2}
                    defaultValue={(term?.aliases ?? []).join("\n")}
                  />
                )}
              </Field>
            </>
          ) : null}

          <div className="flex items-center gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : term ? "Save" : `Create ${labels.one}`}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>

        {term ? (
          <form action={remove} className="mt-4 flex flex-col gap-2 border-t border-[var(--color-border)] pt-4">
            <input type="hidden" name="site" value={site} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={term.id} />

            <FormStatus state={deleteState} />

            <p className="text-sm text-[var(--color-ink-muted)]">
              Deleting removes the association from {term.documentCount}{" "}
              {term.documentCount === 1 ? "document" : "documents"}. Nothing is unpublished and no
              text changes — unlike an author, a {labels.one} carries no attribution.
            </p>
            <div>
              <Button type="submit" variant="danger" size="sm" disabled={deleting}>
                {deleting ? "Deleting…" : `Delete ${labels.one}`}
              </Button>
            </div>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}
