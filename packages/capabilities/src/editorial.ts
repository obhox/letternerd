import { z } from "zod";
import { and, asc, count, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import type { Database } from "@cms/db";
import {
  assertCanWriteDocument,
  conflict,
  defineCapability,
  invalidInput,
  notFound,
  preconditionFailed,
} from "@cms/core";
import * as schema from "@cms/db/schema";
import { requireSiteRow, requireSiteOwnedRow } from "./shared";

/**
 * Editorial capabilities: authors, taxonomy, entities and redirects.
 *
 * Everything the studio, the MCP server and the REST API do to a byline, a
 * tag or a redirect rule happens here, once. The three surfaces resolve an
 * Actor and dispatch; none of them re-implements a scoping rule, which is the
 * only way the three stay honest with each other.
 *
 * Two invariants run through the whole file and are worth stating up front.
 *
 * Every read and every write is constrained by `actor.siteId`, which is
 * resolved before dispatch and never arrives in capability input. An id
 * belonging to another site therefore matches nothing and is answered
 * `not_found` — never `forbidden`, which would confirm the id is real and turn
 * the API into a tenant-enumeration oracle.
 *
 * And nothing in this file writes to `slugHistory`. That table is a record of
 * what happened, appended by `update_document` inside the same transaction as
 * the slug change. It is not a setting, so there is no capability here that
 * edits one — `redirects` is the separate, hand-written table for rules a
 * person actually decides.
 */

const slugField = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Must be lowercase kebab-case.");

/** schema.org types worth offering in a CMS. `Thing` is the honest default. */
const entityType = z.enum([
  "Thing",
  "Person",
  "Organization",
  "Product",
  "Place",
  "Event",
  "CreativeWork",
  "SoftwareApplication",
]);

const termKind = z.enum(["tag", "category", "entity"]);
export type TermKind = z.infer<typeof termKind>;

// ---------------------------------------------------------------------------
// Usage counts
//
// Each of these joins back to `documents` rather than counting association
// rows on their own. Two reasons: a soft-deleted post would otherwise inflate
// the number an editor uses to decide whether a tag is worth keeping or an
// author is safe to remove, and the join is what puts the site predicate on a
// query whose own table has no `siteId` column.
// ---------------------------------------------------------------------------

function tally(rows: ReadonlyArray<{ key: string | null; n: number }>): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.key !== null) map.set(row.key, Number(row.n));
  }
  return map;
}

async function tagUsage(db: Database, siteId: string, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ key: schema.documentTags.tagId, n: count() })
    .from(schema.documentTags)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentTags.documentId))
    .where(
      and(
        eq(schema.documents.siteId, siteId),
        isNull(schema.documents.deletedAt),
        inArray(schema.documentTags.tagId, [...ids]),
      ),
    )
    .groupBy(schema.documentTags.tagId);
  return tally(rows);
}

async function entityUsage(db: Database, siteId: string, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ key: schema.documentEntities.entityId, n: count() })
    .from(schema.documentEntities)
    .innerJoin(schema.documents, eq(schema.documents.id, schema.documentEntities.documentId))
    .where(
      and(
        eq(schema.documents.siteId, siteId),
        isNull(schema.documents.deletedAt),
        inArray(schema.documentEntities.entityId, [...ids]),
      ),
    )
    .groupBy(schema.documentEntities.entityId);
  return tally(rows);
}

async function categoryUsage(db: Database, siteId: string, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await db
    .select({ key: schema.documents.categoryId, n: count() })
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.siteId, siteId),
        isNull(schema.documents.deletedAt),
        inArray(schema.documents.categoryId, [...ids]),
      ),
    )
    .groupBy(schema.documents.categoryId);
  return tally(rows);
}

export interface AuthorReferences {
  /** Documents whose `primaryAuthorId` is this author — the visible byline. */
  asPrimary: number;
  /** Additional byline and reviewer credits in `document_authors`. */
  asByline: number;
}

/**
 * How many live documents would lose a byline if this author disappeared.
 *
 * Both halves matter: `primaryAuthorId` is what the `Person` node in the
 * JSON-LD is built from, and `document_authors` carries co-authors and the
 * reviewer credit, which is itself an E-E-A-T signal worth not silently
 * dropping.
 */
