import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { authors } from "./authors";
import { sites } from "./tenancy";
import { tsvector } from "./types";

export const documentTypeEnum = pgEnum("document_type", ["post", "page", "block"]);
export const documentStatusEnum = pgEnum("document_status", [
  "draft",
  "in_review",
  "scheduled",
  "published",
  "archived",
]);

/**
 * Posts, pages and reusable blocks in one table.
 *
 * All three need slugs, revisions, SEO fields, media references and lints;
 * three parallel tables would triple that surface and guarantee the three
 * drift. They differ only in how they are addressed — posts by `slug` and
 * ordered by `publishedAt`, pages by `path`, blocks by `key` — and in whether
 * they appear in feeds.
 *
 * `bodyMd` is the source of truth. The four derived columns are produced by a
 * single pipeline pass at publish time, which is what lets the editor preview,
 * the lint gate and the published HTML be the same code rather than three
 * approximations of each other.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: documentTypeEnum("type").notNull().default("post"),
    status: documentStatusEnum("status").notNull().default("draft"),

    /** Addressing. Exactly one is meaningful per `type`. */
    slug: text("slug").notNull(),
    path: text("path"),
    key: text("key"),

    title: text("title").notNull().default(""),
    subtitle: text("subtitle"),
    /** <meta name="description">. 120–158 characters; linted, not truncated. */
    description: text("description"),
    /** Listing-card copy, which is not the same job as a meta description. */
    excerpt: text("excerpt"),

    // --- source of truth ----------------------------------------------------
    bodyMd: text("body_md").notNull().default(""),

    // --- derived, all four from one pipeline run ----------------------------
    bodyHtml: text("body_html"),
    /** Plain text: readability lints, full-text search, llms-full.txt. */
    bodyText: text("body_text"),
    /**
     * The markdown served to LLM fetchers at /blog/<slug>.md.
     *
     * Not a copy of `bodyMd`: media refs are resolved to absolute CDN URLs,
     * relative links are absolutised against the site's baseUrl, directives
     * are flattened into plain headings, and YAML frontmatter carrying the
     * canonical URL, author and dates is prepended.
     */
    bodyMdPublic: text("body_md_public"),
    /** [{ depth, text, id, aliases[] }] — the anchor contract. See below. */
    headings: jsonb("headings").notNull().default([]),

    wordCount: integer("word_count").notNull().default(0),
    readingTimeMinutes: integer("reading_time_minutes").notNull().default(1),

    /** Behind `sites.renderVersion` means this row needs a re-render. */
    renderVersion: integer("render_version").notNull().default(0),
    renderedAt: timestamp("rendered_at", { withTimezone: true }),
    /** sha256(bodyMd + pipeline version). Lets the backfill skip no-op work. */
    contentHash: text("content_hash"),

    // --- AEO surfaces -------------------------------------------------------
    tldr: text("tldr"),
    keyTakeaways: text("key_takeaways").array().notNull().default([]),

    // --- SEO ----------------------------------------------------------------
    primaryAuthorId: uuid("primary_author_id").references(() => authors.id, {
      onDelete: "set null",
    }),
    categoryId: uuid("category_id"),
    coverAssetId: uuid("cover_asset_id"),
    ogAssetId: uuid("og_asset_id"),
    /** Regenerate the OG card only when its inputs actually changed. */
    ogGeneratedHash: text("og_generated_hash"),
    /** For syndicated or republished content that canonicalises elsewhere. */
    canonicalUrlOverride: text("canonical_url_override"),
    noindex: boolean("noindex").notNull().default(false),
    /** ogTitle, twitterTitle, robots directives — narrow, per-document. */
    seoOverrides: jsonb("seo_overrides").notNull().default({}),

    // --- lifecycle ----------------------------------------------------------
    publishedAt: timestamp("published_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    /** → dateModified. Distinct from updatedAt, which changes on any save. */
    dateModified: timestamp("date_modified", { withTimezone: true }),
    firstPublishedAt: timestamp("first_published_at", { withTimezone: true }),

    /** Non-blocking findings, so lists can show a quality badge. */
    lintReport: jsonb("lint_report").notNull().default({}),

    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`setweight(to_tsvector('english', coalesce(title, '')), 'A') || setweight(to_tsvector('english', coalesce(description, '')), 'B') || setweight(to_tsvector('english', coalesce(body_text, '')), 'C')`,
    ),
  },
  (t) => [
    /**
     * Partial, so a soft-deleted document does not squat its slug forever.
     * Re-publishing under a reclaimed slug is a normal editorial action.
     */
    uniqueIndex("documents_site_type_slug_uq")
      .on(t.siteId, t.type, t.slug)
      .where(sql`deleted_at is null`),

    /**
     * The listing index. Serves /v1/posts, the sitemap, every feed and
     * llms.txt, and keyset pagination rides it exactly.
     */
    index("documents_site_published_idx")
      .on(t.siteId, t.publishedAt.desc())
      .where(sql`status = 'published' and deleted_at is null`),

    index("documents_site_status_updated_idx").on(t.siteId, t.status, t.updatedAt.desc()),

    /** The scheduler's only query — scanned every minute, so keep it tiny. */
    index("documents_scheduled_idx")
      .on(t.scheduledFor)
      .where(sql`status = 'scheduled'`),

    index("documents_search_idx").using("gin", t.searchVector),
    index("documents_render_stale_idx").on(t.siteId, t.renderVersion),
  ],
);

