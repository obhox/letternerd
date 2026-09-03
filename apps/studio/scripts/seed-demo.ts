import { and, eq, inArray } from "drizzle-orm";
import { requireSite } from "@cms/auth";
import { isCmsError, systemActor, type Actor } from "@cms/core";
import {
  createApiKey,
  createDocument,
  inviteMember,
  publishDocument,
  tagDocument,
  updateDocument,
  uploadMedia,
  upsertAuthor,
  upsertRedirect,
  upsertTerm,
} from "@cms/capabilities";
import * as schema from "@cms/db/schema";
import { closeDb } from "@cms/db";
import { auth } from "../src/lib/auth";
import { db, storage, now } from "../src/server/services";
import { appetiteFor, buildCrawlerTraffic, rollUpDaily, type CrawlTarget } from "./demo/crawlers";
import { documents } from "./demo/documents";
import { renderImage } from "./demo/images";
import {
  authors,
  categories,
  DEFAULT_PASSWORD,
  EDITOR_EMAIL,
  entities,
  images,
  OWNER_EMAIL,
  PENDING_INVITE_EMAIL,
  redirects,
  site,
  SITE_SLUG,
  tags,
} from "./demo/site";
import type {
  AuthorKey,
  CategoryKey,
  DocumentFixture,
  EntityKey,
  MediaSlot,
  TagKey,
} from "./demo/types";

/**
 * Never against production. Both the default credentials below and the demo
 * content exist so a laptop has something to click on; on a public host they
 * are a published password. `--i-know-this-is-production` is the override for
 * an operator who has read this and means it.
 */
if (process.env.NODE_ENV === "production" && !process.argv.includes("--i-know-this-is-production")) {
  console.error(`[${process.argv[1]?.split("/").pop()}] refusing to run with NODE_ENV=production.`);
  process.exit(1);
}


/**
 * Build the Acme demo site: a full corpus a screenshot can be taken of.
 *
 *   pnpm --filter @cms/studio seed-demo
 *   pnpm --filter @cms/studio seed-demo -- --reset
 *   pnpm --filter @cms/studio seed-demo -- --email me@acme.com --password long-enough
 *
 * Everything that has a capability goes through the capability layer, as a
 * system actor. That is not ceremony. `publish_document` is what produces the
 * rendered HTML, the stable heading anchors, the extracted FAQ blocks and the
 * lint report the editor and the Checks panel display — a seed that wrote
 * `body_html` directly would populate a database that the studio can render but
 * that the product could never have produced, and every screenshot taken of it
 * would be of a state no customer can reach.
 *
 * The same reasoning covers the parts that look like they could be shortcut.
 * Images go through `upload_media`, so variants, blurhash and dimensions are
 * genuinely computed and the objects genuinely land in the configured bucket.
 * The renamed post is renamed through `update_document`, so `slug_history` gets
 * an entry the way it would in production rather than an insert nobody's code
 * path ever performs.
 *
 * Four things are written to the database directly, each because no capability
 * covers it. They are called out at their call sites: `sites` (there is no
 * `create_site` — provisioning a tenant is an operator action), the category and
 * cover-image columns on a document, the `in_review` and `archived` status
 * transitions, and the crawler log.
 *
 * Idempotent. Re-running updates in place rather than duplicating, and
 * `--reset` deletes the Acme site and rebuilds it. Neither touches the
 * `spendtab` or `falorb` seed data.
 */

const RESET = process.argv.includes("--reset");

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

const ownerEmail = flag("email") ?? OWNER_EMAIL;
const ownerPassword = flag("password") ?? DEFAULT_PASSWORD;

/** The dense crawler window, and roughly how many rows land inside it. */
const CRAWL_WINDOW_DAYS = 30;
const CRAWL_HITS = 400;

type DocumentRow = typeof schema.documents.$inferSelect;

function log(message: string): void {
  console.log(`[seed-demo] ${message}`);
}

/* ------------------------------------------------------------------ */
/* Site                                                                */
/* ------------------------------------------------------------------ */