export async function authorReferences(
  db: Database,
  siteId: string,
  ids: readonly string[],
): Promise<Map<string, AuthorReferences>> {
  const result = new Map<string, AuthorReferences>();
  for (const id of ids) result.set(id, { asPrimary: 0, asByline: 0 });
  if (ids.length === 0) return result;

  const primary = tally(
    await db
      .select({ key: schema.documents.primaryAuthorId, n: count() })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.siteId, siteId),
          isNull(schema.documents.deletedAt),
          inArray(schema.documents.primaryAuthorId, [...ids]),
        ),
      )
      .groupBy(schema.documents.primaryAuthorId),
  );

  const byline = tally(
    await db
      .select({ key: schema.documentAuthors.authorId, n: count() })
      .from(schema.documentAuthors)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.documentAuthors.documentId))
      .where(
        and(
          eq(schema.documents.siteId, siteId),
          isNull(schema.documents.deletedAt),
          inArray(schema.documentAuthors.authorId, [...ids]),
        ),
      )
      .groupBy(schema.documentAuthors.authorId),
  );

  for (const id of ids) {
    result.set(id, { asPrimary: primary.get(id) ?? 0, asByline: byline.get(id) ?? 0 });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Authors
// ---------------------------------------------------------------------------

export const listAuthors = defineCapability({
  name: "list_authors",
  title: "List authors",
  description:
    "Every byline on this site with its structured-data fields — sameAs profile URLs, jobTitle, " +
    "knowsAbout topics and credentials — plus how many live documents each one is credited on. " +
    "An author is a byline, not a login: some have no user account at all.",
  input: z.object({
    includeInactive: z.boolean().default(true),
    query: z.string().min(1).max(200).optional(),
  }),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/authors" },
  handler: async (input, { actor, services }) => {
    const conditions = [eq(schema.authors.siteId, actor.siteId)];
    if (!input.includeInactive) conditions.push(eq(schema.authors.isActive, true));

    const rows = await services.db
      .select()
      .from(schema.authors)
      .where(and(...conditions))
      .orderBy(asc(schema.authors.name));

    // Filtered in memory rather than in SQL: an author list is tens of rows,
    // and a trigram index on `name` would be a lot of machinery for a search
    // box that exists to save one scroll.
    const needle = input.query?.trim().toLowerCase();
    const authors = needle
      ? rows.filter(
          (a) =>
            a.name.toLowerCase().includes(needle) || a.slug.toLowerCase().includes(needle),
        )
      : rows;

    const references = await authorReferences(
      services.db,
      actor.siteId,
      authors.map((a) => a.id),
    );

    return {
      authors: authors.map((author) => ({
        ...author,
        references: references.get(author.id) ?? { asPrimary: 0, asByline: 0 },
      })),
    };
  },
});

export const upsertAuthor = defineCapability({
  name: "upsert_author",
  title: "Create or update an author",
  description:
    "Create a byline or edit an existing one. Pass `id` to update, omit it to create. " +
    "`userId` is optional and nullable on purpose: a guest contributor gets a full byline with " +
    "no account, and passing null detaches a departed employee's login while keeping their " +
    "Person data on everything they wrote. `sameAs`, `jobTitle` and `knowsAbout` are emitted as " +
    "schema.org Person fields and are the cheapest author-credibility signal available.",
  input: z.object({
    id: z.string().uuid().optional(),
    slug: slugField,
    name: z.string().min(1).max(200),
    /**
     * Three distinct meanings, all of them wanted: absent leaves the link
     * alone, null clears it, a string sets it.
     */
    userId: z.string().min(1).nullable().optional(),
    jobTitle: z.string().max(200).nullable().optional(),
    bioMd: z.string().max(8000).nullable().optional(),
    avatarAssetId: z.string().uuid().nullable().optional(),
    email: z.string().email().nullable().optional(),
    url: z.string().url().nullable().optional(),
    sameAs: z.array(z.string().url()).max(25).optional(),
    knowsAbout: z.array(z.string().min(1).max(120)).max(50).optional(),
    credentials: z.record(z.unknown()).optional(),
    isActive: z.boolean().optional(),
  }),
  scopes: ["taxonomy:write"],
  role: "editor",
  route: { method: "POST", path: "/authors" },
  handler: async (input, { actor, services }) => {
    /**
     * A linked account must be a member of *this* site.
     *
     * Without the check, an editor could point a byline at any user id in the
     * system and read a name back out of it. Membership is the only fact about
     * another user this site is entitled to know.
     */
    if (input.userId) {
      const [member] = await services.db
        .select({ userId: schema.siteMembers.userId })
        .from(schema.siteMembers)
        .where(
          and(
            eq(schema.siteMembers.siteId, actor.siteId),
            eq(schema.siteMembers.userId, input.userId),
          ),
        )
        .limit(1);
      if (!member) {
        throw invalidInput("That user is not a member of this site, so it cannot own a byline.");
      }
    }

    // The avatar, likewise, must be one of this site's own assets.
    if (input.avatarAssetId) {
      await requireSiteOwnedRow(
        services.db,
        schema.mediaAssets,
        { id: schema.mediaAssets.id, siteId: schema.mediaAssets.siteId },
        input.avatarAssetId,
        actor.siteId,
        "Avatar asset",
      );
    }

    const fields = {
      ...(input.userId !== undefined && { userId: input.userId }),
      slug: input.slug,
      name: input.name,
      ...(input.jobTitle !== undefined && { jobTitle: input.jobTitle }),
      ...(input.bioMd !== undefined && { bioMd: input.bioMd }),
      ...(input.avatarAssetId !== undefined && { avatarAssetId: input.avatarAssetId }),
      ...(input.email !== undefined && { email: input.email }),
      ...(input.url !== undefined && { url: input.url }),
      ...(input.sameAs !== undefined && { sameAs: input.sameAs }),
      ...(input.knowsAbout !== undefined && { knowsAbout: input.knowsAbout }),
      ...(input.credentials !== undefined && { credentials: input.credentials }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    };

    if (input.id) {
      const [updated] = await services.db
        .update(schema.authors)
        .set({ ...fields, updatedAt: services.now() })
        .where(and(eq(schema.authors.siteId, actor.siteId), eq(schema.authors.id, input.id)))
        .returning();
      if (!updated) throw notFound("Author not found.");
      return updated;
    }

    const [created] = await services.db
      .insert(schema.authors)
      .values({
        siteId: actor.siteId,
        // Explicit rather than relying on the column default, so the guest
        // case is visible at the call site instead of implied by an omission.
        userId: input.userId ?? null,
        ...fields,
      })
      .onConflictDoNothing()
      .returning();

    if (!created) throw conflict(`An author with the slug "${input.slug}" already exists.`);
    return created;
  },
});

export const deleteAuthor = defineCapability({
  name: "delete_author",
  title: "Delete an author",
  description:
    "Delete a byline. Refuses while any live document still credits it, and says how many — " +
    "deleting would blank the byline and drop the Person structured data from every one of them. " +
    "Pass `reassignToId` to move those credits to another author first, or set `isActive: false` " +
    "via upsert_author to retire someone while leaving their published work attributed.",
  input: z.object({
    id: z.string().uuid(),
    reassignToId: z.string().uuid().optional(),
  }),
  scopes: ["taxonomy:write"],
  role: "editor",
  destructive: true,
  route: { method: "DELETE", path: "/authors/:id" },
  handler: async (input, { actor, services }) => {
    const [author] = await services.db
      .select()
      .from(schema.authors)
      .where(and(eq(schema.authors.siteId, actor.siteId), eq(schema.authors.id, input.id)))
      .limit(1);
    if (!author) throw notFound("Author not found.");

    const references =
      (await authorReferences(services.db, actor.siteId, [author.id])).get(author.id) ??
      ({ asPrimary: 0, asByline: 0 } satisfies AuthorReferences);
    const total = references.asPrimary + references.asByline;

    /**
     * Refuse rather than cascade, and make reassignment the explicit opt-in.
     *
     * The database would happily null the byline out — `primaryAuthorId` is
     * `on delete set null` — and that is precisely the failure worth
     * preventing: forty published posts silently lose their `Person` node and
     * nobody finds out until an author page 404s or a rich result quietly
     * stops appearing. Reassigning without being asked is no better, because
     * it attributes one person's writing to another. So the caller decides,
     * and the refusal carries the counts they need to decide with.
     */
    if (total > 0 && !input.reassignToId) {
      throw preconditionFailed(
        `"${author.name}" is credited on ${total} live ${total === 1 ? "document" : "documents"}. ` +
          "Reassign those credits or deactivate the author instead of deleting.",
        { references, authorId: author.id },
      );
    }

    if (input.reassignToId) {
      if (input.reassignToId === author.id) {
        throw invalidInput("An author cannot be reassigned to themselves.");
      }
      const [target] = await services.db
        .select({ id: schema.authors.id })
        .from(schema.authors)
        .where(
          and(
            eq(schema.authors.siteId, actor.siteId),
            eq(schema.authors.id, input.reassignToId),
          ),
        )
        .limit(1);
      if (!target) throw notFound("Replacement author not found.");
    }

    const replacement = input.reassignToId ?? null;

    return services.db.transaction(async (tx) => {
      if (replacement) {
        const credits = await tx
          .select({ documentId: schema.documentAuthors.documentId })
          .from(schema.documentAuthors)
          .where(eq(schema.documentAuthors.authorId, author.id));

        await tx
          .delete(schema.documentAuthors)
          .where(eq(schema.documentAuthors.authorId, author.id));

        if (credits.length > 0) {
          // The replacement may already be credited on some of these, and the
          // (documentId, authorId) index would reject the duplicate — the
          // merge is a no-op there, not a failure.
          await tx
            .insert(schema.documentAuthors)
            .values(
              credits.map((c) => ({ documentId: c.documentId, authorId: replacement })),
            )
            .onConflictDoNothing();
        }

        await tx
          .update(schema.documents)
          .set({ primaryAuthorId: replacement })
          .where(
            and(
              eq(schema.documents.siteId, actor.siteId),
              eq(schema.documents.primaryAuthorId, author.id),
            ),
          );
      }

      await tx
        .delete(schema.authors)
        .where(and(eq(schema.authors.siteId, actor.siteId), eq(schema.authors.id, author.id)));

      return { id: author.id, name: author.name, reassignedTo: replacement, reassigned: total };
    });
  },
});

// ---------------------------------------------------------------------------
// Taxonomy: tags, categories and entities
// ---------------------------------------------------------------------------

export const listTerms = defineCapability({
  name: "list_terms",
  title: "List taxonomy terms",
  description:
    "Tags, categories or entities for this site, with a usage count per term. Tags and " +
    "categories are how content is filed; entities are what it is *about* — they carry sameAs " +
    "and wikidataId, which is what lets an answer engine reconcile a topic here with the same " +
    "subject elsewhere. Pass `kind` to choose which set you get.",
  input: z.object({
    kind: termKind,
    query: z.string().min(1).max(200).optional(),
  }),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/terms" },
  handler: async (input, { actor, services }) => {
    const needle = input.query?.trim().toLowerCase();
    const matches = (name: string, slug: string) =>
      !needle || name.toLowerCase().includes(needle) || slug.toLowerCase().includes(needle);

    if (input.kind === "tag") {
      const rows = (
        await services.db
          .select()
          .from(schema.tags)
          .where(eq(schema.tags.siteId, actor.siteId))
          .orderBy(asc(schema.tags.name))
      ).filter((t) => matches(t.name, t.slug));
      const usage = await tagUsage(services.db, actor.siteId, rows.map((r) => r.id));
      return {
        kind: input.kind,
        terms: rows.map((row) => ({ ...row, documentCount: usage.get(row.id) ?? 0 })),
      };
    }

    if (input.kind === "category") {
      const rows = (
        await services.db
          .select()
          .from(schema.categories)
          .where(eq(schema.categories.siteId, actor.siteId))
          .orderBy(asc(schema.categories.position), asc(schema.categories.name))
      ).filter((c) => matches(c.name, c.slug));
      const usage = await categoryUsage(services.db, actor.siteId, rows.map((r) => r.id));
      return {
        kind: input.kind,
        terms: rows.map((row) => ({ ...row, documentCount: usage.get(row.id) ?? 0 })),
      };
    }

    const rows = (
      await services.db
        .select()
        .from(schema.entities)
        .where(eq(schema.entities.siteId, actor.siteId))
        .orderBy(asc(schema.entities.name))
    ).filter((e) => matches(e.name, e.slug));
    const usage = await entityUsage(services.db, actor.siteId, rows.map((r) => r.id));
    return {
      kind: input.kind,
      terms: rows.map((row) => ({ ...row, documentCount: usage.get(row.id) ?? 0 })),
    };
  },
});

const termShared = {
  id: z.string().uuid().optional(),
  slug: slugField,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
};

export const upsertTerm = defineCapability({
  name: "upsert_term",
  title: "Create or update a taxonomy term",
  description:
    "Create or edit a tag, a category or an entity. Pass `id` to update, omit it to create. " +
    "Entities additionally take `sameAs` URLs, a `wikidataId` (a Q-number) and a schema.org " +
    "`type` — those three are the reconciliation keys, so an entity without any of them is just " +
    "a tag wearing a different hat.",
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("tag"), ...termShared }),
    z.object({
      kind: z.literal("category"),
      ...termShared,
      parentId: z.string().uuid().nullable().optional(),
      position: z.number().int().min(0).max(9999).optional(),
    }),
    z.object({
      kind: z.literal("entity"),
      ...termShared,
      type: entityType.optional(),
      aliases: z.array(z.string().min(1).max(200)).max(50).optional(),
      sameAs: z.array(z.string().url()).max(25).optional(),
      wikidataId: z
        .string()
        .regex(/^Q[1-9][0-9]*$/, "A Wikidata id looks like Q42.")
        .nullable()
        .optional(),
    }),
  ]),
  scopes: ["taxonomy:write"],
  role: "editor",
  route: { method: "POST", path: "/terms" },
  handler: async (input, { actor, services }) => {
    const shared = {
      slug: input.slug,
      name: input.name,
      ...(input.description !== undefined && { description: input.description }),
    };

    /**
     * The identity rules are the same for all three tables — scoped by site,
     * unique on slug, `not_found` when the id belongs to another tenant — so
     * they are applied once, here, to whatever row the typed branch produced.
     * Writing them out three times is how the third one ends up subtly
     * different from the other two.
     */
    function settle<T>(rows: readonly T[]): { kind: TermKind; term: T } {
      const term = rows[0];
      if (term) return { kind: input.kind, term };
      if (input.id) throw notFound(`No ${input.kind} with that id on this site.`);
      throw conflict(`A ${input.kind} with the slug "${input.slug}" already exists.`);
    }

    if (input.kind === "tag") {
      return settle(
        input.id
          ? await services.db
              .update(schema.tags)
              .set(shared)
              .where(and(eq(schema.tags.siteId, actor.siteId), eq(schema.tags.id, input.id)))
              .returning()
          : await services.db
              .insert(schema.tags)
              .values({ siteId: actor.siteId, ...shared })
              .onConflictDoNothing()
              .returning(),
      );
    }

    if (input.kind === "category") {
      if (input.parentId) {
        // A category that is its own ancestor makes the breadcrumb trail
        // infinite, and the cheapest place to refuse that is here.
        if (input.parentId === input.id) {
          throw invalidInput("A category cannot be its own parent.");
        }
        const [parent] = await services.db
          .select({ id: schema.categories.id })
          .from(schema.categories)
          .where(
            and(
              eq(schema.categories.siteId, actor.siteId),
              eq(schema.categories.id, input.parentId),
            ),
          )
          .limit(1);
        if (!parent) throw notFound("Parent category not found.");
      }

      const values = {
        ...shared,
        ...(input.parentId !== undefined && { parentId: input.parentId }),
        ...(input.position !== undefined && { position: input.position }),
      };

      return settle(
        input.id
          ? await services.db
              .update(schema.categories)
              .set(values)
              .where(
                and(
                  eq(schema.categories.siteId, actor.siteId),
                  eq(schema.categories.id, input.id),
                ),
              )
              .returning()
          : await services.db
              .insert(schema.categories)
              .values({ siteId: actor.siteId, ...values })
              .onConflictDoNothing()
              .returning(),
      );
    }

    const values = {
      ...shared,
      ...(input.type !== undefined && { type: input.type }),
      ...(input.aliases !== undefined && { aliases: input.aliases }),
      ...(input.sameAs !== undefined && { sameAs: input.sameAs }),
      ...(input.wikidataId !== undefined && { wikidataId: input.wikidataId }),
    };

    return settle(
      input.id
        ? await services.db
            .update(schema.entities)
            .set(values)
            .where(
              and(eq(schema.entities.siteId, actor.siteId), eq(schema.entities.id, input.id)),
            )
            .returning()
        : await services.db
            .insert(schema.entities)
            .values({ siteId: actor.siteId, ...values })
            .onConflictDoNothing()
            .returning(),
    );
  },
});

