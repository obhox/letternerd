import { and, eq } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import { notFound, invalidInput } from "@cms/core";
import type { Database } from "@cms/db";
import * as schema from "@cms/db/schema";
import type { StorageService } from "@cms/media";

/**
 * The site row, which almost every capability needs for its baseUrl.
 *
 * Fetched by the id already resolved onto the Actor, never by anything the
 * caller supplied — that is the property that makes cross-tenant access
 * unreachable rather than merely guarded against.
 */
export async function requireSiteRow(db: Database, siteId: string) {
  const [site] = await db.select().from(schema.sites).where(eq(schema.sites.id, siteId)).limit(1);
  if (!site) throw notFound("Site not found.");
  return site;
}

/** Media keys become public URLs in exactly one place. */
export function cdnUrlFactory(storage: StorageService) {
  return (key: string) => storage.publicUrl(key);
}

export interface Cursor {
  at: Date;
  id: string;
}

/**
 * Opaque keyset cursors.
 *
 * Base64 of the sort key rather than an offset: it rides the ordering index
 * directly and stays correct when rows are inserted mid-pagination, which
 * offset pagination does not — it silently repeats or skips a row. Opaque
 * because a caller that starts arithmetic on a page number will eventually
 * depend on it.
 */
export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify({ at: c.at.toISOString(), id: c.id })).toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      at: string;
      id: string;
    };
    const at = new Date(parsed.at);
    if (Number.isNaN(at.getTime()) || typeof parsed.id !== "string") throw new Error();
    return { at, id: parsed.id };
  } catch {
    // A malformed cursor is the caller's bug, not an empty result set: silently
    // returning page one would look like "no more data" and truncate an export.
    throw invalidInput("Malformed pagination cursor.");
  }
}

/**
 * A referenced row must belong to this site.
 *
 * Any capability input that names another row by id — an author for a byline,
 * a folder for an upload, an asset for an avatar — is a place where a caller
 * on one site can point at a row on another. The foreign key alone does not
 * stop that; only a predicate on `site_id` does. The miss is answered as
 * `not_found`, the same as a typo, because distinguishing the two would tell
 * the caller which ids exist elsewhere. `tag_document` established the rule;
 * this is it, once, for everything else.
 */
/** A database or a transaction: anything that can run a SELECT. */
type Queryable = Pick<Database, "select">;

export async function requireSiteOwnedRow(
  db: Queryable,
  table: AnyPgTable,
  columns: { id: AnyPgColumn; siteId: AnyPgColumn },
  id: string,
  siteId: string,
  what: string,
): Promise<void> {
  const [row] = await db
    .select({ id: columns.id })
    .from(table)
    .where(and(eq(columns.siteId, siteId), eq(columns.id, id)))
    .limit(1);
  if (!row) throw notFound(`${what} not found.`);
}
