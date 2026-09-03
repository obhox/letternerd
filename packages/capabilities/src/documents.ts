import { z } from "zod";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import {
  assertCanWriteDocument,
  can,
  conflict,
  defineCapability,
  notFound,
  preconditionFailed,
} from "@cms/core";
import { contentHash, hasBlockingFindings, PIPELINE_VERSION } from "@cms/content";
import * as schema from "@cms/db/schema";
import { renderForSite } from "./render";
import { requireSiteRow, cdnUrlFactory, encodeCursor, decodeCursor, requireSiteOwnedRow } from "./shared";

/**
 * Document capabilities.
 *
 * Every mutation here is reachable identically from MCP, REST and the studio,
 * because none of them contains any of this logic — they resolve an Actor, look
 * a capability up by name, and call `invoke`.
 */

const documentType = z.enum(["post", "page", "block"]);

/** Cheap enough to test before deciding which column a reference addresses. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads are always scoped to the actor's site, and additionally to published
 * documents when the credential is a publishable one.
 *
 * Expressed as a `where` fragment rather than a filter after the fetch, so a
 * handler that forgets cannot leak a draft into a browser bundle.
 */
function visibilityWhere(actor: { siteId: string; publishedOnly: boolean }) {
  const base = and(
    eq(schema.documents.siteId, actor.siteId),
    isNull(schema.documents.deletedAt),
  );
  return actor.publishedOnly
    ? and(base, eq(schema.documents.status, "published"))
    : base;
}