export const deleteTerm = defineCapability({
  name: "delete_term",
  title: "Delete a taxonomy term",
  description:
    "Delete a tag, category or entity. The documents keep their text; only the association is " +
    "removed, and nothing is unpublished. Deleting a term that is still in use is allowed — " +
    "unlike an author, a tag carries no attribution — so the count is worth reading first.",
  input: z.object({ kind: termKind, id: z.string().uuid() }),
  scopes: ["taxonomy:write"],
  role: "editor",
  destructive: true,
  route: { method: "DELETE", path: "/terms/:id" },
  handler: async (input, { actor, services }) => {
    const table =
      input.kind === "tag"
        ? schema.tags
        : input.kind === "category"
          ? schema.categories
          : schema.entities;

    const [deleted] = await services.db
      .delete(table)
      .where(and(eq(table.siteId, actor.siteId), eq(table.id, input.id)))
      .returning({ id: table.id, slug: table.slug, name: table.name });

    if (!deleted) throw notFound(`${input.kind} not found.`);
    return { kind: input.kind, ...deleted };
  },
});

export const tagDocument = defineCapability({
  name: "tag_document",
  title: "Set a document's tags and entities",
  description:
    "Replace, not merge: the document ends up with exactly the tags and entities passed, so " +
    "send an empty array to clear one. Entities may carry a salience from 0 to 1 and at most one " +
    "may be primary — that is the one emitted as the document's main `about` node.",
  input: z.object({
    id: z.string().uuid(),
    tagIds: z.array(z.string().uuid()).max(50).default([]),
    entities: z
      .array(
        z.object({
          id: z.string().uuid(),
          salience: z.number().min(0).max(1).default(0),
          isPrimary: z.boolean().default(false),
        }),
      )
      .max(50)
      .default([]),
  }),
  scopes: ["content:write"],
  role: "author",
  route: { method: "PUT", path: "/documents/:id/tags" },
  handler: async (input, { actor, services }) => {
    const tagIds = [...new Set(input.tagIds)];
    const entityIds = [...new Set(input.entities.map((e) => e.id))];

    if (input.entities.filter((e) => e.isPrimary).length > 1) {
      throw invalidInput("A document can have at most one primary entity.");
    }

    const [doc] = await services.db
      .select({ id: schema.documents.id, createdBy: schema.documents.createdBy })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.siteId, actor.siteId),
          eq(schema.documents.id, input.id),
          isNull(schema.documents.deletedAt),
        ),
      )
      .limit(1);
    if (!doc) throw notFound("Document not found.");
    // An author may tag what they wrote and nothing else; the rank check alone
    // would let them re-file someone else's post.
    assertCanWriteDocument(actor, doc);

    /**
     * Every id is re-checked against this site before it is written.
     *
     * A tag id from another tenant is answered `not_found` — the same answer
     * as a typo — because distinguishing the two would tell the caller which
     * ids exist elsewhere.
     */
    if (tagIds.length > 0) {
      const found = await services.db
        .select({ id: schema.tags.id })
        .from(schema.tags)
        .where(and(eq(schema.tags.siteId, actor.siteId), inArray(schema.tags.id, tagIds)));
      if (found.length !== tagIds.length) throw notFound("One or more tags were not found.");
    }

    if (entityIds.length > 0) {
      const found = await services.db
        .select({ id: schema.entities.id })
        .from(schema.entities)
        .where(
          and(eq(schema.entities.siteId, actor.siteId), inArray(schema.entities.id, entityIds)),
        );
      if (found.length !== entityIds.length) {
        throw notFound("One or more entities were not found.");
      }
    }

    return services.db.transaction(async (tx) => {
      await tx.delete(schema.documentTags).where(eq(schema.documentTags.documentId, doc.id));
      if (tagIds.length > 0) {
        await tx
          .insert(schema.documentTags)
          .values(tagIds.map((tagId) => ({ documentId: doc.id, tagId })));
      }

      await tx
        .delete(schema.documentEntities)
        .where(eq(schema.documentEntities.documentId, doc.id));
      if (input.entities.length > 0) {
        await tx.insert(schema.documentEntities).values(
          input.entities.map((entity) => ({
            documentId: doc.id,
            entityId: entity.id,
            salience: entity.salience,
            isPrimary: entity.isPrimary,
          })),
        );
      }

      return { documentId: doc.id, tagIds, entityIds };
    });
  },
});