/**
 * Create or update the Acme site row directly.
 *
 * There is deliberately no `create_site` capability — standing up a tenant also
 * provisions DNS and a storage prefix, and exposing it to an API key would let
 * a leaked credential mint tenants. `update_site` exists but covers only the
 * subset an owner may change from the studio, which is narrower than what a
 * complete demo needs (`timeZone`, `additionalDomains` and the OG template are
 * all outside it). So this one row is written here.
 */
async function ensureSite(): Promise<typeof schema.sites.$inferSelect> {
  const [existing] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.slug, SITE_SLUG))
    .limit(1);

  if (existing && RESET) {
    await purgeSite(existing.id);
    log(`reset: removed the previous "${SITE_SLUG}" site and its stored objects`);
  }

  const values = {
    slug: site.slug,
    name: site.name,
    baseUrl: site.baseUrl,
    blogBasePath: site.blogBasePath,
    additionalDomains: [...site.additionalDomains],
    locale: site.locale,
    timeZone: site.timeZone,
    orgName: site.orgName,
    orgLogoUrl: site.orgLogoUrl,
    orgSameAs: [...site.orgSameAs],
    twitterHandle: site.twitterHandle,
    feedTitle: site.feedTitle,
    feedDescription: site.feedDescription,
    robotsExtra: site.robotsExtra,
    llmsIntro: site.llmsIntro,
    ogTemplate: site.ogTemplate,
    updatedAt: now(),
  };

  if (existing && !RESET) {
    const [updated] = await db
      .update(schema.sites)
      .set(values)
      .where(eq(schema.sites.id, existing.id))
      .returning();
    return updated!;
  }

  const [created] = await db.insert(schema.sites).values(values).returning();
  return created!;
}

/**
 * Delete the site and everything hanging off it.
 *
 * Foreign keys cascade from `sites`, so one delete clears documents, authors,
 * taxonomy, media rows, memberships, keys and the crawler log. The stored
 * objects do not cascade — nothing in Postgres knows about the bucket — so they
 * are removed first. Leaving them would be harmless but would slowly fill the
 * bucket with orphans that no row names and nothing will ever clean up.
 */
async function purgeSite(siteId: string): Promise<void> {
  const assets = await db
    .select({ id: schema.mediaAssets.id, key: schema.mediaAssets.key })
    .from(schema.mediaAssets)
    .where(eq(schema.mediaAssets.siteId, siteId));

  if (assets.length > 0) {
    const variants = await db
      .select({ key: schema.mediaVariants.key })
      .from(schema.mediaVariants)
      .where(
        inArray(
          schema.mediaVariants.assetId,
          assets.map((asset) => asset.id),
        ),
      );
    const keys = [...assets.map((a) => a.key), ...variants.map((v) => v.key)];
    // Swallowed: a bucket that has already lost the object, or credentials that
    // cannot delete, must not stop the database rebuild the operator asked for.
    await storage.delete(keys).catch(() => undefined);
  }

  await db.delete(schema.sites).where(eq(schema.sites.id, siteId));
}

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

/**
 * A studio login that can actually sign in.
 *
 * Goes through better-auth's own sign-up rather than inserting a user row,
 * for the reason `create-account.ts` gives: the password hash format and the
 * account row carrying it are better-auth's to define, and a hand-rolled hash
 * is a login that only fails when somebody tries it. Verification is then
 * stamped directly, because a demo account has no invitation and this script
 * has no mailbox to complete the round trip from.
 */
