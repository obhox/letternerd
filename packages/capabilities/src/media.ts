import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { conflict, defineCapability, invalidInput, notFound } from "@cms/core";
import { checksumOf, mediaRef, processUpload } from "@cms/media";
import * as schema from "@cms/db/schema";
import { decodeCursor, encodeCursor } from "./shared";

/**
 * Media capabilities.
 *
 * The same three facts shape every handler here. An asset is identified by the
 * hash of its bytes, so uploading a file the site already has is a lookup
 * rather than a pipeline run. A document references an asset as `media://<id>`
 * inside its markdown and nowhere else, so "is this still in use?" is a text
 * search rather than a reference count that can drift. And alt text is a
 * publish gate, so the library has to treat a missing one as work outstanding
 * rather than as an optional field.
 */

/**
 * Matches `packages/media`'s own ceiling, restated here because this layer
 * rejects before allocating anything.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Base64 is the transport because MCP tools speak JSON and cannot send
 * multipart, and the studio's drag-and-drop posts through the same capability
 * rather than growing a second upload path that would need its own limits and
 * its own authorization.
 *
 * The cost is roughly 33% — four transported characters per three real bytes —
 * so the wire limit is the byte limit inflated by that ratio. Enforcing it on
 * the string length matters more than it looks: `Buffer.from(s, "base64")`
 * allocates the decoded buffer before anyone can measure it, so checking after
 * the decode is checking after the memory has already been spent.
 */
const MAX_BASE64_CHARS = Math.ceil(MAX_UPLOAD_BYTES / 3) * 4;

/** Data-URL prefix a browser's `FileReader.readAsDataURL` leaves on the front. */
const DATA_URL_PREFIX = /^data:[^;,]*;base64,/;

/** How many referencing documents a delete refusal names before it says "and N more". */
const REFERENCE_SAMPLE = 5;

/**
 * Reads are scoped to the actor's site, and to nothing else.
 *
 * Unlike documents there is no draft/published split to hide: an asset is
 * either the site's or it is not. A publishable key can therefore read the
 * library, which is what lets a browser bundle resolve a `media://` ref it
 * found in published markdown. Expressed as a `where` fragment for the same
 * reason as `documents.ts` — a handler that forgets cannot reach another
 * tenant's rows.
 */
function visibilityWhere(actor: { siteId: string }) {
  return eq(schema.mediaAssets.siteId, actor.siteId);
}

/**
 * The predicate is written out rather than composed from `isNull`/`eq` so that
 * it is character-for-character the predicate of `media_assets_missing_alt_idx`.
 * Postgres only uses a partial index when it can prove the query's condition
 * implies the index's, and the cheapest way to be sure of that is to write the
 * same expression.
 */
const MISSING_ALT = sql`(${schema.mediaAssets.alt} is null or ${schema.mediaAssets.alt} = '')`;

const variantColumns = {
  id: schema.mediaVariants.id,
  assetId: schema.mediaVariants.assetId,
  key: schema.mediaVariants.key,
  width: schema.mediaVariants.width,
  height: schema.mediaVariants.height,
  format: schema.mediaVariants.format,
  bytes: schema.mediaVariants.bytes,
};

const assetColumns = {
  id: schema.mediaAssets.id,
  key: schema.mediaAssets.key,
  originalFilename: schema.mediaAssets.originalFilename,
  mimeType: schema.mediaAssets.mimeType,
  bytes: schema.mediaAssets.bytes,
  width: schema.mediaAssets.width,
  height: schema.mediaAssets.height,
  blurhash: schema.mediaAssets.blurhash,
  dominantColor: schema.mediaAssets.dominantColor,
  alt: schema.mediaAssets.alt,
  caption: schema.mediaAssets.caption,
  credit: schema.mediaAssets.credit,
  folderId: schema.mediaAssets.folderId,
  checksumSha256: schema.mediaAssets.checksumSha256,
  createdAt: schema.mediaAssets.createdAt,
  updatedAt: schema.mediaAssets.updatedAt,
};

/** Derived from the table rather than from the projection, so nullability survives. */
type AssetRow = Pick<typeof schema.mediaAssets.$inferSelect, keyof typeof assetColumns>;
type VariantRow = Pick<typeof schema.mediaVariants.$inferSelect, keyof typeof variantColumns>;

export interface MediaAssetView extends AssetRow {
  /** The string an author pastes into markdown. Derived, never stored. */
  ref: string;
  variants: VariantRow[];
}

