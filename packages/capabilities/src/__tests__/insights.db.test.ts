import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SCOPES, type Actor } from "@cms/core";
import { closeDb, createDb, type Database } from "@cms/db";
import * as schema from "@cms/db/schema";
import { insightsCapabilities } from "../insights";

/**
 * The crawler queries, against a real Postgres.
 *
 * This file exists because the sibling `insights.test.ts` cannot catch the bug
 * it guards. That suite runs on a fake `db` which returns whatever JavaScript
 * values it is handed, so a `Date` goes in and a `Date` comes out no matter
 * what the query says. The defect lived entirely at the driver boundary:
 *
 *   `sql<Date>` is a type ASSERTION. Drizzle knows the column type of a mapped
 *   column and parses it, but a raw aggregate like `max(occurred_at)` is opaque
 *   to it, so postgres-js returned its own value — the string
 *   '2026-02-05 11:15:00+00' — and every `.getTime()` downstream threw. The
 *   annotation claimed a type the runtime never produced.
 *
 * So the only test that can fail when `.mapWith()` is removed is one that goes
 * through the actual driver. Everything here asserts `instanceof Date` rather
 * than comparing values, because the values were always right — it was their
 * type that was a lie.
 */

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const getCrawlerHits = insightsCapabilities.find((c) => c.name === "get_crawler_hits")!;

let db: Database;
let siteId: string;
let documentId: string;

function actorFor(site: string): Actor {
  return {
    kind: "system",
    id: "test",
    siteId: site,
    role: "owner",
    scopes: [...SCOPES],
    publishedOnly: false,
  };
}

beforeAll(async () => {
  if (!hasDb) return;
  db = createDb();

  const suffix = randomUUID().slice(0, 8);
  const [site] = await db
    .insert(schema.sites)
    .values({
      slug: `crawl-${suffix}`,
      name: "Crawler fixture",
      baseUrl: `https://crawl-${suffix}.example`,
    })
    .returning();
  siteId = site!.id;

  const publishedAt = new Date(Date.now() - 20 * 86_400_000);
  const [doc] = await db
    .insert(schema.documents)
    .values({
      siteId,
      type: "post",
      slug: "crawled",
      title: "A document something has fetched",
      status: "published",
      publishedAt,
      firstPublishedAt: publishedAt,
    })
    .returning();
  documentId = doc!.id;

  // Two bots, several days apart, so min() and max() differ and a
  // single-row coincidence cannot make the assertions pass.
  await db.insert(schema.crawlerHits).values(
    [
      { bot: "ClaudeBot", category: "ai", daysAgo: 18 },
      { bot: "ClaudeBot", category: "ai", daysAgo: 9 },
      { bot: "GPTBot", category: "ai", daysAgo: 4 },
      { bot: "Googlebot", category: "search", daysAgo: 2 },
    ].map((h) => ({
      siteId,
      documentId,
      botName: h.bot,
      botCategory: h.category,
      path: "/blog/crawled",
      occurredAt: new Date(Date.now() - h.daysAgo * 86_400_000),
    })),
  );
});

afterAll(async () => {
  if (!hasDb) return;
  if (siteId) await db.delete(schema.sites).where(eq(schema.sites.id, siteId));
  await closeDb();
});

d("get_crawler_hits over a real driver", () => {
  it("returns Date instances from the raw aggregates, not driver strings", async () => {
    const result = (await getCrawlerHits.invoke(
      { days: 30, limit: 50 },
      { actor: actorFor(siteId), services: { db, storage: {} as never, now: () => new Date() } },
    )) as {
      byDocument: { documentId: string; hits: number; lastHitAt: unknown }[];
      timeToFirstCrawl: { logRetainedSince: unknown };
    };

    const row = result.byDocument.find((r) => r.documentId === documentId);
    expect(row, "the seeded document should appear in the per-document table").toBeDefined();
    expect(row!.hits).toBe(4);

    // The assertion that fails without .mapWith(): a string is truthy, formats
    // plausibly in a template literal, and only explodes on a Date method.
    expect(row!.lastHitAt).toBeInstanceOf(Date);
    expect(Number.isNaN((row!.lastHitAt as Date).getTime())).toBe(false);
  });

  it("computes time-to-first-crawl rather than throwing on it", async () => {
    // The original crash: doc.firstAiCrawlAt.getTime() inside timeToFirstCrawl.
    // Reaching a result at all is the regression this guards.
    await expect(
      getCrawlerHits.invoke(
        { days: 30, limit: 50 },
        { actor: actorFor(siteId), services: { db, storage: {} as never, now: () => new Date() } },
      ),
    ).resolves.toBeDefined();
  });

  it("still answers when the site has no crawler rows at all", async () => {
    // min()/max() over an empty set return null, which must read as "nothing
    // has been logged" rather than becoming an invalid Date.
    const [empty] = await db
      .insert(schema.sites)
      .values({
        slug: `empty-${randomUUID().slice(0, 8)}`,
        name: "No crawler rows",
        baseUrl: `https://empty-${randomUUID().slice(0, 8)}.example`,
      })
      .returning();

    try {
      const result = (await getCrawlerHits.invoke(
        { days: 30, limit: 50 },
        {
          actor: actorFor(empty!.id),
          services: { db, storage: {} as never, now: () => new Date() },
        },
      )) as { byDocument: unknown[]; timeToFirstCrawl: { logRetainedSince: unknown } };
      expect(result.byDocument).toEqual([]);
      // min() over an empty set is null, and must stay null rather than
      // becoming an Invalid Date that formats as "Invalid Date" on screen.
      expect(result.timeToFirstCrawl.logRetainedSince).toBeNull();
    } finally {
      await db.delete(schema.sites).where(eq(schema.sites.id, empty!.id));
    }
  });
});