async function ensureAccount(email: string, password: string, name: string): Promise<string> {
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  let userId = existing?.id;

  if (userId) {
    log(`account ${email} already exists; leaving its password alone`);
  } else {
    if (password.length < 10) {
      throw new Error("Password must be at least 10 characters — @cms/auth enforces this.");
    }
    const result = await auth.api.signUpEmail({ body: { email, password, name } });
    userId = result.user.id;
    log(`created account ${email}`);
  }

  await db.update(schema.user).set({ emailVerified: true }).where(eq(schema.user.id, userId));
  return userId;
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

/**
 * Draw every image and put it through `upload_media`.
 *
 * The capability hashes the bytes first, so a re-run is a lookup rather than
 * nine rasterisations and fifty object writes — and because the compositions
 * are deterministic, the hash is stable across runs.
 */
async function seedMedia(actor: Actor): Promise<Map<MediaSlot, string>> {
  const bySlot = new Map<MediaSlot, string>();
  let uploaded = 0;

  for (const image of images) {
    const png = await renderImage(image.slot, image.width, image.height);
    const result = await uploadMedia.invoke(
      {
        filename: image.filename,
        contentBase64: png.toString("base64"),
        // Undefined, not null: the one asset without alt text has to arrive at
        // the database with the column unset, which is what the missing-alt
        // queue and the publish gate both key off.
        ...(image.alt === null ? {} : { alt: image.alt }),
        ...(image.caption ? { caption: image.caption } : {}),
        ...(image.credit ? { credit: image.credit } : {}),
      },
      { actor, services: { db, storage, now } },
    );

    bySlot.set(image.slot, result.asset.id);
    if (!result.deduped) uploaded++;
  }

  log(`media: ${images.length} assets (${uploaded} newly uploaded, 1 deliberately without alt text)`);
  return bySlot;
}

/* ------------------------------------------------------------------ */
/* People and taxonomy                                                 */
/* ------------------------------------------------------------------ */

async function seedAuthors(
  actor: Actor,
  media: Map<MediaSlot, string>,
  accounts: Record<"owner" | "editor", string>,
): Promise<Map<AuthorKey, string>> {
  const byKey = new Map<AuthorKey, string>();

  for (const author of authors) {
    const [existing] = await db
      .select({ id: schema.authors.id })
      .from(schema.authors)
      .where(and(eq(schema.authors.siteId, actor.siteId), eq(schema.authors.slug, author.slug)))
      .limit(1);

    const row = await upsertAuthor.invoke(
      {
        ...(existing ? { id: existing.id } : {}),
        slug: author.slug,
        name: author.name,
        ...(author.account ? { userId: accounts[author.account] } : {}),
        ...(author.jobTitle ? { jobTitle: author.jobTitle } : {}),
        ...(author.bioMd ? { bioMd: author.bioMd } : {}),
        ...(author.email ? { email: author.email } : {}),
        ...(author.url ? { url: author.url } : {}),
        ...(author.sameAs ? { sameAs: author.sameAs } : {}),
        ...(author.knowsAbout ? { knowsAbout: author.knowsAbout } : {}),
        ...(author.credentials ? { credentials: author.credentials } : {}),
        ...(author.avatar ? { avatarAssetId: media.get(author.avatar) } : {}),
      },
      { actor, services: { db, storage, now } },
    );

    byKey.set(author.key, row.id);
  }

  log(`authors: ${authors.length} (one left deliberately sparse for the completeness meter)`);
  return byKey;
}

async function seedTaxonomy(actor: Actor): Promise<{
  categories: Map<CategoryKey, string>;
  tags: Map<TagKey, string>;
  entities: Map<EntityKey, string>;
}> {
  const services = { db, storage, now };
  const categoryIds = new Map<CategoryKey, string>();
  const tagIds = new Map<TagKey, string>();
  const entityIds = new Map<EntityKey, string>();

  for (const category of categories) {
    const [existing] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(
        and(eq(schema.categories.siteId, actor.siteId), eq(schema.categories.slug, category.slug)),
      )
      .limit(1);

    const result = await upsertTerm.invoke(
      {
        kind: "category",
        ...(existing ? { id: existing.id } : {}),
        slug: category.slug,
        name: category.name,
        description: category.description,
        position: category.position,
      },
      { actor, services },
    );
    categoryIds.set(category.key, result.term.id);
  }

  for (const tag of tags) {
    const [existing] = await db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.siteId, actor.siteId), eq(schema.tags.slug, tag.slug)))
      .limit(1);

    const result = await upsertTerm.invoke(
      {
        kind: "tag",
        ...(existing ? { id: existing.id } : {}),
        slug: tag.slug,
        name: tag.name,
        description: tag.description,
      },
      { actor, services },
    );
    tagIds.set(tag.key, result.term.id);
  }

  for (const entity of entities) {
    const [existing] = await db
      .select({ id: schema.entities.id })
      .from(schema.entities)
      .where(and(eq(schema.entities.siteId, actor.siteId), eq(schema.entities.slug, entity.slug)))
      .limit(1);

    const result = await upsertTerm.invoke(
      {
        kind: "entity",
        ...(existing ? { id: existing.id } : {}),
        slug: entity.slug,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        ...(entity.aliases ? { aliases: entity.aliases } : {}),
        sameAs: entity.sameAs,
        wikidataId: entity.wikidataId,
      },
      { actor, services },
    );
    entityIds.set(entity.key, result.term.id);
  }

  const reconciled = entities.filter((entity) => entity.wikidataId !== null).length;
  log(
    `taxonomy: ${categories.length} categories, ${tags.length} tags, ${entities.length} entities ` +
      `(${reconciled} with a verified Wikidata id)`,
  );

  return { categories: categoryIds, tags: tagIds, entities: entityIds };
}

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

