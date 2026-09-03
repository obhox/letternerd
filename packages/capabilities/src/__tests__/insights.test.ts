import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import type { Actor, CapabilityServices } from "@cms/core";
import { AnalyticsError, type AnalyticsProvider, type PagePerformance } from "@cms/analytics";
import {
  countInboundInternalLinks,
  createInsightsCapabilities,
  insightsCapabilities,
  timeToFirstCrawl,
} from "../insights";

/**
 * The insight surface, tested for the two things that would quietly mislead an
 * editor: a partial run presented as a complete one, and a metric reported as
 * zero when the truth is that nobody measured it.
 *
 * No database and no network. `timeToFirstCrawl` and the link counter are pure
 * and tested directly, which is the only comfortable way to arrange the cases
 * that matter — a document published before the crawler log begins, and one
 * nothing has ever fetched.
 */

type Row = Record<string, unknown>;

function createFakeDb(reads: Record<string, Row[][]> = {}) {
  const queues = structuredClone(reads);
  const CHAIN = [
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "groupBy",
    "having",
    "leftJoin",
    "innerJoin",
    "for",
    "returning",
    "set",
    "values",
  ];

  function make(): Record<string, unknown> {
    let table: string | null = null;
    const chain: Record<string, unknown> = {};
    for (const method of CHAIN) {
      chain[method] = (...args: unknown[]) => {
        if (method === "from") table = getTableName(args[0] as never);
        return chain;
      };
    }
    chain["then"] = (onOk: (rows: Row[]) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          const queue = queues[table ?? "<unknown>"];
          return queue && queue.length > 0 ? (queue.shift() as Row[]) : [];
        })
        .then(onOk, onErr);
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => make(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return db;
}

const NOW = new Date("2026-03-01T00:00:00.000Z");

const ACTOR: Actor = {
  kind: "user",
  id: "user-ada",
  siteId: "site-1",
  role: "editor",
  scopes: ["analytics:read"],
  publishedOnly: false,
};

function servicesOf(db: unknown): CapabilityServices {
  return { db, storage: {}, now: () => NOW } as unknown as CapabilityServices;
}

const SITE: Row = {
  id: "site-1",
  slug: "example",
  name: "Example",
  baseUrl: "https://example.com",
  blogBasePath: "/blog",
};

const DOCS: Row[] = [
  {
    id: "doc-a",
    type: "post",
    slug: "alpha",
    path: null,
    title: "Alpha",
    // Links to beta twice, and to itself once. Both should count as one
    // inbound link for beta and none for alpha.
    bodyMd: "See [beta](/blog/beta) and [beta again](/blog/beta) and [me](/blog/alpha).",
    wordCount: 1200,
    publishedAt: new Date("2025-01-01T00:00:00.000Z"),
    firstPublishedAt: new Date("2025-01-01T00:00:00.000Z"),
    dateModified: new Date("2025-01-01T00:00:00.000Z"),
  },
  {
    id: "doc-b",
    type: "post",
    slug: "beta",
    path: null,
    title: "Beta",
    bodyMd: "Nothing links out of here.",
    wordCount: 300,
    publishedAt: new Date("2025-01-01T00:00:00.000Z"),
    firstPublishedAt: new Date("2025-01-01T00:00:00.000Z"),
    dateModified: new Date("2025-01-01T00:00:00.000Z"),
  },
  {
    id: "doc-c",
    type: "post",
    slug: "gamma",
    path: null,
    title: "Gamma",
    bodyMd: "Short.",
    wordCount: 200,
    publishedAt: new Date("2025-06-01T00:00:00.000Z"),
    firstPublishedAt: new Date("2025-06-01T00:00:00.000Z"),
    dateModified: new Date("2025-06-01T00:00:00.000Z"),
  },
];

/** doc-a was fetched by an AI crawler; the other two never were. */
const AI_CRAWLS: Row[] = [
  {
    documentId: "doc-a",
    lastAt: new Date("2026-02-01T00:00:00.000Z"),
    firstAt: new Date("2025-01-02T00:00:00.000Z"),
  },
];

/** Logging started before every document here, so "never" is a claim we can make. */
const EARLIEST_HIT: Row[] = [{ earliest: new Date("2024-12-01T00:00:00.000Z") }];

function insightsDb(): unknown {
  return createFakeDb({
    sites: [[SITE]],
    documents: [DOCS],
    crawler_hits: [AI_CRAWLS, EARLIEST_HIT],
  });
}

function capabilityFrom(caps: ReturnType<typeof createInsightsCapabilities>, name: string) {
  const found = caps.find((cap) => cap.name === name);
  if (!found) throw new Error(`No capability named "${name}".`);
  return found;
}

interface Coverage {
  provider: { name: string; audience: boolean; search: boolean; error: string | null } | null;
  documentsAnalysed: number;
  linkGraphComputed: boolean;
  rules: { kind: string; ran: boolean; found: number; limitation: string | null; note: string | null }[];
  skippedRules: string[];
  complete: boolean;
}

interface InsightsResult {
  insights: { kind: string; documentId: string; suggestedAction: string; detail: string }[];
  documents: Row[];
  coverage: Coverage;
}

async function listInsights(provider?: AnalyticsProvider): Promise<InsightsResult> {
  const caps = createInsightsCapabilities(provider === undefined ? {} : { provider });
  return (await capabilityFrom(caps, "list_insights").invoke(
    {},
    { actor: ACTOR, services: servicesOf(insightsDb()) },
  )) as InsightsResult;
}

function stubProvider(rows: PagePerformance[]): AnalyticsProvider {
  return {
    name: "stub",
    capabilities: { audience: false, search: true },
    async listPagePerformance() {
      return rows;
    },
  };
}

/* ------------------------------------------------------------------ */

describe("time to first crawl", () => {
  it("measures the gap between publishing and the first AI fetch", () => {
    const summary = timeToFirstCrawl(
      [
        {
          documentId: "doc-a",
          title: "Alpha",
          slug: "alpha",
          publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          firstAiCrawlAt: new Date("2026-01-01T06:30:00.000Z"),
        },
      ],
      { logRetainedSince: new Date("2025-01-01T00:00:00.000Z") },
    );

    expect(summary.rows[0]?.state).toBe("crawled");
    expect(summary.rows[0]?.hoursToFirstCrawl).toBe(6.5);
    expect(summary.medianHours).toBe(6.5);
    expect(summary.neverCount).toBe(0);
  });

  it("says never only when the retained log covers the document's whole life", () => {
    const summary = timeToFirstCrawl(
      [
        {
          documentId: "doc-b",
          title: "Beta",
          slug: "beta",
          publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          firstAiCrawlAt: null,
        },
      ],
      { logRetainedSince: new Date("2025-12-01T00:00:00.000Z") },
    );

    expect(summary.rows[0]?.state).toBe("never");
    expect(summary.rows[0]?.hoursToFirstCrawl).toBeNull();
    expect(summary.neverCount).toBe(1);
    // A never-crawled document contributes no duration, and a median of no
    // durations is not zero hours.
    expect(summary.medianHours).toBeNull();
  });

  it("refuses to call it never when the hit could have been pruned", () => {
    const summary = timeToFirstCrawl(
      [
        {
          documentId: "doc-old",
          title: "Old",
          slug: "old",
          publishedAt: new Date("2024-01-01T00:00:00.000Z"),
          firstAiCrawlAt: null,
        },
      ],
      { logRetainedSince: new Date("2025-12-01T00:00:00.000Z") },
    );

    expect(summary.rows[0]?.state).toBe("unknown");
    expect(summary.rows[0]?.unknownBecause).toContain("pruned");
    expect(summary.neverCount).toBe(0);
    expect(summary.unknownCount).toBe(1);
  });

  it("refuses to call it never when nothing has ever been logged", () => {
    const summary = timeToFirstCrawl(
      [
        {
          documentId: "doc-b",
          title: "Beta",
          slug: "beta",
          publishedAt: new Date("2026-01-01T00:00:00.000Z"),
          firstAiCrawlAt: null,
        },
      ],
      { logRetainedSince: null },
    );

    expect(summary.rows[0]?.state).toBe("unknown");
    expect(summary.rows[0]?.unknownBecause).toContain("no crawler hits");
  });

  it("treats a crawl that predates the publish date as unmeasurable, not as instant", () => {
    const summary = timeToFirstCrawl(
      [
        {
          documentId: "doc-r",
          title: "Republished",
          slug: "republished",
          publishedAt: new Date("2026-01-10T00:00:00.000Z"),
          firstAiCrawlAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      { logRetainedSince: new Date("2025-12-01T00:00:00.000Z") },
    );

    expect(summary.rows[0]?.state).toBe("unknown");
    expect(summary.rows[0]?.hoursToFirstCrawl).toBeNull();
  });

  it("ignores documents that were never published", () => {
    const summary = timeToFirstCrawl(
      [{ documentId: "draft", title: "Draft", slug: "draft", publishedAt: null, firstAiCrawlAt: null }],
      { logRetainedSince: new Date("2025-01-01T00:00:00.000Z") },
    );
    expect(summary.rows).toHaveLength(0);
  });

  it("takes the median of an even number of measurements", () => {
    const at = (iso: string) => new Date(iso);
    const summary = timeToFirstCrawl(
      [
        { documentId: "1", title: "1", slug: "1", publishedAt: at("2026-01-01T00:00:00Z"), firstAiCrawlAt: at("2026-01-01T02:00:00Z") },
        { documentId: "2", title: "2", slug: "2", publishedAt: at("2026-01-01T00:00:00Z"), firstAiCrawlAt: at("2026-01-01T04:00:00Z") },
      ],
      { logRetainedSince: at("2025-01-01T00:00:00Z") },
    );
    expect(summary.medianHours).toBe(3);
  });
});

describe("inbound internal links", () => {
  const site = { baseUrl: "https://example.com" };

  it("counts distinct source documents, not repeated links", () => {
    const counts = countInboundInternalLinks(
      [
        { id: "a", path: "/blog/alpha", bodyMd: "[x](/blog/beta) and [y](/blog/beta)" },
        { id: "b", path: "/blog/beta", bodyMd: "" },
      ],
      site,
    );
    expect(counts.get("b")).toBe(1);
  });

  it("ignores a document's links to itself", () => {
    const counts = countInboundInternalLinks(
      [{ id: "a", path: "/blog/alpha", bodyMd: "[me](/blog/alpha)" }],
      site,
    );
    expect(counts.get("a")).toBe(0);
  });

  it("counts absolute links to this site and ignores other origins", () => {
    const counts = countInboundInternalLinks(
      [
        { id: "a", path: "/blog/alpha", bodyMd: "[x](https://example.com/blog/beta) [y](https://elsewhere.test/blog/beta)" },
        { id: "b", path: "/blog/beta", bodyMd: "" },
      ],
      site,
    );
    expect(counts.get("b")).toBe(1);
  });

  it("sees links written as raw HTML too", () => {
    const counts = countInboundInternalLinks(
      [
        { id: "a", path: "/blog/alpha", bodyMd: '<a href="/blog/beta">beta</a>' },
        { id: "b", path: "/blog/beta", bodyMd: "" },
      ],
      site,
    );
    expect(counts.get("b")).toBe(1);
  });

  it("treats a trailing slash and a query string as the same page", () => {
    const counts = countInboundInternalLinks(
      [
        { id: "a", path: "/blog/alpha", bodyMd: "[x](/blog/beta/?utm_source=news)" },
        { id: "b", path: "/blog/beta", bodyMd: "" },
      ],
      site,
    );
    expect(counts.get("b")).toBe(1);
  });
});

describe("list_insights with no analytics provider", () => {
  it("still runs the rules that need only first-party data", async () => {
    const result = await listInsights();

    const kinds = new Set(result.insights.map((insight) => insight.kind));
    expect(kinds.has("orphan")).toBe(true);
    expect(kinds.has("never-crawled-by-ai")).toBe(true);
    expect(result.insights.length).toBeGreaterThan(0);
    // Nothing that needs impressions may appear.
    expect(kinds.has("low-ctr-high-impressions")).toBe(false);
    expect(kinds.has("near-miss-ranking")).toBe(false);
    expect(kinds.has("decaying-content")).toBe(false);
  });

  it("names every rule it skipped and refuses to call the run complete", async () => {
    const result = await listInsights();

    expect(result.coverage.provider).toBeNull();
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.skippedRules).toEqual(
      expect.arrayContaining(["low-ctr-high-impressions", "near-miss-ranking", "decaying-content"]),
    );

    for (const kind of ["low-ctr-high-impressions", "near-miss-ranking", "decaying-content"]) {
      const rule = result.coverage.rules.find((entry) => entry.kind === kind);
      expect(rule?.ran).toBe(false);
      expect(rule?.limitation).toContain("No analytics provider");
    }
  });

  it("says out loud that the thin-content rule could judge nothing", async () => {
    const result = await listInsights();

    const thin = result.coverage.rules.find((rule) => rule.kind === "thin-underperformer");
    // It runs — word count is first-party — but it cannot conclude anything
    // without impressions, and an empty result must not read as reassurance.
    expect(thin?.ran).toBe(true);
    expect(thin?.found).toBe(0);
    expect(thin?.limitation).toContain("impressions");
  });

  it("reports how far back 'never crawled' actually reaches", async () => {
    const result = await listInsights();
    const rule = result.coverage.rules.find((entry) => entry.kind === "never-crawled-by-ai");
    expect(rule?.ran).toBe(true);
    expect(rule?.limitation).toBeNull();
    expect(rule?.note).toContain("2024-12-01");
  });

  it("gives every finding an action and a document to act on", async () => {
    const result = await listInsights();
    const ids = new Set(result.documents.map((doc) => doc["id"]));
    for (const insight of result.insights) {
      expect(insight.suggestedAction.length).toBeGreaterThan(20);
      expect(insight.detail.length).toBeGreaterThan(20);
      expect(ids.has(insight.documentId)).toBe(true);
    }
  });

  it("counts inbound links from the corpus rather than assuming zero", async () => {
    const result = await listInsights();
    // doc-b is linked from doc-a, so it is a weak-links finding rather than a
    // linked-from-nowhere one; doc-c genuinely has none.
    const orphanForB = result.insights.find(
      (insight) => insight.kind === "orphan" && insight.documentId === "doc-b",
    );
    const orphanForC = result.insights.find(
      (insight) => insight.kind === "orphan" && insight.documentId === "doc-c",
    );
    expect(orphanForB?.detail).toContain("1 internal link");
    expect(orphanForC?.detail).toContain("No internal link");
    expect(result.coverage.linkGraphComputed).toBe(true);
  });
});

describe("list_insights with a search provider", () => {
  it("runs every rule and reports the run as complete", async () => {
    const result = await listInsights(
      stubProvider([
        { path: "/blog/alpha", impressions: 400, clicks: 8, ctr: 0.02, position: 12 },
        { path: "/blog/beta", impressions: 30, clicks: 1, ctr: 0.033, position: 30 },
        { path: "/blog/gamma", impressions: 10, clicks: 0, ctr: 0, position: 40 },
      ]),
    );

    expect(result.coverage.provider?.name).toBe("stub");
    expect(result.coverage.provider?.search).toBe(true);
    expect(result.coverage.skippedRules).toHaveLength(0);
    expect(result.coverage.complete).toBe(true);

    const kinds = new Set(result.insights.map((insight) => insight.kind));
    expect(kinds.has("near-miss-ranking")).toBe(true);
    expect(kinds.has("thin-underperformer")).toBe(true);
  });

  it("degrades loudly when the provider fails rather than reporting a healthy site", async () => {
    const failing: AnalyticsProvider = {
      name: "search-console",
      capabilities: { audience: false, search: true },
      async listPagePerformance() {
        throw new AnalyticsError({
          provider: "search-console",
          kind: "auth",
          retryable: false,
          message: "search-console rejected our credentials (HTTP 401).",
        });
      },
    };

    const result = await listInsights(failing);

    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.provider?.error).toContain("401");
    for (const kind of ["low-ctr-high-impressions", "near-miss-ranking", "decaying-content"]) {
      const rule = result.coverage.rules.find((entry) => entry.kind === kind);
      expect(rule?.ran).toBe(false);
      expect(rule?.limitation).toContain("401");
    }
    // The first-party half of the screen keeps working.
    expect(result.insights.some((insight) => insight.kind === "orphan")).toBe(true);
  });
});

describe("get_crawler_hits", () => {
  it("aggregates by bot and answers time-to-first-crawl, including the never case", async () => {
    const db = createFakeDb({
      crawler_hits_daily: [
        [
          { day: "2026-02-01", botName: "ClaudeBot", hits: 5, uniquePaths: 3 },
          { day: "2026-02-02", botName: "ClaudeBot", hits: 2, uniquePaths: 2 },
          { day: "2026-02-01", botName: "GPTBot", hits: 1, uniquePaths: 1 },
        ],
      ],
      crawler_hits: [
        [
          {
            documentId: "doc-a",
            hits: 7,
            lastHitAt: new Date("2026-02-02T00:00:00.000Z"),
            bots: ["ClaudeBot"],
          },
        ],
        [{ documentId: "doc-a", firstAt: new Date("2025-01-02T00:00:00.000Z") }],
        EARLIEST_HIT,
      ],
      documents: [
        DOCS.map((doc) => ({
          documentId: doc["id"],
          title: doc["title"],
          slug: doc["slug"],
          publishedAt: doc["firstPublishedAt"],
        })),
      ],
    });

    const result = (await capabilityFrom(insightsCapabilities, "get_crawler_hits").invoke(
      {},
      { actor: ACTOR, services: servicesOf(db) },
    )) as {
      byBot: { botName: string; hits: number; days: { date: string; hits: number }[] }[];
      byDocument: { documentId: string; hits: number }[];
      timeToFirstCrawl: {
        medianHours: number | null;
        crawledCount: number;
        neverCount: number;
        unknownCount: number;
        logRetainedSince: Date | null;
      };
    };

    expect(result.byBot[0]).toMatchObject({ botName: "ClaudeBot", hits: 7 });
    expect(result.byBot[0]?.days).toHaveLength(2);
    expect(result.byBot[1]).toMatchObject({ botName: "GPTBot", hits: 1 });
    expect(result.byDocument[0]).toMatchObject({ documentId: "doc-a", hits: 7 });

    // doc-a was crawled 24 hours after publishing; the other two never were,
    // and the log reaches back far enough for that to be a claim, not a guess.
    expect(result.timeToFirstCrawl.crawledCount).toBe(1);
    expect(result.timeToFirstCrawl.medianHours).toBe(24);
    expect(result.timeToFirstCrawl.neverCount).toBe(2);
    expect(result.timeToFirstCrawl.unknownCount).toBe(0);
  });

  /**
   * The reading surface stays read-only.
   *
   * `ingest_crawler_hits` is the single deliberate exception — the consuming
   * site has to be able to append what it observed, since the CMS never serves
   * those pages and cannot see a bot fetch for itself. Naming it explicitly
   * keeps the guarantee: a second write appearing here fails this test rather
   * than quietly widening what an analytics credential can do.
   */
  it("exposes exactly one write, and it is the crawler ingest", () => {
    const writes = insightsCapabilities.filter((cap) => !cap.readOnly);
    expect(writes.map((cap) => cap.name)).toEqual(["ingest_crawler_hits"]);
  });

  it("keeps every reading capability on analytics:read alone", () => {
    for (const cap of insightsCapabilities.filter((c) => c.readOnly)) {
      expect(cap.scopes).toEqual(["analytics:read"]);
      expect(cap.role).toBe("author");
    }
  });

  it("lets the ingest write nothing beyond analytics", () => {
    const ingest = insightsCapabilities.find((c) => c.name === "ingest_crawler_hits")!;
    // A publishable key ships in a browser bundle, so this is the widest thing
    // such a key can reach. It must not accumulate content or media scopes.
    expect(ingest.scopes).toEqual(["analytics:write"]);
    expect(ingest.role).toBe("author");
  });
});