/**
 * Structural, because drizzle gives a transaction a different type from the
 * connection and this runs against both.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type VariantReader = { select: (columns: typeof variantColumns) => any };

/** Attach each asset's rendition ladder in one extra query rather than N. */
async function withVariants(
  db: VariantReader,
  assets: AssetRow[],
): Promise<MediaAssetView[]> {
  if (assets.length === 0) return [];

  const variants: VariantRow[] = await db
    .select(variantColumns)
    .from(schema.mediaVariants)
    .where(inArray(schema.mediaVariants.assetId, assets.map((a) => a.id)))
    .orderBy(asc(schema.mediaVariants.width));

  const byAsset = new Map<string, VariantRow[]>();
  for (const variant of variants) {
    const list = byAsset.get(variant.assetId) ?? [];
    list.push(variant);
    byAsset.set(variant.assetId, list);
  }

  return assets.map((asset) => ({
    ...asset,
    ref: mediaRef(asset.id),
    variants: byAsset.get(asset.id) ?? [],
  }));
}

export const listMedia = defineCapability({
  name: "list_media",
  title: "List media",
  description:
    "A page of this site's media assets, newest first, each with its full rendition ladder and " +
    "its `media://<id>` reference. Pass `missingAltOnly` to get only the assets with no alt " +
    "text — those are the ones that will refuse a publish. `missingAltCount` is returned on " +
    "every call regardless of the filter, so a caller always knows how much of that debt is " +
    "outstanding. Returns a cursor; pass it back as `cursor` for the next page.",
  input: z.object({
    missingAltOnly: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(48),
    cursor: z.string().optional(),
  }),
  scopes: ["media:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/media" },
  handler: async (input, { actor, services }) => {
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;

    const conditions = [visibilityWhere(actor)];
    if (input.missingAltOnly) conditions.push(MISSING_ALT);
    if (cursor) {
      // Keyset on the same (site, createdAt desc) pair the listing index is
      // built on. An offset would silently repeat a row every time someone
      // else uploads while a page is being walked.
      conditions.push(
        or(
          lt(schema.mediaAssets.createdAt, cursor.at),
          and(eq(schema.mediaAssets.createdAt, cursor.at), lt(schema.mediaAssets.id, cursor.id)),
        )!,
      );
    }

    const rows: AssetRow[] = await services.db
      .select(assetColumns)
      .from(schema.mediaAssets)
      .where(and(...conditions))
      .orderBy(desc(schema.mediaAssets.createdAt), desc(schema.mediaAssets.id))
      .limit(input.limit + 1);

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;
    const last = page[page.length - 1];

    /**
     * Counted separately and unconditionally.
     *
     * Deriving it from the page would only ever describe the page, and the
     * number worth showing is the size of the whole queue — an editor filtering
     * to page three of the missing-alt assets still needs to see how many are
     * left overall.
     */
    const [counted] = await services.db
      .select({ missingAlt: sql<number>`count(*)`.mapWith(Number) })
      .from(schema.mediaAssets)
      .where(and(visibilityWhere(actor), MISSING_ALT));

    return {
      assets: await withVariants(services.db, page),
      missingAltCount: counted?.missingAlt ?? 0,
      nextCursor:
        hasMore && last ? encodeCursor({ at: last.createdAt, id: last.id }) : null,
    };
  },
});