interface DocumentContext {
  actor: Actor;
  authors: Map<AuthorKey, string>;
  categories: Map<CategoryKey, string>;
  tags: Map<TagKey, string>;
  entities: Map<EntityKey, string>;
  media: Map<MediaSlot, string>;
}

/** `{{media:slot}}` in a fixture becomes the opaque ref the pipeline resolves. */
function resolveMediaRefs(markdown: string, media: Map<MediaSlot, string>): string {
  return markdown.replace(/\{\{media:([A-Za-z]+)\}\}/g, (_match, slot: string) => {
    const id = media.get(slot as MediaSlot);
    if (!id) throw new Error(`Fixture references unknown media slot "${slot}".`);
    return `media://${id}`;
  });
}

function stateTimestamp(fixture: DocumentFixture): Date {
  const state = fixture.state;
  const iso =
    state.kind === "published" || state.kind === "archived"
      ? state.publishedAt
      : state.kind === "scheduled"
        ? state.publishAt
        : state.createdAt;
  return new Date(iso);
}

interface SeedDocumentResult {
  fixture: DocumentFixture;
  row: DocumentRow;
  /** Non-blocking findings the publish returned, for the summary. */
  warnings: number;
  blocked: boolean;
}

async function seedDocument(
  ctx: DocumentContext,
  fixture: DocumentFixture,
): Promise<SeedDocumentResult> {
  const services = { db, storage, now };
  const bodyMd = resolveMediaRefs(fixture.bodyMd, ctx.media);
  const primaryAuthorId = ctx.authors.get(fixture.author);
  if (!primaryAuthorId) throw new Error(`Unknown author key "${fixture.author}".`);

  // A previously-seeded run may hold either slug; the rename below moves one
  // document from the first to the second.
  const candidates = fixture.previousSlug ? [fixture.slug, fixture.previousSlug] : [fixture.slug];
  const [existing] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.siteId, ctx.actor.siteId),
        eq(schema.documents.type, fixture.type),
        inArray(schema.documents.slug, candidates),
      ),
    )
    .limit(1);

  let row: DocumentRow;

  if (!existing) {
    row = await createDocument.invoke(
      {
        type: fixture.type,
        // Created under the slug it originally went live with, so the rename
        // later is a real rename rather than a fabricated history row.
        slug: fixture.previousSlug ?? fixture.slug,
        title: fixture.title,
        description: fixture.description,
        bodyMd,
        primaryAuthorId,
      },
      { actor: ctx.actor, services },
    );
  } else if (
    existing.title !== fixture.title ||
    existing.description !== fixture.description ||
    existing.bodyMd !== bodyMd ||
    existing.primaryAuthorId !== primaryAuthorId
  ) {
    // Only when something actually differs: `update_document` snapshots a
    // revision on every call, and a no-op re-run should not manufacture a
    // revision history nobody wrote.
    row = await updateDocument.invoke(
      {
        id: existing.id,
        title: fixture.title,
        description: fixture.description,
        bodyMd,
        primaryAuthorId,
        note: "Synced from the demo fixtures.",
      },
      { actor: ctx.actor, services },
    );
  } else {
    row = existing;
  }

  await tagDocument.invoke(
    {
      id: row.id,
      tagIds: fixture.tags.map((key) => {
        const id = ctx.tags.get(key);
        if (!id) throw new Error(`Unknown tag key "${key}".`);
        return id;
      }),
      entities: fixture.entities.map((entity) => {
        const id = ctx.entities.get(entity.key);
        if (!id) throw new Error(`Unknown entity key "${entity.key}".`);
        return { id, salience: entity.salience, isPrimary: entity.primary ?? false };
      }),
    },
    { actor: ctx.actor, services },
  );

  /**
   * The byline table, including the reviewer credit.
   *
   * `document_authors` carries co-authors and reviewers, and nothing in the
   * capability layer writes to it yet — `create_document` sets only
   * `primaryAuthorId`. It is worth populating rather than skipping: "reviewed
   * by a named person with a job title and profile links" is an E-E-A-T signal
   * in its own right, and it is what makes the author screen's usage counts
   * distinguish a byline from a review credit.
   */
  const bylines = [{ authorId: primaryAuthorId, role: "author", position: 0 }];
  if (fixture.reviewer) {
    const reviewerId = ctx.authors.get(fixture.reviewer);
    if (!reviewerId) throw new Error(`Unknown reviewer key "${fixture.reviewer}".`);
    bylines.push({ authorId: reviewerId, role: "reviewer", position: 1 });
  }
  await db.delete(schema.documentAuthors).where(eq(schema.documentAuthors.documentId, row.id));
  await db
    .insert(schema.documentAuthors)
    .values(bylines.map((byline) => ({ documentId: row.id, ...byline })));

  /**
   * Category, cover image and the backdated publication timestamps, written
   * directly because nothing in the capability layer sets them.
   *
   * `categoryId` and `coverAssetId` have no capability at all today — the
   * studio's editor sets them through a server action that does not exist yet,
   * and inventing one here would be inventing API surface.
   *
   * The timestamps are the more interesting case. `publish_document` reads
   * `doc.publishedAt ?? now()`, so seeding the backdated value *before* the
   * publish is what makes the publish preserve it rather than overwrite it —
   * a demo corpus that all went live in the same second has no history for the
   * dashboard or the archive to show.
   */
  const when = stateTimestamp(fixture);
  const isLive = fixture.state.kind === "published" || fixture.state.kind === "archived";
  await db
    .update(schema.documents)
    .set({
      ...(fixture.category ? { categoryId: ctx.categories.get(fixture.category) ?? null } : {}),
      ...(fixture.cover ? { coverAssetId: ctx.media.get(fixture.cover) ?? null } : {}),
      createdAt: when,
      ...(isLive ? { publishedAt: when, firstPublishedAt: when } : {}),
    })
    .where(eq(schema.documents.id, row.id));

  let warnings = 0;
  let blocked = false;

  if (isLive || fixture.state.kind === "scheduled" || fixture.expectBlocked) {
    const publishAt = fixture.state.kind === "scheduled" ? fixture.state.publishAt : undefined;
    try {
      const published = await publishDocument.invoke(
        { id: row.id, ...(publishAt ? { publishAt } : {}) },
        { actor: ctx.actor, services },
      );
      row = published.document;
      warnings = published.lints.length;
      if (fixture.expectBlocked) {
        throw new Error(
          `"${fixture.slug}" was expected to be refused by the lint gate but published cleanly. ` +
            "The demo needs one document in the refused state; check that its image still has no alt text.",
        );
      }
    } catch (error) {
      // A refusal here is the gate working, and it is what this fixture exists
      // to demonstrate. Anything else is a real failure and is re-thrown.
      if (fixture.expectBlocked && isCmsError(error) && error.code === "precondition_failed") {
        blocked = true;
      } else {
        throw error;
      }
    }
  }

  /**
   * The rename, and the automatic redirect it writes.
   *
   * Done after the publish because `update_document` only records slug history
   * for a document that has been published — a draft has no URL anyone could
   * have linked to. Republishing afterwards refreshes the canonical URL baked
   * into the rendered output, which is what an editor doing this by hand would
   * end up with too.
   */
  if (fixture.previousSlug && row.slug === fixture.previousSlug) {
    row = await updateDocument.invoke(
      {
        id: row.id,
        slug: fixture.slug,
        note: "Renamed to the plural; the old URL now redirects.",
      },
      { actor: ctx.actor, services },
    );
    const republished = await publishDocument.invoke(
      { id: row.id },
      { actor: ctx.actor, services },
    );
    row = republished.document;
    log(`renamed /${fixture.previousSlug} to /${fixture.slug} — slug history recorded`);
  }

  /**
   * The two status transitions with no capability behind them.
   *
   * `in_review` has no capability today: submitting for review is a studio
   * action that has not been built. `archived` is reachable only through
   * `delete_document`, which also sets `deletedAt` — that is a soft delete, and
   * it would hide the document from every listing, which is the opposite of
   * what an archived post should do.
   */
  const finalStatus =
    fixture.state.kind === "in_review"
      ? "in_review"
      : fixture.state.kind === "archived"
        ? "archived"
        : null;

  // `updatedAt` is set last, and set to a plausible moment shortly after
  // publication: every listing sorts on it, and leaving all twenty-one rows
  // stamped with the same second makes the list order arbitrary.
  const updatedAt = new Date(when.getTime() + 45 * 60_000);
  const [settled] = await db
    .update(schema.documents)
    .set({
      ...(finalStatus ? { status: finalStatus } : {}),
      updatedAt,
      ...(isLive ? { dateModified: updatedAt } : {}),
    })
    .where(eq(schema.documents.id, row.id))
    .returning();

  return { fixture, row: settled ?? row, warnings, blocked };
}