// ---------------------------------------------------------------------------
// Redirects
//
// Two tables, deliberately not one. `slugHistory` is written automatically
// when a published slug changes and is a record of something that already
// happened; `redirects` are rules a person wrote down. Merging them would mean
// an editor could "fix" history, and a slug change could clobber a hand-made
// rule.
// ---------------------------------------------------------------------------

export type RedirectOrigin = "manual" | "slug_history";

export interface RedirectRule {
  id: string;
  source: string;
  destination: string;
  origin: RedirectOrigin;
}

export interface RedirectChain {
  from: RedirectRule;
  to: RedirectRule;
}

/**
 * Normalise a path so two spellings of one URL compare equal.
 *
 * A full URL is reduced to its path rather than rejected: pasting the address
 * bar is what people actually do, and a rule stored as
 * `https://example.com/old` would never match the incoming request path.
 * Trailing slashes go, because `/a` and `/a/` are one page and a redirect that
 * fires for only one spelling is worse than none.
 */
export function normalisePath(raw: string): string {
  let value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      value = `${url.pathname}${url.search}`;
    } catch {
      // Fall through: the validator below will reject it with a real message.
    }
  }
  if (!value.startsWith("/")) value = `/${value}`;
  value = value.replace(/\/{2,}/g, "/");
  if (value.length > 1) value = value.replace(/\/+$/, "");
  return value;
}