/** Multi-byline, including reviewers — `reviewedBy` is an E-E-A-T signal. */
export const documentAuthors = pgTable(
  "document_authors",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => authors.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("author"),
    position: smallint("position").notNull().default(0),
  },
  (t) => [
    uniqueIndex("document_authors_pk").on(t.documentId, t.authorId),
    index("document_authors_author_idx").on(t.authorId),
  ],
);

export const documentRevisions = pgTable(
  "document_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title"),
    description: text("description"),
    bodyMd: text("body_md").notNull(),
    /** Everything else worth restoring, so a rollback is not partial. */
    snapshot: jsonb("snapshot").notNull().default({}),
    note: text("note"),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("document_revisions_number_uq").on(t.documentId, t.revisionNumber),
    index("document_revisions_doc_idx").on(t.documentId, t.createdAt.desc()),
  ],
);

/**
 * Every slug a document has ever had.
 *
 * Written inside the same transaction as the slug change — never optional,
 * never a checkbox an editor can forget. The unique constraint on
 * (siteId, oldSlug) is what makes the redirect lookup a single indexed read
 * and enforces that one old URL resolves to exactly one destination.
 */
export const slugHistory = pgTable(
  "slug_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    oldSlug: text("old_slug").notNull(),
    newSlug: text("new_slug").notNull(),
    statusCode: smallint("status_code").notNull().default(301),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("slug_history_site_old_uq").on(t.siteId, t.oldSlug)],
);

/** Hand-written rules, kept separate so a slug change cannot clobber one. */
export const redirects = pgTable(
  "redirects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    destination: text("destination").notNull(),
    statusCode: smallint("status_code").notNull().default(301),
    isExternal: boolean("is_external").notNull().default(false),
    hits: integer("hits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("redirects_site_source_uq").on(t.siteId, t.source)],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    parentId: uuid("parent_id"),
    position: smallint("position").notNull().default(0),
  },
  (t) => [uniqueIndex("categories_site_slug_uq").on(t.siteId, t.slug)],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [uniqueIndex("tags_site_slug_uq").on(t.siteId, t.slug)],
);

export const documentTags = pgTable(
  "document_tags",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("document_tags_pk").on(t.documentId, t.tagId),
    index("document_tags_tag_idx").on(t.tagId, t.documentId),
  ],
);

/**
 * Named things the content is *about*, as opposed to how it is filed.
 *
 * Tags are taxonomy; entities are the schema.org `about` graph. `sameAs` and
 * `wikidataId` are what let an answer engine reconcile "Postgres" here with
 * the same subject elsewhere, which is the whole mechanism behind GEO.
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    /** schema.org type: Thing, Product, Organization, Place, SoftwareApplication. */
    type: text("type").notNull().default("Thing"),
    description: text("description"),
    aliases: text("aliases").array().notNull().default([]),
    sameAs: text("same_as").array().notNull().default([]),
    wikidataId: text("wikidata_id"),
  },
  (t) => [
    uniqueIndex("entities_site_slug_uq").on(t.siteId, t.slug),
    index("entities_wikidata_idx").on(t.wikidataId),
  ],
);

export const documentEntities = pgTable(
  "document_entities",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    /** 0–1. Drives `about` selection and internal-link scoring. */
    salience: real("salience").notNull().default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (t) => [
    uniqueIndex("document_entities_pk").on(t.documentId, t.entityId),
    index("document_entities_entity_idx").on(t.entityId, t.salience.desc()),
  ],
);

/**
 * Q&A extracted from `:::faq` directives.
 *
 * Stored structurally rather than re-parsed at emit time, so the visible page
 * and the FAQPage JSON-LD are built from one source and cannot disagree.
 * Google requires the answer to appear in the visible body; the publish gate
 * enforces it, because FAQ markup that does not match the page is the usual
 * reason a site loses the rich result.
 */
export const qaBlocks = pgTable(
  "qa_blocks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: smallint("position").notNull().default(0),
    question: text("question").notNull(),
    answerMd: text("answer_md").notNull(),
    answerHtml: text("answer_html"),
    /** Frozen once assigned, so a cited deep link keeps resolving. */
    anchorId: text("anchor_id").notNull(),
    kind: text("kind").notNull().default("faq"),
  },
  (t) => [index("qa_blocks_doc_idx").on(t.documentId, t.position)],
);

export const structuredData = pgTable(
  "structured_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** BlogPosting, FAQPage, HowTo, Speakable, BreadcrumbList. */
    type: text("type").notNull(),
    /** auto | override | disabled */
    mode: text("mode").notNull().default("auto"),
    payload: jsonb("payload").notNull().default({}),
    validatedAt: timestamp("validated_at", { withTimezone: true }),
    validationErrors: jsonb("validation_errors").notNull().default([]),
  },
  (t) => [uniqueIndex("structured_data_doc_type_uq").on(t.documentId, t.type)],
);

/**
 * Computed nightly. Favours orphan and low-inbound targets deliberately —
 * that is where an internal link actually changes anything.
 */
export const internalLinkSuggestions = pgTable(
  "internal_link_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    targetDocumentId: uuid("target_document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    anchorText: text("anchor_text").notNull(),
    snippet: text("snippet"),
    score: real("score").notNull().default(0),
    /** pending | accepted | dismissed */
    status: text("status").notNull().default("pending"),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("internal_link_suggestions_uq").on(
      t.sourceDocumentId,
      t.targetDocumentId,
      t.anchorText,
    ),
    index("internal_link_suggestions_source_idx").on(
      t.sourceDocumentId,
      t.status,
      t.score.desc(),
    ),
  ],
);