/* ------------------------------------------------------------------ */
/* Crawler log                                                         */
/* ------------------------------------------------------------------ */

/**
 * Written directly, because a crawler hit is an observation rather than an
 * action: it is recorded by the edge middleware on a request the CMS did not
 * make, and there is no capability for "pretend a bot came" for the same reason
 * there is no capability for "pretend a user signed in".
 */
async function seedCrawlerHits(
  siteId: string,
  blogBasePath: string,
  published: SeedDocumentResult[],
): Promise<{ rows: number; days: number }> {
  const targets: CrawlTarget[] = published
    .filter((entry) => entry.fixture.type !== "block")
    .map((entry) => ({
      documentId: entry.row.id,
      slug: entry.fixture.slug,
      path:
        entry.fixture.type === "post"
          ? `${blogBasePath}/${entry.fixture.slug}`
          : `/${entry.fixture.slug}`,
      firstPublishedAt: entry.row.firstPublishedAt,
    }));

  const rows = buildCrawlerTraffic({
    targets,
    now: now(),
    days: CRAWL_WINDOW_DAYS,
    hits: CRAWL_HITS,
  });

  // Rebuilt rather than appended to. The generator is deterministic, so a
  // re-run should reproduce the same log; appending would double every bar on
  // the chart each time somebody ran the script twice.
  await db.delete(schema.crawlerHits).where(eq(schema.crawlerHits.siteId, siteId));
  await db.delete(schema.crawlerHitsDaily).where(eq(schema.crawlerHitsDaily.siteId, siteId));

  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(schema.crawlerHits).values(
      rows.slice(i, i + CHUNK).map((row) => ({
        siteId,
        documentId: row.documentId,
        botName: row.botName,
        botCategory: row.botCategory,
        userAgent: row.userAgent,
        path: row.path,
        statusCode: row.statusCode,
        referer: row.referer,
        ipHash: row.ipHash,
        occurredAt: row.occurredAt,
      })),
    );
  }

  const daily = rollUpDaily(rows);
  for (let i = 0; i < daily.length; i += CHUNK) {
    await db
      .insert(schema.crawlerHitsDaily)
      .values(daily.slice(i, i + CHUNK).map((entry) => ({ siteId, ...entry })));
  }

  const neverFetched = targets.filter((target) => appetiteFor(target.slug) === 0).length;
  log(
    `crawler log: ${rows.length} hits across 5 bots, ${daily.length} rollup rows, ` +
      `${neverFetched} published documents deliberately never fetched`,
  );

  return { rows: rows.length, days: CRAWL_WINDOW_DAYS };
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const API_KEYS = [
  { name: "acme.com website", type: "publishable" as const, origins: ["https://acme.com"] },
  { name: "Reporting warehouse", type: "read" as const, origins: [] },
  { name: "Content automation", type: "admin" as const, origins: [] },
];