/** An external destination stays a URL; anything else is a path on this site. */
function isExternalDestination(raw: string): boolean {
  return /^https?:\/\//i.test(raw.trim());
}

/**
 * Chains, across both the manual rules and the automatic slug history.
 *
 * A chain is any rule whose destination is another rule's source: the visitor
 * takes two hops, and each hop is a place a crawler can decide not to follow.
 * Redirects exist to carry a signal from an old URL to a new one, and chaining
 * them is the main way that signal gets spent. Pure so it can be tested
 * directly and reused by the studio without a round trip.
 */
export function detectRedirectChains(rules: readonly RedirectRule[]): RedirectChain[] {
  const bySource = new Map<string, RedirectRule>();
  for (const rule of rules) bySource.set(rule.source, rule);

  const chains: RedirectChain[] = [];
  for (const rule of rules) {
    const next = bySource.get(rule.destination);
    // A rule pointing at itself is a loop, not a chain, and is refused at
    // write time; guarding here keeps a legacy row from reporting as both.
    if (next && next.id !== rule.id) chains.push({ from: rule, to: next });
  }
  return chains;
}

export const listRedirects = defineCapability({
  name: "list_redirects",
  title: "List redirects and slug history",
  description:
    "Both kinds of redirect for this site, kept apart. `redirects` are hand-written rules you " +
    "can edit. `slugHistory` is written automatically whenever a published document's slug " +
    "changes and is a read-only record — there is no capability that edits one. Also returns " +
    "any detected chains, where one rule's destination is another rule's source.",
  input: z.object({ limit: z.number().int().min(1).max(500).default(200) }),
  scopes: ["content:read"],
  role: "editor",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/redirects" },
  handler: async (input, { actor, services }) => {
    const site = await requireSiteRow(services.db, actor.siteId);

    const rules = await services.db
      .select()
      .from(schema.redirects)
      .where(eq(schema.redirects.siteId, actor.siteId))
      .orderBy(asc(schema.redirects.source))
      .limit(input.limit);

    // Joined to `documents` so the screen can say what the old URL resolves to
    // now, rather than showing a slug pair with no context.
    const history = await services.db
      .select({
        id: schema.slugHistory.id,
        oldSlug: schema.slugHistory.oldSlug,
        newSlug: schema.slugHistory.newSlug,
        statusCode: schema.slugHistory.statusCode,
        createdAt: schema.slugHistory.createdAt,
        documentId: schema.slugHistory.documentId,
        documentTitle: schema.documents.title,
        documentSlug: schema.documents.slug,
        documentStatus: schema.documents.status,
      })
      .from(schema.slugHistory)
      .innerJoin(schema.documents, eq(schema.documents.id, schema.slugHistory.documentId))
      .where(eq(schema.slugHistory.siteId, actor.siteId))
      .orderBy(desc(schema.slugHistory.createdAt))
      .limit(input.limit);

    const base = site.blogBasePath.replace(/\/+$/, "");
    const combined: RedirectRule[] = [
      ...rules.map((r) => ({
        id: r.id,
        source: r.source,
        destination: r.destination,
        origin: "manual" as const,
      })),
      ...history.map((h) => ({
        id: h.id,
        source: `${base}/${h.oldSlug}`,
        destination: `${base}/${h.newSlug}`,
        origin: "slug_history" as const,
      })),
    ];

    return {
      redirects: rules,
      slugHistory: history,
      chains: detectRedirectChains(combined),
      blogBasePath: base,
    };
  },
});

