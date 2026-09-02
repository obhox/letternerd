import Link from "next/link";
import { notFound } from "next/navigation";
import { HistoryIcon } from "lucide-react";
import { Badge, Button, EmptyState, PageHeader } from "@cms/ui";
import { dispatchOrThrow, studioContext } from "@/server/context";

/**
 * A document's revision history, read-only.
 *
 * `update_document` writes a revision *before* it applies a change, so each
 * row below is the state immediately prior to an edit — the newest one is what
 * the document looked like before the most recent save.
 *
 * Restoring is not implemented. There is no capability for it yet, and a
 * button that looks like it restores and does nothing is worse than its
 * absence, so the page says so in words instead of offering one.
 */

interface RevisionRow {
  id?: unknown;
  revisionNumber?: unknown;
  title?: unknown;
  description?: unknown;
  bodyMd?: unknown;
  note?: unknown;
  createdAt?: unknown;
}

interface DocumentRow {
  title?: unknown;
  slug?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Formatted in UTC with an explicit locale.
 *
 * An audit trail whose timestamps depend on which machine rendered them is an
 * audit trail two people can read differently, so the zone is stated rather
 * than inherited.
 */
const WHEN = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export default async function RevisionsPage({
  params,
}: {
  params: Promise<{ site: string; id: string }>;
}) {
  const { site: slug, id } = await params;
  if (!UUID.test(id)) notFound();

  const ctx = await studioContext(slug);

  const [post, revisions] = await Promise.all([
    dispatchOrThrow<DocumentRow>(ctx, "get_document", { id, type: "post" }),
    dispatchOrThrow<RevisionRow[]>(ctx, "list_revisions", { id, limit: 50 }),
  ]);

  const editorHref = `/${slug}/posts/${id}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Revisions"
        description={
          <>
            <span className="font-medium text-[var(--color-ink)]">
              {text(post.title) || "This post"}
            </span>
            , newest first. Each revision is captured before an edit, so the newest is the state
            immediately prior to the current text.
          </>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={editorHref}>Back to the editor</Link>
          </Button>
        }
      />

      <p className="rounded-md border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm text-[var(--color-ink-muted)]">
        Read-only. Restoring is not available yet — to bring text back, copy it from a revision
        and paste it into the editor.
      </p>

      {revisions.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No revisions yet"
          description="One is written the first time this post is edited."
        />
      ) : (
        <ol className="flex flex-col gap-3">
          {revisions.map((revision, index) => {
            const created = toDate(revision.createdAt);
            const body = text(revision.bodyMd);
            const number =
              typeof revision.revisionNumber === "number"
                ? revision.revisionNumber
                : revisions.length - index;

            return (
              <li
                key={typeof revision.id === "string" ? revision.id : `revision-${number}`}
                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">Revision {number}</Badge>
                  {created && (
                    <time
                      dateTime={created.toISOString()}
                      className="text-xs text-[var(--color-ink-muted)]"
                    >
                      {WHEN.format(created)} UTC
                    </time>
                  )}
                  <span className="text-xs text-[var(--color-ink-muted)]">
                    {body.length.toLocaleString()} characters
                  </span>
                </div>

                <p className="mt-1 truncate text-sm font-medium">
                  {text(revision.title) || <span className="italic">Untitled</span>}
                </p>

                {text(revision.description).length > 0 && (
                  <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">
                    {text(revision.description)}
                  </p>
                )}

                {text(revision.note).length > 0 && (
                  <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                    Note: {text(revision.note)}
                  </p>
                )}

                {/*
                  Collapsed by default. Fifty revisions of a long post is a
                  great deal of markdown to scroll past to reach the one you
                  are looking for.
                */}
                <details className="mt-2">
                  <summary className="ui-focus-ring cursor-pointer rounded text-xs text-[var(--color-accent)]">
                    Show the markdown as it was
                  </summary>
                  <pre className="ui-scroll mt-2 max-h-80 overflow-auto rounded-md bg-[var(--color-muted)] p-3 font-[family-name:var(--font-mono)] text-xs whitespace-pre-wrap">
                    {body}
                  </pre>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