export const searchContent = defineCapability({
  name: "search_content",
  title: "Search content",
  description:
    "List documents on this site, newest first. Filter by type, status, tag or free text. " +
    "Returns a page of summaries plus a cursor; pass it back as `cursor` for the next page.",
  input: z.object({
    type: documentType.optional(),
    status: z.enum(["draft", "in_review", "scheduled", "published", "archived"]).optional(),
    query: z.string().min(1).max(200).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    cursor: z.string().optional(),
  }),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/documents" },
  handler: async (input, { actor, services }) => {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;

    const conditions = [visibilityWhere(actor)];
    if (input.type) conditions.push(eq(schema.documents.type, input.type));
    if (input.status) conditions.push(eq(schema.documents.status, input.status));
    if (input.query) {
      conditions.push(
        sql`${schema.documents.searchVector} @@ plainto_tsquery('english', ${input.query})`,
      );
    }
    if (cursor) {
      // Keyset, not offset: it rides the partial published index exactly and
      // stays correct when a document is published mid-pagination.
      conditions.push(
        or(
          lt(schema.documents.updatedAt, cursor.at),
          and(eq(schema.documents.updatedAt, cursor.at), lt(schema.documents.id, cursor.id)),
        )!,
      );
    }

    const rows = await services.db
      .select({
        id: schema.documents.id,
        type: schema.documents.type,
        status: schema.documents.status,
        slug: schema.documents.slug,
        title: schema.documents.title,
        description: schema.documents.description,
        publishedAt: schema.documents.publishedAt,
        // A scheduled document without its go-live time is nearly useless to a
        // list screen, which would otherwise have to re-fetch each one.
        scheduledFor: schema.documents.scheduledFor,
        updatedAt: schema.documents.updatedAt,
        readingTimeMinutes: schema.documents.readingTimeMinutes,
        wordCount: schema.documents.wordCount,
        lintReport: schema.documents.lintReport,
        primaryAuthorId: schema.documents.primaryAuthorId,
        // Joined rather than resolved by the caller: a list of twenty rows
        // would otherwise be twenty follow-up queries, and the byline is on
        // every listing screen.
        authorName: schema.authors.name,
      })
      .from(schema.documents)
      .leftJoin(schema.authors, eq(schema.documents.primaryAuthorId, schema.authors.id))
      .where(and(...conditions))
      .orderBy(desc(schema.documents.updatedAt), desc(schema.documents.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];

    return {
      documents: page,
      nextCursor: hasMore && last ? encodeCursor({ at: last.updatedAt, id: last.id }) : null,
    };
  },
});

export const getDocument = defineCapability({
  name: "get_document",
  title: "Get document",
  description:
    "Fetch one document by id or slug, including its markdown source, rendered HTML, " +
    "heading anchors and current lint findings.",
  /**
   * `ref` is a uuid or a slug, and the route binds the path segment to it.
   *
   * The path previously bound `:id`, typed as a uuid — so the only address the
   * REST surface actually accepted was an internal identifier, and
   * `/documents/cash-flow-basics` answered 422. A consuming site addresses
   * posts by slug, because that is what appears in its URLs; requiring it to
   * know a uuid first would mean an extra round trip on every page render.
   * `id` and `slug` are kept as explicit alternatives for callers that know
   * which they hold.
   */
  input: z
    .object({
      ref: z.string().min(1).optional(),
      id: z.string().uuid().optional(),
      slug: z.string().optional(),
      type: documentType.default("post"),
    })
    .refine((v) => v.ref || v.id || v.slug, {
      message: "Provide `ref` (a slug or id), or `id`, or `slug`.",
    }),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/documents/:ref" },
  handler: async (input, { actor, services }) => {
    // A ref that parses as a uuid is one; anything else can only be a slug.
    const asId = input.id ?? (input.ref && UUID_RE.test(input.ref) ? input.ref : undefined);
    const asSlug = input.slug ?? (input.ref && !UUID_RE.test(input.ref) ? input.ref : undefined);

    const [doc] = await services.db
      .select()
      .from(schema.documents)
      .where(
        and(
          visibilityWhere(actor),
          asId
            ? eq(schema.documents.id, asId)
            : and(
                eq(schema.documents.slug, asSlug!),
                eq(schema.documents.type, input.type),
              )!,
        ),
      )
      .limit(1);

    if (!doc) throw notFound("Document not found.");

    /**
     * Whether the live page is older than what has been saved.
     *
     * `contentHash` is written at publish and records the markdown that
     * produced the HTML now being served. Saving an edit to a published
     * document moves `bodyMd` but deliberately does not re-render, so the two
     * diverge — and without saying so the editor shows "Published" over text
     * that no reader has seen. An author reasonably reads that as "this is
     * live", which is the one thing it is not.
     *
     * Derived rather than stored so it cannot go stale in its own right.
     */
    const publishedFromDifferentSource =
      doc.contentHash !== null && doc.contentHash !== contentHash(doc.bodyMd);

    return {
      ...doc,
      hasUnpublishedChanges:
        (doc.status === "published" || doc.status === "scheduled") &&
        publishedFromDifferentSource,
      /**
       * The rendering pipeline has moved on since this was last rendered, so
       * the stored HTML is not what the current pipeline would produce. The
       * backfill job clears these; surfacing it stops an author from chasing a
       * discrepancy that is not theirs to fix.
       */
      renderStale: doc.renderVersion < PIPELINE_VERSION,
    };
  },
});

export const createDocument = defineCapability({
  name: "create_document",
  title: "Create document",
  description:
    "Create a draft. Does not publish and does not render — call publish_document when ready. " +
    "Slug must be unique for this site and type.",
  input: z.object({
    type: documentType.default("post"),
    slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase kebab-case."),
    title: z.string().min(1).max(300),
    description: z.string().max(400).optional(),
    bodyMd: z.string().default(""),
    primaryAuthorId: z.string().uuid().optional(),
  }),
  scopes: ["content:write"],
  role: "author",
  route: { method: "POST", path: "/documents" },
  handler: async (input, { actor, services }) => {
    if (input.primaryAuthorId) {
      await requireSiteOwnedRow(
        services.db,
        schema.authors,
        { id: schema.authors.id, siteId: schema.authors.siteId },
        input.primaryAuthorId,
        actor.siteId,
        "Author",
      );
    }

    const [row] = await services.db
      .insert(schema.documents)
      .values({
        siteId: actor.siteId,
        type: input.type,
        slug: input.slug,
        title: input.title,
        description: input.description,
        bodyMd: input.bodyMd,
        primaryAuthorId: input.primaryAuthorId,
        status: "draft",
        createdBy: actor.kind === "user" ? actor.id : null,
        updatedBy: actor.kind === "user" ? actor.id : null,
      })
      .onConflictDoNothing()
      .returning();

    // onConflictDoNothing rather than letting the constraint throw, so the
    // message names the actual problem instead of surfacing a Postgres error.
    if (!row) throw conflict(`A ${input.type} with the slug "${input.slug}" already exists.`);
    return row;
  },
});

export const updateDocument = defineCapability({
  name: "update_document",
  title: "Update document",
  description:
    "Edit a draft or published document. Changing the slug of a published document records a " +
    "301 redirect from the old one automatically — the caller does not opt in.",
  input: z.object({
    id: z.string().uuid(),
    slug: z.string().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    title: z.string().min(1).max(300).optional(),
    description: z.string().max(400).optional(),
    bodyMd: z.string().optional(),
    primaryAuthorId: z.string().uuid().nullable().optional(),
    noindex: z.boolean().optional(),
    canonicalUrlOverride: z
      .string()
      .url()
      // `.url()` accepts any scheme; a canonical of `javascript:` is not a
      // syndication source, it is a payload for whichever consumer renders it.
      .refine((u) => /^https?:\/\//i.test(u), "A canonical URL must be http or https.")
      .nullable()
      .optional(),
    note: z.string().max(500).optional(),
  }),
  scopes: ["content:write"],
  role: "author",
  route: { method: "PATCH", path: "/documents/:id" },
  handler: async (input, { actor, services }) => {
    return services.db.transaction(async (tx) => {
      const [doc] = await tx
        .select()
        .from(schema.documents)
        .where(and(visibilityWhere(actor), eq(schema.documents.id, input.id)))
        .limit(1);

      if (!doc) throw notFound("Document not found.");
      assertCanWriteDocument(actor, doc);

      if (input.primaryAuthorId) {
        await requireSiteOwnedRow(
          tx,
          schema.authors,
          { id: schema.authors.id, siteId: schema.authors.siteId },
          input.primaryAuthorId,
          actor.siteId,
          "Author",
        );
      }

      // A revision before the change, not after: what you want when restoring
      // is the state you are about to lose.
      const [{ next } = { next: 1 }] = await tx
        .select({ next: sql<number>`coalesce(max(${schema.documentRevisions.revisionNumber}), 0) + 1` })
        .from(schema.documentRevisions)
        .where(eq(schema.documentRevisions.documentId, doc.id));

      await tx.insert(schema.documentRevisions).values({
        documentId: doc.id,
        revisionNumber: next,
        title: doc.title,
        description: doc.description,
        bodyMd: doc.bodyMd,
        snapshot: { slug: doc.slug, status: doc.status, seoOverrides: doc.seoOverrides },
        note: input.note,
        createdByUserId: actor.kind === "user" ? actor.id : null,
      });

      /**
       * Slug history is written in this same transaction, always.
       *
       * Never optional and never a checkbox: an editor who renames a published
       * post is not thinking about the inbound links pointing at the old URL,
       * and a redirect that depends on remembering is a redirect that does not
       * exist. Only published documents get one — a draft has no URL anyone
       * could have linked to.
       */
      if (input.slug && input.slug !== doc.slug && doc.firstPublishedAt) {
        await tx
          .insert(schema.slugHistory)
          .values({
            siteId: actor.siteId,
            documentId: doc.id,
            oldSlug: doc.slug,
            newSlug: input.slug,
          })
          .onConflictDoUpdate({
            target: [schema.slugHistory.siteId, schema.slugHistory.oldSlug],
            // Renaming A→B→C must leave A pointing at C, not at the dead B.
            set: { newSlug: input.slug, documentId: doc.id },
          });
      }

      const [updated] = await tx
        .update(schema.documents)
        .set({
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.bodyMd !== undefined && { bodyMd: input.bodyMd }),
          ...(input.primaryAuthorId !== undefined && { primaryAuthorId: input.primaryAuthorId }),
          ...(input.noindex !== undefined && { noindex: input.noindex }),
          ...(input.canonicalUrlOverride !== undefined && {
            canonicalUrlOverride: input.canonicalUrlOverride,
          }),
          updatedAt: services.now(),
          updatedBy: actor.kind === "user" ? actor.id : null,
        })
        .where(eq(schema.documents.id, doc.id))
        .returning();

      return updated!;
    });
  },
});

export const publishDocument = defineCapability({
  name: "publish_document",
  title: "Publish document",
  description:
    "Render and publish a document. Runs the editorial lints as a hard gate. Exactly three " +
    "findings refuse a publish: a missing image alt, an FAQ answer absent from the visible body, " +
    "and an unresolved media reference — each ships something actually broken. Everything else, " +
    "including heading-hierarchy problems and metadata length, is returned as a warning and does " +
    "not block. Pass `publishAt` to schedule instead of publishing now.",
  input: z.object({
    id: z.string().uuid(),
    publishAt: z.string().datetime().optional(),
  }),
  scopes: ["content:publish"],
  role: "editor",
  route: { method: "POST", path: "/documents/:id/publish" },
  handler: async (input, { actor, services }) => {
    const site = await requireSiteRow(services.db, actor.siteId);
    const cdnUrl = cdnUrlFactory(services.storage);

    return services.db.transaction(async (tx) => {
      const [doc] = await tx
        .select()
        .from(schema.documents)
        .where(and(visibilityWhere(actor), eq(schema.documents.id, input.id)))
        .limit(1);

      if (!doc) throw notFound("Document not found.");

      const rendered = await renderForSite({
        db: services.db,
        site,
        doc,
        cdnUrl,
        publicFrontmatter: {
          title: doc.title,
          description: doc.description,
          canonical:
            doc.canonicalUrlOverride ??
            `${site.baseUrl}${site.blogBasePath}/${doc.slug}`,
          date: doc.firstPublishedAt ?? services.now(),
        },
      });

      /**
       * The gate. Blocking findings refuse the publish for every caller —
       * studio, REST and MCP alike — because enforcing this only in the editor
       * would mean an agent could publish what a person could not.
       */
      if (hasBlockingFindings(rendered.lints)) {
        throw preconditionFailed(
          "This document has problems that must be fixed before publishing.",
          { findings: rendered.lints.filter((l) => l.severity === "error") },
        );
      }

      const now = services.now();
      const scheduled = input.publishAt ? new Date(input.publishAt) : null;
      const isFuture = scheduled !== null && scheduled.getTime() > now.getTime();

      await tx.delete(schema.qaBlocks).where(eq(schema.qaBlocks.documentId, doc.id));
      if (rendered.qaBlocks.length > 0) {
        await tx.insert(schema.qaBlocks).values(
          rendered.qaBlocks.map((q, i) => ({
            documentId: doc.id,
            position: i,
            question: q.question,
            answerMd: q.answerMd,
            answerHtml: q.answerHtml,
            anchorId: q.anchorId,
            kind: q.kind,
          })),
        );
      }

      const [updated] = await tx
        .update(schema.documents)
        .set({
          status: isFuture ? "scheduled" : "published",
          scheduledFor: isFuture ? scheduled : null,
          publishedAt: isFuture ? null : (doc.publishedAt ?? now),
          firstPublishedAt: doc.firstPublishedAt ?? (isFuture ? null : now),
          // dateModified is the SEO signal and only moves on an actual
          // publish; updatedAt moves on every save, including typo fixes.
          dateModified: isFuture ? doc.dateModified : now,
          bodyHtml: rendered.html,
          bodyText: rendered.text,
          bodyMdPublic: rendered.mdPublic,
          headings: rendered.headings,
          tldr: rendered.tldr,
          keyTakeaways: rendered.keyTakeaways,
          wordCount: rendered.wordCount,
          readingTimeMinutes: rendered.readingTimeMinutes,
          contentHash: contentHash(doc.bodyMd),
          renderVersion: PIPELINE_VERSION,
          renderedAt: now,
          lintReport: { findings: rendered.lints, checkedAt: now.toISOString() },
          updatedAt: now,
          updatedBy: actor.kind === "user" ? actor.id : null,
        })
        .where(eq(schema.documents.id, doc.id))
        .returning();

      return { document: updated!, lints: rendered.lints };
    });
  },
});

export const unpublishDocument = defineCapability({
  name: "unpublish_document",
  title: "Unpublish document",
  description:
    "Return a published document to draft. The URL stops resolving; use a redirect if anything " +
    "links to it. Rendered HTML is kept so republishing is not a re-render.",
  input: z.object({ id: z.string().uuid() }),
  scopes: ["content:publish"],
  role: "editor",
  destructive: true,
  route: { method: "POST", path: "/documents/:id/unpublish" },
  handler: async (input, { actor, services }) => {
    const [updated] = await services.db
      .update(schema.documents)
      .set({ status: "draft", scheduledFor: null, updatedAt: services.now() })
      .where(
        and(
          eq(schema.documents.siteId, actor.siteId),
          eq(schema.documents.id, input.id),
          isNull(schema.documents.deletedAt),
        ),
      )
      .returning();

    if (!updated) throw notFound("Document not found.");
    return updated;
  },
});

export const deleteDocument = defineCapability({
  name: "delete_document",
  title: "Delete document",
  description:
    "Soft-delete a document. It stops resolving and leaves every listing, but its row and " +
    "revisions are retained and its slug becomes available for reuse.",
  input: z.object({ id: z.string().uuid() }),
  scopes: ["content:write"],
  role: "editor",
  destructive: true,
  route: { method: "DELETE", path: "/documents/:id" },
  handler: async (input, { actor, services }) => {
    const [deleted] = await services.db
      .update(schema.documents)
      .set({ deletedAt: services.now(), status: "archived" })
      .where(
        and(
          eq(schema.documents.siteId, actor.siteId),
          eq(schema.documents.id, input.id),
          isNull(schema.documents.deletedAt),
        ),
      )
      .returning({ id: schema.documents.id, slug: schema.documents.slug });

    if (!deleted) throw notFound("Document not found.");
    return deleted;
  },
});

export const listRevisions = defineCapability({
  name: "list_revisions",
  title: "List revisions",
  description:
    "Every saved revision of a document, newest first. A revision is captured before each "
    + "edit, so the newest one is the state immediately prior to the current text — restore it "
    + "to undo the last change.",
  input: z.object({ id: z.string().uuid(), limit: z.number().int().min(1).max(100).default(20) }),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/documents/:id/revisions" },
  handler: async (input, { actor, services }) => {
    const [doc] = await services.db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(and(visibilityWhere(actor), eq(schema.documents.id, input.id)))
      .limit(1);
    if (!doc) throw notFound("Document not found.");

    return services.db.query.documentRevisions.findMany({
      where: (r, { eq }) => eq(r.documentId, input.id),
      orderBy: (r, { desc }) => [desc(r.revisionNumber)],
      limit: input.limit,
    });
  },
});

/**
 * The parts of a revision's `snapshot` blob that a restore puts back.
 *
 * `snapshot` is jsonb, so drizzle types it as `unknown` — narrowed here rather
 * than cast at the call site, because a revision written by an older release
 * may legitimately not carry every key.
 */
function snapshotSeoOverrides(snapshot: unknown): Record<string, unknown> | undefined {
  if (typeof snapshot !== "object" || snapshot === null) return undefined;
  const value = (snapshot as Record<string, unknown>).seoOverrides;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export const restoreRevision = defineCapability({
  name: "restore_revision",
  title: "Restore a revision",
  description:
    "Put a document's title, description, markdown and SEO overrides back to a saved revision. " +
    "The current state is captured as a new revision first, so a restore is itself undoable and " +
    "restoring the wrong number costs nothing. This is an editing action, not a publishing one: " +
    "status, publishedAt, the slug and the rendered HTML are left exactly as they are, so the " +
    "live page does not change until someone publishes.",
  input: z.object({
    documentId: z.string().uuid(),
    revisionNumber: z.number().int().min(1),
  }),
  scopes: ["content:write"],
  role: "author",
  route: { method: "POST", path: "/documents/:documentId/revisions/restore" },
  handler: async (input, { actor, services }) => {
    return services.db.transaction(async (tx) => {
      /**
       * The document first, scoped to the actor's site.
       *
       * Order matters. Looking the document up before the revision is what
       * makes a revision number belonging to another tenant answer `not_found`
       * rather than `forbidden` — a 403 would confirm that the pair exists,
       * which is the enumeration oracle `notFound` exists to close.
       */
      const [doc] = await tx
        .select()
        .from(schema.documents)
        .where(and(visibilityWhere(actor), eq(schema.documents.id, input.documentId)))
        .limit(1);

      if (!doc) throw notFound("Document not found.");
      assertCanWriteDocument(actor, doc);

      const [revision] = await tx
        .select()
        .from(schema.documentRevisions)
        .where(
          and(
            eq(schema.documentRevisions.documentId, doc.id),
            eq(schema.documentRevisions.revisionNumber, input.revisionNumber),
          ),
        )
        .limit(1);

      if (!revision) throw notFound("Revision not found.");

      /**
       * Snapshot what is about to be overwritten, before overwriting it.
       *
       * A restore that discards the text it replaces is a second way to lose
       * work, and someone will restore the wrong number — the list is a column
       * of near-identical timestamps. Writing this row first makes that a
       * two-click mistake instead of a permanent one, and it is written in the
       * same transaction as the overwrite so there is no window where the old
       * text is gone and the safety copy is not yet there.
       */
      const [{ next } = { next: 1 }] = await tx
        .select({
          next: sql<number>`coalesce(max(${schema.documentRevisions.revisionNumber}), 0) + 1`,
        })
        .from(schema.documentRevisions)
        .where(eq(schema.documentRevisions.documentId, doc.id));

      await tx.insert(schema.documentRevisions).values({
        documentId: doc.id,
        revisionNumber: next,
        title: doc.title,
        description: doc.description,
        bodyMd: doc.bodyMd,
        snapshot: { slug: doc.slug, status: doc.status, seoOverrides: doc.seoOverrides },
        note: `Automatic: state before restoring revision ${input.revisionNumber}.`,
        createdByUserId: actor.kind === "user" ? actor.id : null,
      });

      const restoredSeo = snapshotSeoOverrides(revision.snapshot);

      const [updated] = await tx
        .update(schema.documents)
        .set({
          // `revision.title` is nullable in the table but the column on
          // documents is not, so an ancient revision without one keeps the
          // current title rather than blanking it.
          title: revision.title ?? doc.title,
          description: revision.description,
          bodyMd: revision.bodyMd,
          ...(restoredSeo !== undefined && { seoOverrides: restoredSeo }),

          /**
           * Deliberately absent from this `set`, and the decision most likely
           * to be "fixed" wrongly later: `status`, `publishedAt`,
           * `firstPublishedAt`, `dateModified`, `bodyHtml` and every other
           * rendered column, and `slug`.
           *
           * Restoring is an editing action. It moves the source of truth back;
           * it does not decide what readers see. Writing `bodyHtml` here would
           * silently change a live page from a screen that offers no preview
           * and no lint gate — an author scrolling revision history would
           * republish the site by clicking a row. Writing `status` back would
           * be worse: a revision taken while the post was a draft would
           * unpublish it, and one taken while it was published would push
           * unreviewed markdown live past the publish gate entirely.
           *
           * `slug` is excluded for the same reason plus one more: on a
           * published document a slug change owes a 301 in `slug_history`, and
           * that redirect belongs to `update_document`, which knows to write
           * it. Restoring an old slug here would move a live URL and leave
           * nothing pointing at it.
           *
           * The document is left showing `hasUnpublishedChanges`, which is
           * exactly what has just happened, and the next publish renders the
           * restored markdown through the same gate as any other edit.
           */
          updatedAt: services.now(),
          updatedBy: actor.kind === "user" ? actor.id : null,
        })
        .where(eq(schema.documents.id, doc.id))
        .returning();

      return {
        document: updated!,
        restoredFrom: input.revisionNumber,
        /** The safety copy, so the UI can say what to click to undo this. */
        undoRevisionNumber: next,
      };
    });
  },
});

export const renderPreview = defineCapability({
  name: "render_preview",
  title: "Render preview",
  description:
    "Render markdown exactly as publishing would, without saving. Returns the HTML, the heading " +
    "anchors, extracted FAQ blocks and the full lint findings. This is what the editor's live " +
    "preview calls, so what you see here is what will ship.",
  input: z.object({
    markdown: z.string(),
    slug: z.string().default("preview"),
    documentId: z.string().uuid().optional(),
  }),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  route: { method: "POST", path: "/render-preview" },
  handler: async (input, { actor, services }) => {
    const site = await requireSiteRow(services.db, actor.siteId);

    // Existing anchors matter even in preview: an author needs to see that
    // renaming a heading preserves the id rather than discovering it later.
    let headings: unknown = null;
    if (input.documentId) {
      const [doc] = await services.db
        .select({ headings: schema.documents.headings })
        .from(schema.documents)
        .where(
          and(eq(schema.documents.siteId, actor.siteId), eq(schema.documents.id, input.documentId)),
        )
        .limit(1);
      headings = doc?.headings ?? null;
    }

    const rendered = await renderForSite({
      db: services.db,
      site,
      doc: { slug: input.slug, bodyMd: input.markdown, headings, siteId: actor.siteId },
      cdnUrl: cdnUrlFactory(services.storage),
    });

    return {
      html: rendered.html,
      headings: rendered.headings,
      qaBlocks: rendered.qaBlocks,
      tldr: rendered.tldr,
      keyTakeaways: rendered.keyTakeaways,
      wordCount: rendered.wordCount,
      readingTimeMinutes: rendered.readingTimeMinutes,
      lints: rendered.lints,
      blocked: hasBlockingFindings(rendered.lints),
    };
  },
});

export const documentCapabilities = [
  searchContent,
  getDocument,
  createDocument,
  updateDocument,
  publishDocument,
  unpublishDocument,
  deleteDocument,
  listRevisions,
  restoreRevision,
  renderPreview,
];
