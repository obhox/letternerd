import Link from "next/link";
import { notFound } from "next/navigation";
import { Button, PageHeader } from "@cms/ui";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { restoreRevisionAction } from "./actions";
import { RevisionsScreen, type RevisionView } from "./revisions-screen";

/**
 * A document's revision history.
 *
 * `update_document` writes a revision *before* it applies a change, so each row
 * is the state immediately prior to an edit — the newest one is what the
 * document looked like before the most recent save. `restore_revision` does the
 * same before it overwrites, which is what makes restoring reversible and what
 * lets this page offer the button at all.
 *
 * The page itself only fetches. Which revisions the reader may see, and whether
 * they may restore one, are decided by the capabilities behind `dispatch`.
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
  status?: unknown;
  bodyMd?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Dates cross the server-component boundary as strings, so normalise here. */
function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
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

  const rows: RevisionView[] = revisions.map((revision, index) => ({
    id: typeof revision.id === "string" ? revision.id : `revision-${index}`,
    revisionNumber:
      typeof revision.revisionNumber === "number"
        ? revision.revisionNumber
        : revisions.length - index,
    title: text(revision.title),
    description: text(revision.description),
    bodyMd: text(revision.bodyMd),
    note: text(revision.note),
    createdAt: isoOrNull(revision.createdAt),
  }));

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
            immediately prior to the current text. Restoring one replaces the draft text and
            leaves the published page alone.
          </>
        }
        actions={
          <Button variant="outline" asChild>
            <Link href={editorHref}>Back to the editor</Link>
          </Button>
        }
      />

      <RevisionsScreen
        site={slug}
        documentId={id}
        documentTitle={text(post.title)}
        currentBodyMd={text(post.bodyMd)}
        currentStatus={text(post.status)}
        revisions={rows}
        restoreAction={restoreRevisionAction}
      />
    </div>
  );
}