async function seedApiKeys(actor: Actor): Promise<{ name: string; plaintext: string }[]> {
  const issued: { name: string; plaintext: string }[] = [];

  for (const key of API_KEYS) {
    const [existing] = await db
      .select({ id: schema.apiKeys.id })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.siteId, actor.siteId), eq(schema.apiKeys.name, key.name)))
      .limit(1);

    // The plaintext exists exactly once, at creation. Re-issuing on every run
    // would invalidate whatever anyone had already pasted into a consuming app.
    if (existing) continue;

    const result = await createApiKey.invoke(
      { name: key.name, type: key.type, allowedOrigins: key.origins },
      { actor, services: { db, storage, now } },
    );
    issued.push({ name: key.name, plaintext: result.plaintext });
  }

  return issued;
}

async function seedRedirects(actor: Actor): Promise<number> {
  for (const rule of redirects) {
    await upsertRedirect.invoke(rule, { actor, services: { db, storage, now } });
  }
  return redirects.length;
}

/**
 * Issued as the owner, not as the system actor.
 *
 * An invitation records who sent it, and `site_invitations.invited_by_user_id`
 * is a foreign key into `user` — so `system:seed-demo` fails the constraint.
 * That is the schema being right rather than the capability being awkward: an
 * invitation with no accountable sender is exactly the kind of seat grant
 * nobody wants to find in an audit. Resolving a real owner actor through
 * `requireSite` is the same path the studio takes.
 */