export const upsertRedirect = defineCapability({
  name: "upsert_redirect",
  title: "Create or update a redirect",
  description:
    "Write a redirect rule. `source` is always a path on this site; `destination` may be a path " +
    "or an absolute URL. Refuses a rule whose source and destination are the same, which would " +
    "be a loop. Returns a `warnings` array — a chain, where this rule's source is already some " +
    "other rule's destination or vice versa, is reported but not refused, because two hops still " +
    "work and only the caller knows whether the intermediate rule is about to be removed. " +
    "Automatic slug history is a separate, read-only record and is never touched here.",
  input: z.object({
    id: z.string().uuid().optional(),
    source: z.string().min(1).max(2000),
    destination: z.string().min(1).max(2000),
    statusCode: z.union([z.literal(301), z.literal(302), z.literal(307), z.literal(308)]).default(301),
  }),
  scopes: ["content:write"],
  role: "editor",
  route: { method: "POST", path: "/redirects" },
  handler: async (input, { actor, services }) => {
    const source = normalisePath(input.source);
    const external = isExternalDestination(input.destination);
    const destination = external ? input.destination.trim() : normalisePath(input.destination);

    if (!/^\/[^\s]*$/.test(source)) {
      throw invalidInput("A redirect source must be a path on this site, like /old-post.");
    }

    /**
     * A rule from a URL to itself is refused, not stored.
     *
     * It is either a loop the edge will bounce on or dead weight in a table
     * that is consulted on every 404, and the person who typed it meant
     * something else.
     */
    if (source === destination) {
      throw invalidInput("A redirect cannot point at its own source.");
    }

    const neighbours = await services.db
      .select({
        id: schema.redirects.id,
        source: schema.redirects.source,
        destination: schema.redirects.destination,
      })
      .from(schema.redirects)
      .where(
        and(
          eq(schema.redirects.siteId, actor.siteId),
          or(
            eq(schema.redirects.destination, source),
            eq(schema.redirects.source, destination),
          ),
          input.id ? ne(schema.redirects.id, input.id) : undefined,
        ),
      );

    const warnings = neighbours.map((rule) =>
      rule.destination === source
        ? {
            code: "chain_inbound" as const,
            message: `${rule.source} already redirects here, so visitors would take two hops. Point it straight at ${destination}.`,
            via: rule,
          }
        : {
            code: "chain_outbound" as const,
            message: `${destination} itself redirects to ${rule.destination}. Point this rule there instead.`,
            via: rule,
          },
    );

    const values = {
      source,
      destination,
      statusCode: input.statusCode,
      isExternal: external,
    };

    if (input.id) {
      const [updated] = await services.db
        .update(schema.redirects)
        .set(values)
        .where(
          and(eq(schema.redirects.siteId, actor.siteId), eq(schema.redirects.id, input.id)),
        )
        .returning();
      if (!updated) throw notFound("Redirect not found.");
      return { redirect: updated, warnings };
    }

    // Upsert on the source rather than erroring: re-entering a source is
    // always meant as "change where this one goes", never as a new rule the
    // unique index would then reject.
    const [saved] = await services.db
      .insert(schema.redirects)
      .values({ siteId: actor.siteId, ...values })
      .onConflictDoUpdate({
        target: [schema.redirects.siteId, schema.redirects.source],
        set: { destination, statusCode: input.statusCode, isExternal: external },
      })
      .returning();

    return { redirect: saved!, warnings };
  },
});