export const uploadMedia = defineCapability({
  name: "upload_media",
  title: "Upload media",
  description:
    "Upload one image as base64 and get back the stored asset with every rendition. The bytes " +
    "are hashed first: if this site already has a file with the same checksum the existing " +
    "asset is returned untouched with `deduped: true`, and nothing is re-encoded or re-stored. " +
    "Otherwise the image is decoded, stripped of EXIF, rescaled into the AVIF/WebP ladder and " +
    "written with its variant rows in a single transaction. Rejects anything that is not a " +
    "raster image, and anything over 25 MB decoded. Supply `alt` here if you can — an asset " +
    "with no alt text will refuse to publish in any document that uses it.",
  input: z.object({
    filename: z.string().min(1).max(300),
    // Bounded in the schema as well as in the handler: a string longer than
    // this is rejected before zod hands it on, so nothing oversized is ever
    // copied further into the process.
    contentBase64: z.string().min(1).max(MAX_BASE64_CHARS),
    alt: z.string().max(500).optional(),
    caption: z.string().max(1000).optional(),
    credit: z.string().max(300).optional(),
    folderId: z.string().uuid().optional(),
  }),
  scopes: ["media:write"],
  role: "author",
  route: { method: "POST", path: "/media" },
  handler: async (input, { actor, services }) => {
    const encoded = input.contentBase64.replace(DATA_URL_PREFIX, "");

    // Four base64 characters carry three bytes, so this bounds the decode
    // without performing it. The message quotes the decoded size because that
    // is the number the person looking at the file in Finder recognises.
    const estimatedBytes = Math.floor((encoded.length * 3) / 4);
    if (estimatedBytes > MAX_UPLOAD_BYTES) {
      throw invalidInput(
        `"${input.filename}" is about ${Math.round(estimatedBytes / 1024 / 1024)} MB, which exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024} MB limit.`,
        { estimatedBytes, maxBytes: MAX_UPLOAD_BYTES },
      );
    }

    const buffer = Buffer.from(encoded, "base64");
    if (buffer.byteLength === 0) {
      throw invalidInput(`"${input.filename}" decoded to zero bytes — it is not valid base64.`);
    }

    const checksumSha256 = checksumOf(buffer);

    /**
     * Dedupe before doing any work at all.
     *
     * Re-uploading the same photograph is the normal case, not the edge one:
     * an author drags a folder in twice, or a second post reuses last month's
     * header. Hashing first turns that into a lookup rather than a full decode,
     * five rescales and six object writes — and, more importantly, keeps the
     * two posts pointing at one asset, so fixing its alt text fixes both.
     */
    const [existing] = await services.db
      .select(assetColumns)
      .from(schema.mediaAssets)
      .where(
        and(
          visibilityWhere(actor),
          eq(schema.mediaAssets.checksumSha256, checksumSha256),
        ),
      )
      .limit(1);

    if (existing) {
      const [view] = await withVariants(services.db, [existing]);
      return { asset: view!, deduped: true };
    }

    /**
     * The id is minted here rather than by the database because every object
     * key contains it, and the bytes have to be written before the row can
     * name them.
     */
    const assetId = randomUUID();

    const processed = await processUpload({
      buffer,
      siteId: actor.siteId,
      assetId,
      filename: input.filename,
      storage: services.storage,
      maxBytes: MAX_UPLOAD_BYTES,
    });

    return services.db.transaction(async (tx) => {
      const [asset] = await tx
        .insert(schema.mediaAssets)
        .values({
          id: assetId,
          siteId: actor.siteId,
          key: processed.original.key,
          originalFilename: input.filename,
          mimeType: processed.mimeType,
          bytes: processed.bytes,
          width: processed.width,
          height: processed.height,
          blurhash: processed.blurhash,
          dominantColor: processed.dominantColor,
          alt: input.alt,
          caption: input.caption,
          credit: input.credit,
          folderId: input.folderId,
          checksumSha256,
          uploadedByUserId: actor.kind === "user" ? actor.id : null,
        })
        // Two uploads of the same file can race past the check above, and the
        // unique index is the only thing that actually settles it. Losing that
        // race is not an error — the caller wanted an asset for these bytes and
        // one exists — so the loser reads the winner's row back out.
        .onConflictDoNothing({
          target: [schema.mediaAssets.siteId, schema.mediaAssets.checksumSha256],
        })
        .returning(assetColumns);

      if (!asset) {
        const [raced] = await tx
          .select(assetColumns)
          .from(schema.mediaAssets)
          .where(
            and(
              visibilityWhere(actor),
              eq(schema.mediaAssets.checksumSha256, checksumSha256),
            ),
          )
          .limit(1);
        if (!raced) throw conflict("This file is already being uploaded.");
        const [view] = await withVariants(tx, [raced]);
        return { asset: view!, deduped: true };
      }

      /**
       * Asset and variants in one transaction, always.
       *
       * A committed asset row whose variants never landed is an image that
       * renders a `srcset` full of 404s on a published page. The objects are
       * already in storage by this point and are not transactional — if this
       * rolls back they are orphaned under the asset's prefix, which a sweep
       * reconciles later. Orphaned bytes are recoverable; a half-written asset
       * is a broken page.
       */
      const variants: VariantRow[] =
        processed.variants.length === 0
          ? []
          : await tx
              .insert(schema.mediaVariants)
              .values(
                processed.variants.map((variant) => ({
                  assetId,
                  key: variant.key,
                  width: variant.width,
                  height: variant.height,
                  format: variant.format,
                  bytes: variant.bytes,
                })),
              )
              .returning(variantColumns);

      return {
        asset: { ...asset, ref: mediaRef(asset.id), variants } satisfies MediaAssetView,
        deduped: false,
      };
    });
  },
});