async function seedInvitation(actor: Actor): Promise<string | null> {
  const [existing] = await db
    .select({ id: schema.siteInvitations.id })
    .from(schema.siteInvitations)
    .where(
      and(
        eq(schema.siteInvitations.siteId, actor.siteId),
        eq(schema.siteInvitations.email, PENDING_INVITE_EMAIL),
      ),
    )
    .limit(1);

  // The token is stored only as a digest, so an existing invitation's link
  // cannot be reconstructed — and minting a second one would leave two live
  // tokens for one seat.
  if (existing) return null;

  const result = await inviteMember.invoke(
    { email: PENDING_INVITE_EMAIL, role: "editor" },
    { actor, services: { db, storage, now } },
  );
  return result.acceptPath;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const siteRow = await ensureSite();
  const actor = systemActor(siteRow.id, "seed-demo");
  log(`site: ${siteRow.name} (${siteRow.slug}) at ${siteRow.baseUrl}`);

  const ownerId = await ensureAccount(ownerEmail, ownerPassword, "Maya Oduya");
  const editorId = await ensureAccount(EDITOR_EMAIL, DEFAULT_PASSWORD, "Daniel Reyes");
  await db
    .insert(schema.siteMembers)
    .values([
      { siteId: siteRow.id, userId: ownerId, role: "owner" as const },
      { siteId: siteRow.id, userId: editorId, role: "editor" as const },
    ])
    // Re-running must not silently demote an owner to whatever is listed here.
    .onConflictDoNothing();

  const media = await seedMedia(actor);
  const authorIds = await seedAuthors(actor, media, { owner: ownerId, editor: editorId });
  const taxonomy = await seedTaxonomy(actor);

  /**
   * The site's own defaults, once the rows they point at exist.
   *
   * Both columns are nullable and both are visible on the settings screen, so
   * leaving them empty would put two "not set" rows on the first screen anyone
   * opens.
   */
  await db
    .update(schema.sites)
    .set({
      defaultAuthorId: authorIds.get("maya") ?? null,
      defaultOgAssetId: media.get("coverExpensePolicy") ?? null,
    })
    .where(eq(schema.sites.id, siteRow.id));

  const ctx: DocumentContext = {
    actor,
    authors: authorIds,
    categories: taxonomy.categories,
    tags: taxonomy.tags,
    entities: taxonomy.entities,
    media,
  };

  const results: SeedDocumentResult[] = [];
  for (const fixture of documents) {
    results.push(await seedDocument(ctx, fixture));
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const byStatus = new Map<string, number>();
  for (const result of results) {
    byStatus.set(result.row.status, (byStatus.get(result.row.status) ?? 0) + 1);
  }
  const gated = results.filter((r) => r.blocked);
  const attemptedPublishes = results.filter(
    (r) => r.fixture.state.kind !== "draft" && r.fixture.state.kind !== "in_review",
  ).length;

  log(
    `documents: ${results.length} — ` +
      [...byStatus.entries()].map(([status, count]) => `${count} ${status}`).join(", "),
  );
  log(
    `publish gate: ${attemptedPublishes} of ${attemptedPublishes} intended publishes passed; ` +
      `${gated.length} draft refused as designed`,
  );

  const live = results.filter(
    (r) => r.fixture.state.kind === "published" || r.fixture.state.kind === "archived",
  );
  const crawl = await seedCrawlerHits(siteRow.id, siteRow.blogBasePath, live);

  const redirectCount = await seedRedirects(actor);
  const keys = await seedApiKeys(actor);
  const { actor: ownerActor } = await requireSite({
    db,
    session: { userId: ownerId },
    site: siteRow.slug,
  });
  const acceptPath = await seedInvitation(ownerActor);

  console.log("");
  console.log("  Sign in at   http://localhost:3000/sign-in");
  console.log(`  Email        ${ownerEmail}`);
  console.log(`  Password     ${ownerPassword}`);
  console.log(`  Second seat  ${EDITOR_EMAIL} / ${DEFAULT_PASSWORD} (editor)`);
  console.log(`  Site         ${siteRow.name} — slug "${siteRow.slug}", at ${siteRow.baseUrl}`);
  console.log(`  Studio       http://localhost:3000/${siteRow.slug}`);
  console.log("");
  console.log(`  ${results.length} documents, ${images.length} media assets, ${authors.length} authors`);
  console.log(
    `  ${categories.length} categories, ${tags.length} tags, ${entities.length} entities`,
  );
  console.log(
    `  ${redirectCount} manual redirects plus 1 automatic slug-history entry`,
  );
  console.log(`  ${crawl.rows} crawler hits across the last ${crawl.days} days`);
  if (acceptPath) {
    console.log(`  Pending invite for ${PENDING_INVITE_EMAIL}:`);
    console.log(`    http://localhost:3000${acceptPath}`);
  }
  if (keys.length > 0) {
    console.log("");
    console.log("  API keys (shown once — only a digest is stored):");
    for (const key of keys) console.log(`    ${key.name.padEnd(22)} ${key.plaintext}`);
  }
  console.log("");

  await closeDb();
}

main().catch(async (error) => {
  console.error("[seed-demo] failed:", error instanceof Error ? error.message : error);
  if (isCmsError(error) && Object.keys(error.details).length > 0) {
    console.error("[seed-demo] details:", JSON.stringify(error.details, null, 2));
  }
  await closeDb().catch(() => {});
  process.exit(1);
});
