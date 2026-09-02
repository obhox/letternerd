import { notFound } from "next/navigation";
import { DESCRIPTION_MAX, DESCRIPTION_MIN } from "@cms/content";
import { can } from "@cms/core/roles";
import { DOCUMENT_STATUSES, type DocumentStatus } from "@cms/ui";
import { PostEditor } from "@/components/editor/post-editor";
import type { DocumentType, EditorDocument } from "@/components/editor/types";
import { dispatchOrThrow, studioContext } from "@/server/context";

/**
 * The editor screen's server half.
 *
 * It resolves the site, fetches the document through the capability layer and
 * hands the client component a plain, serialisable object. It contains no
 * authorization logic of its own: `studioContext` establishes who is asking,
 * `get_document` decides whether they may see this row, and `can.publish`
 * decides only whether the publish control is worth rendering — the capability
 * refuses regardless.
 */

/** The columns of the row this screen reads. The capability exports no type. */
interface DocumentRow {
  id?: unknown;
  type?: unknown;
  status?: unknown;
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  bodyMd?: unknown;
  noindex?: unknown;
  canonicalUrlOverride?: unknown;
  updatedAt?: unknown;
  publishedAt?: unknown;
  scheduledFor?: unknown;
  hasUnpublishedChanges?: unknown;
  renderStale?: unknown;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }
  return null;
}

function asStatus(value: unknown): DocumentStatus {
  return DOCUMENT_STATUSES.includes(value as DocumentStatus) ? (value as DocumentStatus) : "draft";
}

function asType(value: unknown): DocumentType {
  return value === "page" || value === "block" ? value : "post";
}

export default async function PostEditorPage({
  params,
}: {
  params: Promise<{ site: string; id: string }>;
}) {
  const { site: slug, id } = await params;

  // A malformed id would fail the capability's own uuid check and surface as
  // an invalid-input crash. A URL that cannot name a document is a 404.
  if (!UUID.test(id)) notFound();

  const ctx = await studioContext(slug);
  const row = await dispatchOrThrow<DocumentRow>(ctx, "get_document", { id, type: "post" });

  const post: EditorDocument = {
    id: typeof row.id === "string" ? row.id : id,
    type: asType(row.type),
    status: asStatus(row.status),
    slug: typeof row.slug === "string" ? row.slug : "",
    title: typeof row.title === "string" ? row.title : "",
    description: typeof row.description === "string" ? row.description : null,
    bodyMd: typeof row.bodyMd === "string" ? row.bodyMd : "",
    noindex: row.noindex === true,
    canonicalUrlOverride:
      typeof row.canonicalUrlOverride === "string" ? row.canonicalUrlOverride : null,
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
    publishedAt: iso(row.publishedAt),
    scheduledFor: iso(row.scheduledFor),
    // Both are derived by the capability rather than computed here: working
    // out whether the stored render is behind the markdown needs the content
    // hash and the pipeline version, and a second opinion would drift.
    hasUnpublishedChanges: row.hasUnpublishedChanges === true,
    renderStale: row.renderStale === true,
  };

  return (
    <PostEditor
      site={{
        slug: ctx.site.slug,
        name: ctx.site.name,
        baseUrl: ctx.site.baseUrl,
        blogBasePath: ctx.site.blogBasePath,
      }}
      post={post}
      canPublish={can.publish(ctx.role)}
      /*
       * The bounds belong to the `meta-description-length` lint, not to this
       * screen. They are read here — on the server, where importing
       * `@cms/content` does not drag the markdown pipeline into the browser
       * bundle — and passed down, so the meter and the lint cannot disagree.
       */
      descriptionRange={{ min: DESCRIPTION_MIN, max: DESCRIPTION_MAX }}
    />
  );
}