export const deleteRedirect = defineCapability({
  name: "delete_redirect",
  title: "Delete a redirect",
  description:
    "Remove a hand-written redirect rule. The old URL starts returning 404 again, so anything " +
    "still linking to it loses its destination. Automatic slug-history entries are not rules and " +
    "cannot be deleted here — they record a slug change that actually happened.",
  input: z.object({ id: z.string().uuid() }),
  scopes: ["content:write"],
  role: "editor",
  destructive: true,
  route: { method: "DELETE", path: "/redirects/:id" },
  handler: async (input, { actor, services }) => {
    const [deleted] = await services.db
      .delete(schema.redirects)
      .where(and(eq(schema.redirects.siteId, actor.siteId), eq(schema.redirects.id, input.id)))
      .returning({
        id: schema.redirects.id,
        source: schema.redirects.source,
        destination: schema.redirects.destination,
      });

    if (!deleted) throw notFound("Redirect not found.");
    return deleted;
  },
});

/**
 * Exported as an array for the registry to spread.
 *
 * `index.ts` owns the registry; this file owns the capabilities. Keeping the
 * two apart is what lets several people add capabilities at once without
 * fighting over one import list.
 */
export const editorialCapabilities = [
  listAuthors,
  upsertAuthor,
  deleteAuthor,
  listTerms,
  upsertTerm,
  deleteTerm,
  tagDocument,
  listRedirects,
  upsertRedirect,
  deleteRedirect,
];
