import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, closeDb, type Database } from "../index.js";
import { generateApiKey, keyTypeOf, verifyApiKey } from "../api-keys.js";
import * as schema from "../schema/index.js";

/**
 * Integration tests against a real Postgres.
 *
 * These assert the things only the database can enforce — partial unique
 * indexes, generated columns, keyset pagination under concurrent writes.
 * Mocking them would test the mock. CI provides DATABASE_URL; locally, run
 * `pnpm infra:up` first, and the suite skips rather than fails without one.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

let db: Database;
const siteIds: string[] = [];

async function makeSite(label: string): Promise<string> {
  const suffix = randomUUID().slice(0, 8);
  const [row] = await db
    .insert(schema.sites)
    .values({
      slug: `${label}-${suffix}`,
      name: label,
      baseUrl: `https://${label}-${suffix}.example`,
    })
    .returning();
  if (!row) throw new Error("site insert returned nothing");
  siteIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  if (!hasDb) return;
  db = createDb();
});

afterAll(async () => {
  if (!hasDb) return;
  for (const id of siteIds) {
    await db.delete(schema.sites).where(eq(schema.sites.id, id));
  }
  await closeDb();
});

d("slug uniqueness", () => {
  it("allows the same slug on two different sites", async () => {
    const a = await makeSite("uniq-a");
    const b = await makeSite("uniq-b");
    await db.insert(schema.documents).values([
      { siteId: a, type: "post", slug: "shared", title: "A" },
      { siteId: b, type: "post", slug: "shared", title: "B" },
    ]);
    const rows = await db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.slug, "shared"));
    expect(rows.filter((r) => r.siteId === a || r.siteId === b)).toHaveLength(2);
  });

  it("rejects a duplicate live slug on one site", async () => {
    const s = await makeSite("dupe");
    await db
      .insert(schema.documents)
      .values({ siteId: s, type: "post", slug: "x", title: "First" });
    await expect(
      db.insert(schema.documents).values({ siteId: s, type: "post", slug: "x", title: "Second" }),
    ).rejects.toThrow();
  });

  it("frees the slug once a document is soft-deleted", async () => {
    const s = await makeSite("reclaim");
    await db
      .insert(schema.documents)
      .values({ siteId: s, type: "post", slug: "y", title: "Old" });
    await db
      .update(schema.documents)
      .set({ deletedAt: new Date() })
      .where(and(eq(schema.documents.siteId, s), eq(schema.documents.slug, "y")));

    // A soft-deleted document must not squat its slug forever; re-publishing
    // under a reclaimed slug is a normal editorial action.
    await expect(
      db.insert(schema.documents).values({ siteId: s, type: "post", slug: "y", title: "New" }),
    ).resolves.toBeDefined();
  });

  it("separates the namespaces of posts, pages and blocks", async () => {
    const s = await makeSite("types");
    await expect(
      db.insert(schema.documents).values([
        { siteId: s, type: "post", slug: "about", title: "Post" },
        { siteId: s, type: "page", slug: "about", title: "Page" },
        { siteId: s, type: "block", slug: "about", title: "Block" },
      ]),
    ).resolves.toBeDefined();
  });
});

d("generated search vector", () => {
  it("indexes title, description and body without a trigger", async () => {
    const s = await makeSite("fts");
    await db.insert(schema.documents).values({
      siteId: s,
      type: "post",
      slug: "fts",
      title: "Indexing Postgres",
      description: "A guide to btree and gin",
      bodyText: "covering partial indexes and tsvector columns",
    });

    const hits = await db
      .select({ id: schema.documents.id })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.siteId, s),
          sql`${schema.documents.searchVector} @@ to_tsquery('english', 'tsvector')`,
        ),
      );
    expect(hits).toHaveLength(1);
  });

  it("updates itself when the body changes", async () => {
    const s = await makeSite("fts2");
    const [doc] = await db
      .insert(schema.documents)
      .values({ siteId: s, type: "post", slug: "f", title: "T", bodyText: "aardvark" })
      .returning();
    await db
      .update(schema.documents)
      .set({ bodyText: "buffalo" })
      .where(eq(schema.documents.id, doc!.id));

    const stale = await db
      .select()
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.siteId, s),
          sql`${schema.documents.searchVector} @@ to_tsquery('english', 'aardvark')`,
        ),
      );
    expect(stale).toHaveLength(0);
  });
});

d("slug history", () => {
  it("permits one destination per old slug, per site", async () => {
    const s = await makeSite("hist");
    const [doc] = await db
      .insert(schema.documents)
      .values({ siteId: s, type: "post", slug: "new", title: "T" })
      .returning();

    await db
      .insert(schema.slugHistory)
      .values({ siteId: s, documentId: doc!.id, oldSlug: "old", newSlug: "new" });

    // A second row for the same old slug would make the redirect ambiguous.
    await expect(
      db
        .insert(schema.slugHistory)
        .values({ siteId: s, documentId: doc!.id, oldSlug: "old", newSlug: "other" }),
    ).rejects.toThrow();
  });
});

d("keyset pagination", () => {
  it("returns every row exactly once even when a row is inserted mid-run", async () => {
    const s = await makeSite("page");
    const base = Date.UTC(2026, 0, 1);
    await db.insert(schema.documents).values(
      Array.from({ length: 25 }, (_, i) => ({
        siteId: s,
        type: "post" as const,
        slug: `p-${i}`,
        title: `P${i}`,
        status: "published" as const,
        publishedAt: new Date(base + i * 86_400_000),
      })),
    );

    const seen: string[] = [];
    let cursor: { publishedAt: Date; id: string } | null = null;

    for (let page = 0; page < 10; page++) {
      const where = cursor
        ? and(
            eq(schema.documents.siteId, s),
            eq(schema.documents.status, "published"),
            or(
              lt(schema.documents.publishedAt, cursor.publishedAt),
              and(
                eq(schema.documents.publishedAt, cursor.publishedAt),
                lt(schema.documents.id, cursor.id),
              ),
            ),
          )
        : and(eq(schema.documents.siteId, s), eq(schema.documents.status, "published"));

      const rows = await db
        .select({
          id: schema.documents.id,
          publishedAt: schema.documents.publishedAt,
        })
        .from(schema.documents)
        .where(where)
        .orderBy(desc(schema.documents.publishedAt), desc(schema.documents.id))
        .limit(10);

      if (rows.length === 0) break;
      for (const r of rows) seen.push(r.id);

      const last = rows[rows.length - 1]!;
      cursor = { publishedAt: last.publishedAt!, id: last.id };

      // Publish something newer partway through. Offset pagination would now
      // shift every subsequent page and duplicate a row; keyset must not.
      if (page === 0) {
        await db.insert(schema.documents).values({
          siteId: s,
          type: "post",
          slug: "interloper",
          title: "Published mid-pagination",
          status: "published",
          publishedAt: new Date(base + 999 * 86_400_000),
        });
      }
    }

    expect(seen).toHaveLength(25);
    expect(new Set(seen).size).toBe(25);
  });
});

d("api keys", () => {
  it("verifies a live key and rejects revoked, expired and unknown ones", async () => {
    const s = await makeSite("keys");
    const live = generateApiKey("read");
    const revoked = generateApiKey("read");
    const expired = generateApiKey("read");

    await db.insert(schema.apiKeys).values([
      {
        siteId: s,
        name: "live",
        type: "read",
        keyHash: live.keyHash,
        keyPrefix: live.keyPrefix,
        scopes: [...live.scopes],
      },
      {
        siteId: s,
        name: "revoked",
        type: "read",
        keyHash: revoked.keyHash,
        keyPrefix: revoked.keyPrefix,
        scopes: [...revoked.scopes],
        revokedAt: new Date(),
      },
      {
        siteId: s,
        name: "expired",
        type: "read",
        keyHash: expired.keyHash,
        keyPrefix: expired.keyPrefix,
        scopes: [...expired.scopes],
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);

    const ok = await verifyApiKey(db, live.plaintext);
    expect(ok?.siteId).toBe(s);
    expect(ok?.role).toBe("author");

    // Rejected inside the query, not after the fetch, so no caller can forget.
    expect(await verifyApiKey(db, revoked.plaintext)).toBeNull();
    expect(await verifyApiKey(db, expired.plaintext)).toBeNull();
    expect(await verifyApiKey(db, "cms_sk_not-a-real-key")).toBeNull();
    expect(await verifyApiKey(db, "totally-malformed")).toBeNull();
  });

  it("never widens an old key when a type's scope list grows later", async () => {
    const s = await makeSite("scopes");
    const key = generateApiKey("publishable");
    await db.insert(schema.apiKeys).values({
      siteId: s,
      name: "over-scoped",
      type: "publishable",
      keyHash: key.keyHash,
      keyPrefix: key.keyPrefix,
      // A stored scope this key type may never hold — e.g. written by an older
      // build, or by a bug. Verification must intersect, not trust.
      scopes: ["content:read", "content:write", "site:admin"],
    });

    const verified = await verifyApiKey(db, key.plaintext);
    expect(verified?.scopes).not.toContain("content:write");
    expect(verified?.scopes).not.toContain("site:admin");
    expect(verified?.publishedOnly).toBe(true);
  });

  it("identifies key type from the prefix alone, before any query", () => {
    expect(keyTypeOf("cms_pk_x")).toBe("publishable");
    expect(keyTypeOf("cms_sk_x")).toBe("read");
    expect(keyTypeOf("cms_ak_x")).toBe("admin");
    expect(keyTypeOf("nope")).toBeNull();
  });

  it("stores no recoverable secret", async () => {
    const key = generateApiKey("admin");
    expect(key.keyHash).not.toContain(key.plaintext);
    expect(key.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(key.keyPrefix.length).toBeLessThan(key.plaintext.length);
    expect(key.plaintext.startsWith(key.keyPrefix)).toBe(true);
  });
});