export const setAltText = defineCapability({
  name: "set_alt_text",
  title: "Set alt text",
  description:
    "Set the alt text, caption and credit on one asset. Alt text is the one that matters: it " +
    "is what a screen reader announces and what every text-only consumer of the page reads, " +
    "and a document that uses an asset with no alt text is refused at publish. The alt is " +
    "stored on the asset, so every document already using it is fixed at once. Whitespace " +
    "does not count as alt text.",
  input: z
    .object({
      id: z.string().uuid(),
      alt: z.string().trim().min(1).max(500).optional(),
      caption: z.string().max(1000).nullable().optional(),
      credit: z.string().max(300).nullable().optional(),
    })
    .refine(
      (v) => v.alt !== undefined || v.caption !== undefined || v.credit !== undefined,
      { message: "Provide at least one of `alt`, `caption` or `credit`." },
    ),
  scopes: ["media:write"],
  role: "author",
  route: { method: "PATCH", path: "/media/:id" },
  handler: async (input, { actor, services }) => {
    const [updated] = await services.db
      .update(schema.mediaAssets)
      .set({
        ...(input.alt !== undefined && { alt: input.alt }),
        ...(input.caption !== undefined && { caption: input.caption }),
        ...(input.credit !== undefined && { credit: input.credit }),
        updatedAt: services.now(),
      })
      // The site predicate is in the `where`, not checked after the fetch, so
      // an id from another tenant updates nothing and reads back as missing.
      .where(and(visibilityWhere(actor), eq(schema.mediaAssets.id, input.id)))
      .returning(assetColumns);

    if (!updated) throw notFound("Media asset not found.");
    return { ...updated, ref: mediaRef(updated.id) };
  },
});

export const deleteMedia = defineCapability({
  name: "delete_media",
  title: "Delete media",
  description:
    "Permanently delete an asset, its rendition ladder and its stored objects. Refuses with a " +
    "conflict while any document on this site still references it as `media://<id>` in its " +
    "markdown, and names how many and which ones. There is no soft delete and no undo: remove " +
    "the reference from those documents first, or keep the asset.",
  input: z.object({ id: z.string().uuid() }),
  scopes: ["media:write"],
  role: "editor",
  destructive: true,
  route: { method: "DELETE", path: "/media/:id" },
  handler: async (input, { actor, services }) => {
    const [asset] = await services.db
      .select({ id: schema.mediaAssets.id, key: schema.mediaAssets.key })
      .from(schema.mediaAssets)
      .where(and(visibilityWhere(actor), eq(schema.mediaAssets.id, input.id)))
      .limit(1);

    if (!asset) throw notFound("Media asset not found.");

    /**
     * The in-use check, and why it refuses rather than warns.
     *
     * `media://<id>` in `bodyMd` is the only place a document records that it
     * uses an asset, so a substring scan over the site's document bodies is not
     * an approximation of the truth — it is the truth, and it cannot fall out
     * of step with the text the way a maintained reference count can. It is a
     * sequential scan, which is affordable because deleting media is rare and
     * getting it wrong is not: a published page whose image has been deleted
     * shows an empty box to every reader, and nobody reports it. A stale object
     * in a bucket costs a fraction of a cent.
     *
     * `count(*) over ()` rides along with the sample so the refusal can state
     * the real total in one query rather than guessing from a truncated list.
     */
    const referencing = await services.db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        slug: schema.documents.slug,
        status: schema.documents.status,
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.siteId, actor.siteId),
          isNull(schema.documents.deletedAt),
          sql`position(${mediaRef(asset.id)} in ${schema.documents.bodyMd}) > 0`,
        ),
      )
      .limit(REFERENCE_SAMPLE);

    const total = referencing[0]?.total ?? 0;
    if (total > 0) {
      throw conflict(
        total === 1
          ? `1 document still uses this image. Remove it from that document before deleting the asset.`
          : `${total} documents still use this image. Remove it from all of them before deleting the asset.`,
        {
          referenceCount: total,
          // Named, not just counted: "3 documents" without saying which three
          // leaves the editor grepping their own site.
          documents: referencing.map(({ id, title, slug, status }) => ({
            id,
            title,
            slug,
            status,
          })),
          truncated: total > referencing.length,
        },
      );
    }

    const keys = await services.db.transaction(async (tx) => {
      const removed = await tx
        .delete(schema.mediaVariants)
        .where(eq(schema.mediaVariants.assetId, asset.id))
        .returning({ key: schema.mediaVariants.key });

      await tx
        .delete(schema.mediaAssets)
        .where(and(visibilityWhere(actor), eq(schema.mediaAssets.id, asset.id)));

      return [...removed.map((v) => v.key), asset.key];
    });

    /**
     * Objects go after the transaction commits, and a failure here is
     * swallowed. The rows are the record of what exists; if the bucket delete
     * fails the site is left paying for bytes nothing points at, which a prefix
     * sweep cleans up. Failing the capability instead would leave the caller
     * believing the asset survived when its rows are already gone.
     */
    await services.storage.delete(keys).catch(() => undefined);

    return { id: asset.id, deletedObjects: keys.length };
  },
});

export const mediaCapabilities = [listMedia, uploadMedia, setAltText, deleteMedia];
