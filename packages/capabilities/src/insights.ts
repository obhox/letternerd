import { z } from "zod";
import { and, asc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { defineCapability, type AnyCapability } from "@cms/core";
import {
  INSIGHT_KINDS,
  findDecayingContent,
  findLowCtrHighImpressions,
  findNearMissRankings,
  findNeverCrawledByAi,
  findOrphans,
  findThinUnderperformers,
  isAnalyticsError,
  normalizePath,
  rankInsights,
  type AnalyticsProvider,
  type DateRange,
  type DecayInput,
  type DocumentFacts,
  type Insight,
  type InsightInput,
  type PagePerformance,
} from "@cms/analytics";
import * as schema from "@cms/db/schema";
import { requireSiteRow } from "./shared";

/**
 * What the crawlers did, and what an editor should do about it.
 *
 * Two capabilities with one shared discipline: never report a number the data
 * cannot support. Both of them can be asked questions whose honest answer is
 * "not measured", and both say so in the response rather than returning a zero
 * — because zero and unmeasured lead an editor to opposite conclusions, and
 * only one of those conclusions is recoverable.
 *
 * ## The credential gap, stated plainly
 *
 * Search Console and Falorb credentials have no storage in this system yet.
 * There is no table for them, and inventing one here would be inventing schema
 * three other people are not expecting. So the analytics provider arrives as a
 * constructor argument — `createInsightsCapabilities({ provider })` — and when
 * nothing is passed, `list_insights` runs only the rules that need no external
 * signal and *names the ones it skipped* in `coverage`. A partial list
 * presented as a complete one tells an editor their content is healthy when
 * two thirds of the checks never ran, which is worse than no screen at all.
 */

/* ------------------------------------------------------------------ */
/* Crawler hits                                                        */
/* ------------------------------------------------------------------ */

/**
 * Raw hits are pruned after 90 days by the nightly job (see
 * `packages/db/src/schema/analytics.ts`). Anything asked of the raw table
 * before that horizon has no answer, and the difference between "no crawler
 * came" and "the row has been deleted" is the difference between a finding and
 * a fabrication.
 */
export const RAW_HIT_RETENTION_DAYS = 90;

export type TimeToFirstCrawlState = "crawled" | "never" | "unknown";

export interface CrawlTimingInput {
  documentId: string;
  title: string;
  slug: string;
  /** When the document first went live. Null means it never did. */
  publishedAt: Date | null;
  /** Earliest *retained* hit from an AI-category crawler, or null. */
  firstAiCrawlAt: Date | null;
}

export interface TimeToFirstCrawlRow extends CrawlTimingInput {
  hoursToFirstCrawl: number | null;
  state: TimeToFirstCrawlState;
  /** Present only when `state` is "unknown"; says what stopped the measurement. */
  unknownBecause?: string;
}

export interface TimeToFirstCrawlSummary {
  rows: TimeToFirstCrawlRow[];
  medianHours: number | null;
  crawledCount: number;
  neverCount: number;
  unknownCount: number;
}

/**
 * How long after publishing an answer engine first fetched each document.
 *
 * This is the metric that proves the plumbing works. Sitemap `lastmod` and
 * on-demand revalidation are both invisible from the outside; a median of a
 * few hours says they are doing their job, and a median of a fortnight says
 * something is telling crawlers not to hurry.
 *
 * Pure, and separated from the query for that reason: the interesting cases
 * are the ones a live database makes hard to arrange — a document published
 * before crawler logging started, and one nothing has ever fetched.
 *
 * Three outcomes rather than two. "Never" is only claimed when the retained
 * log actually covers the document's whole life; otherwise the answer is
 * "unknown", because a hit that has been pruned looks exactly like a hit that
 * never happened, and reporting the first as the second would send an editor
 * to fix a sitemap that is working.
 */
export function timeToFirstCrawl(
  documents: readonly CrawlTimingInput[],
  options: { logRetainedSince: Date | null },
): TimeToFirstCrawlSummary {
  const rows: TimeToFirstCrawlRow[] = [];

  for (const doc of documents) {
    if (doc.publishedAt === null) continue;

    if (doc.firstAiCrawlAt !== null) {
      const deltaMs = doc.firstAiCrawlAt.getTime() - doc.publishedAt.getTime();
      if (deltaMs < 0) {
        // The earliest retained hit predates this publish date, which happens
        // when a document is unpublished and published again. The true first
        // crawl for the current publication is somewhere we cannot see.
        rows.push({
          ...doc,
          hoursToFirstCrawl: null,
          state: "unknown",
          unknownBecause:
            "The earliest retained crawler hit predates the current publish date, so the first " +
            "crawl after this publication cannot be identified.",
        });
        continue;
      }
      rows.push({
        ...doc,
        hoursToFirstCrawl: Math.round((deltaMs / 3_600_000) * 10) / 10,
        state: "crawled",
      });
      continue;
    }

    if (options.logRetainedSince === null) {
      rows.push({
        ...doc,
        hoursToFirstCrawl: null,
        state: "unknown",
        unknownBecause:
          "This site has no crawler hits recorded at all, so an absence proves nothing about " +
          "crawlers — only that logging has not produced a row yet.",
      });
      continue;
    }

    if (doc.publishedAt.getTime() < options.logRetainedSince.getTime()) {
      rows.push({
        ...doc,
        hoursToFirstCrawl: null,
        state: "unknown",
        unknownBecause:
          "Published before the retained crawler log begins, so a first crawl may have happened " +
          "and since been pruned.",
      });
      continue;
    }

    rows.push({ ...doc, hoursToFirstCrawl: null, state: "never" });
  }

  const measured = rows
    .filter((row): row is TimeToFirstCrawlRow & { hoursToFirstCrawl: number } =>
      row.hoursToFirstCrawl !== null,
    )
    .map((row) => row.hoursToFirstCrawl)
    .sort((a, b) => a - b);

  // `null` rather than `0` for an empty set, for the reason this whole module
  // exists: a median of nothing is not a fast median.
  let medianHours: number | null = null;
  if (measured.length > 0) {
    const mid = Math.floor(measured.length / 2);
    medianHours =
      measured.length % 2 === 1
        ? (measured[mid] as number)
        : ((measured[mid - 1] as number) + (measured[mid] as number)) / 2;
  }

  return {
    rows,
    medianHours,
    crawledCount: rows.filter((row) => row.state === "crawled").length,
    neverCount: rows.filter((row) => row.state === "never").length,
    unknownCount: rows.filter((row) => row.state === "unknown").length,
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function createGetCrawlerHits(): AnyCapability {
  return defineCapability({
    name: "get_crawler_hits",
    title: "Crawler activity",
    description:
      "Which bots fetched what, and when. Returns hits per bot per day from the retained rollup, " +
      "hits per document from the raw log, and time-to-first-crawl after publish — the metric " +
      "that shows whether sitemap lastmod and on-demand revalidation are actually working. " +
      "Documents whose history predates the 90-day raw-hit retention are reported as unknown " +
      "rather than as never crawled.",
    input: z.object({
      days: z.number().int().min(1).max(365).default(28),
      /** Cap on the per-document table; the timing summary covers everything. */
      limit: z.number().int().min(1).max(500).default(100),
    }),
    scopes: ["analytics:read"],
    role: "author",
    readOnly: true,
    idempotent: true,
    route: { method: "GET", path: "/insights/crawler-hits" },
    handler: async (input, { actor, services }) => {
      const now = services.now();
      const since = new Date(now.getTime() - input.days * 86_400_000);

      const daily = (await services.db
        .select({
          day: schema.crawlerHitsDaily.day,
          botName: schema.crawlerHitsDaily.botName,
          hits: schema.crawlerHitsDaily.hits,
          uniquePaths: schema.crawlerHitsDaily.uniquePaths,
        })
        .from(schema.crawlerHitsDaily)
        .where(
          and(
            eq(schema.crawlerHitsDaily.siteId, actor.siteId),
            gte(schema.crawlerHitsDaily.day, isoDay(since)),
          ),
        )
        .orderBy(asc(schema.crawlerHitsDaily.day))) as {
        day: string;
        botName: string;
        hits: number;
        uniquePaths: number;
      }[];

      const byBot = new Map<string, { botName: string; hits: number; days: { date: string; hits: number }[] }>();
      for (const row of daily) {
        const entry = byBot.get(row.botName) ?? { botName: row.botName, hits: 0, days: [] };
        entry.hits += row.hits;
        entry.days.push({ date: row.day, hits: row.hits });
        byBot.set(row.botName, entry);
      }

      const perDocument = (await services.db
        .select({
          documentId: schema.crawlerHits.documentId,
          hits: sql<number>`count(*)::int`,
          lastHitAt: sql<Date>`max(${schema.crawlerHits.occurredAt})`,
          bots: sql<string[]>`array_agg(distinct ${schema.crawlerHits.botName})`,
        })
        .from(schema.crawlerHits)
        .where(
          and(
            eq(schema.crawlerHits.siteId, actor.siteId),
            gte(schema.crawlerHits.occurredAt, since),
            isNotNull(schema.crawlerHits.documentId),
          ),
        )
        .groupBy(schema.crawlerHits.documentId)
        .limit(input.limit)) as {
        documentId: string | null;
        hits: number;
        lastHitAt: Date;
        bots: string[];
      }[];

      const published = (await services.db
        .select({
          documentId: schema.documents.id,
          title: schema.documents.title,
          slug: schema.documents.slug,
          publishedAt: schema.documents.firstPublishedAt,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.siteId, actor.siteId),
            eq(schema.documents.status, "published"),
            isNull(schema.documents.deletedAt),
          ),
        )) as {
        documentId: string;
        title: string;
        slug: string;
        publishedAt: Date | null;
      }[];

      const firstAiCrawls = (await services.db
        .select({
          documentId: schema.crawlerHits.documentId,
          firstAt: sql<Date>`min(${schema.crawlerHits.occurredAt})`,
        })
        .from(schema.crawlerHits)
        .where(
          and(
            eq(schema.crawlerHits.siteId, actor.siteId),
            eq(schema.crawlerHits.botCategory, "ai"),
            isNotNull(schema.crawlerHits.documentId),
          ),
        )
        .groupBy(schema.crawlerHits.documentId)) as {
        documentId: string | null;
        firstAt: Date;
      }[];

      const [oldest] = (await services.db
        .select({ earliest: sql<Date | null>`min(${schema.crawlerHits.occurredAt})` })
        .from(schema.crawlerHits)
        .where(eq(schema.crawlerHits.siteId, actor.siteId))) as { earliest: Date | null }[];

      const firstAiByDocument = new Map<string, Date>();
      for (const row of firstAiCrawls) {
        if (row.documentId !== null) firstAiByDocument.set(row.documentId, row.firstAt);
      }

      const timing = timeToFirstCrawl(
        published.map((doc) => ({
          ...doc,
          firstAiCrawlAt: firstAiByDocument.get(doc.documentId) ?? null,
        })),
        { logRetainedSince: oldest?.earliest ?? null },
      );

      const titles = new Map(published.map((doc) => [doc.documentId, doc]));

      return {
        range: { start: since, end: now, days: input.days },
        byBot: [...byBot.values()].sort((a, b) => b.hits - a.hits),
        byDocument: perDocument
          .filter((row): row is typeof row & { documentId: string } => row.documentId !== null)
          .map((row) => ({
            documentId: row.documentId,
            title: titles.get(row.documentId)?.title ?? null,
            slug: titles.get(row.documentId)?.slug ?? null,
            hits: row.hits,
            lastHitAt: row.lastHitAt,
            bots: row.bots,
          }))
          .sort((a, b) => b.hits - a.hits),
        timeToFirstCrawl: {
          ...timing,
          rawHitRetentionDays: RAW_HIT_RETENTION_DAYS,
          /**
           * The earliest hit still in the table, from the data rather than
           * from the retention constant — a site whose logging started last
           * week has a shorter window than the policy allows, and quoting the
           * policy would overstate what we can see.
           */
          logRetainedSince: oldest?.earliest ?? null,
        },
      };
    },
  }) as AnyCapability;
}

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

/**
 * How many published documents we will read bodies for in one pass.
 *
 * The inbound-link count is computed here, in memory, by reading every
 * published document's markdown — there is no link-edge table in the schema.
 * Past this size that stops being reasonable, and rather than truncate the
 * corpus (which would report real pages as orphans purely because they fell
 * outside the window) the link graph is marked uncomputed and `findOrphans`
 * skips every row, which is exactly what that rule does with an unknown count.
 */
const MAX_LINK_GRAPH_DOCUMENTS = 750;

export interface RuleCoverage {
  kind: string;
  /** Whether the rule was evaluated at all. */
  ran: boolean;
  /** How many findings it produced. Meaningless when `ran` is false. */
  found: number;
  /** Which signal the rule depends on, so a UI can say what connecting buys. */
  needs: "first-party" | "search";
  /**
   * Why it did not run, or why it ran and could judge nothing. Null when the
   * rule had everything it needed. This is the field `complete` is computed
   * from, so it must carry only real impairments.
   */
  limitation: string | null;
  /**
   * A caveat about a rule that did its job — the retention window behind the
   * word "never", for instance. Worth showing next to the findings; not a
   * reason to distrust the run, which is why it is kept apart from
   * `limitation`.
   */
  note: string | null;
}

const NO_PROVIDER =
  "No analytics provider is connected, so this site has no impressions, clicks, click-through " +
  "rate or ranking position. This rule was not evaluated.";

interface DocumentRow {
  id: string;
  type: string;
  slug: string;
  path: string | null;
  title: string;
  bodyMd: string;
  wordCount: number;
  publishedAt: Date | null;
  firstPublishedAt: Date | null;
  dateModified: Date | null;
}

/**
 * The URL a document occupies on the consuming site.
 *
 * Root-relative, matching what `normalizePath` reduces every provider's idea
 * of a page to. Both sides of the join go through the same function for the
 * reason `packages/analytics/src/path.ts` gives: a join that misses is silent,
 * and shows up as a page with impressions and no views sitting next to the
 * same page with views and no impressions.
 */
function documentPath(
  site: { blogBasePath: string },
  doc: { type: string; slug: string; path: string | null },
): string | undefined {
  if (doc.type === "post") return normalizePath(`${site.blogBasePath}/${doc.slug}`);
  if (doc.type === "page") return normalizePath(doc.path ?? `/${doc.slug}`);
  // Blocks are fragments embedded in other documents. They have no URL, so
  // there is nothing for a crawler to fetch or a provider to report.
  return undefined;
}

const MARKDOWN_LINK = /\]\(\s*<?([^)\s>]+)/g;
const HTML_HREF = /href\s*=\s*["']([^"']+)["']/g;

/**
 * Inbound internal links per document, counted from the markdown itself.
 *
 * There is no link-edge table, so this is computed from the source of truth
 * rather than from a cache that could be stale. Distinct source documents, not
 * raw occurrences: three links from one article is one relationship, and
 * counting them as three would quietly rescue a page from the orphan rule that
 * is still reachable from exactly one place.
 *
 * Links to other origins are ignored, and so are self-links — a page linking
 * to itself is not a page anything links to.
 */
export function countInboundInternalLinks(
  docs: readonly { id: string; path: string | undefined; bodyMd: string }[],
  site: { baseUrl: string },
): Map<string, number> {
  const byPath = new Map<string, string>();
  for (const doc of docs) {
    if (doc.path !== undefined) byPath.set(doc.path, doc.id);
  }

  const sourcesByTarget = new Map<string, Set<string>>();

  for (const doc of docs) {
    const seen = new Set<string>();
    for (const pattern of [MARKDOWN_LINK, HTML_HREF]) {
      pattern.lastIndex = 0;
      let match = pattern.exec(doc.bodyMd);
      while (match !== null) {
        const href = match[1];
        match = pattern.exec(doc.bodyMd);
        if (href === undefined) continue;
        // Off-site links join against nothing; keeping them would only cost
        // time. An absolute link to this site's own origin is internal.
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith(site.baseUrl)) continue;
        if (href.startsWith("#")) continue;
        const target = normalizePath(href);
        if (target === undefined) continue;
        const targetId = byPath.get(target);
        if (targetId === undefined || targetId === doc.id) continue;
        seen.add(targetId);
      }
    }
    for (const targetId of seen) {
      const set = sourcesByTarget.get(targetId) ?? new Set<string>();
      set.add(doc.id);
      sourcesByTarget.set(targetId, set);
    }
  }

  const counts = new Map<string, number>();
  for (const doc of docs) counts.set(doc.id, sourcesByTarget.get(doc.id)?.size ?? 0);
  return counts;
}

function toIsoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function rangeOf(end: Date, days: number): DateRange {
  return { start: isoDay(new Date(end.getTime() - days * 86_400_000)), end: isoDay(end) };
}

export interface InsightsDeps {
  /**
   * Where impressions, clicks, position and views come from.
   *
   * Optional, and it is meant to stay optional. There is no schema for Search
   * Console or Falorb credentials in this system, so nothing can construct one
   * per site yet; a single provider can be injected by a caller that has
   * credentials of its own, and everything still works without one.
   */
  provider?: AnalyticsProvider;
}

function createListInsights(deps: InsightsDeps): AnyCapability {
  return defineCapability({
    name: "list_insights",
    title: "List insights",
    description:
      "A ranked list of things worth doing to this site's content, each with the finding, the " +
      "numbers behind it and the action to take. Joins what the CMS knows (publish dates, word " +
      "counts, internal links, AI-crawler hits) to whatever an analytics provider knows. " +
      "Without a connected provider only the first-party rules run — orphans, never crawled by " +
      "an answer engine, thin content — and `coverage` names every rule that was skipped. " +
      "Read `coverage.complete` before treating an empty list as good news.",
    input: z.object({
      days: z.number().int().min(7).max(180).default(28),
      limit: z.number().int().min(1).max(200).default(50),
      /** How long a page must have been live before its silence means anything. */
      minAgeDays: z.number().int().min(0).max(365).default(30),
    }),
    scopes: ["analytics:read"],
    role: "author",
    readOnly: true,
    idempotent: true,
    route: { method: "GET", path: "/insights" },
    handler: async (input, { actor, services }) => {
      const site = await requireSiteRow(services.db, actor.siteId);
      const now = services.now();
      const nowIso = now.toISOString();

      const rows = (await services.db
        .select({
          id: schema.documents.id,
          type: schema.documents.type,
          slug: schema.documents.slug,
          path: schema.documents.path,
          title: schema.documents.title,
          bodyMd: schema.documents.bodyMd,
          wordCount: schema.documents.wordCount,
          publishedAt: schema.documents.publishedAt,
          firstPublishedAt: schema.documents.firstPublishedAt,
          dateModified: schema.documents.dateModified,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.siteId, actor.siteId),
            eq(schema.documents.status, "published"),
            isNull(schema.documents.deletedAt),
          ),
        )
        .limit(MAX_LINK_GRAPH_DOCUMENTS + 1)) as DocumentRow[];

      const overLinkGraphLimit = rows.length > MAX_LINK_GRAPH_DOCUMENTS;
      const documents = overLinkGraphLimit ? rows.slice(0, MAX_LINK_GRAPH_DOCUMENTS) : rows;

      const withPaths = documents
        .map((doc) => ({ doc, path: documentPath(site, doc) }))
        .filter((entry): entry is { doc: DocumentRow; path: string } => entry.path !== undefined);

      const inboundLinks = overLinkGraphLimit
        ? null
        : countInboundInternalLinks(
            withPaths.map((entry) => ({ id: entry.doc.id, path: entry.path, bodyMd: entry.doc.bodyMd })),
            site,
          );

      /* ---- first-party crawler signal ---------------------------------- */

      const aiCrawls = (await services.db
        .select({
          documentId: schema.crawlerHits.documentId,
          lastAt: sql<Date>`max(${schema.crawlerHits.occurredAt})`,
          firstAt: sql<Date>`min(${schema.crawlerHits.occurredAt})`,
        })
        .from(schema.crawlerHits)
        .where(
          and(
            eq(schema.crawlerHits.siteId, actor.siteId),
            eq(schema.crawlerHits.botCategory, "ai"),
            isNotNull(schema.crawlerHits.documentId),
          ),
        )
        .groupBy(schema.crawlerHits.documentId)) as {
        documentId: string | null;
        lastAt: Date;
        firstAt: Date;
      }[];

      const [oldestHit] = (await services.db
        .select({ earliest: sql<Date | null>`min(${schema.crawlerHits.occurredAt})` })
        .from(schema.crawlerHits)
        .where(eq(schema.crawlerHits.siteId, actor.siteId))) as { earliest: Date | null }[];

      const crawlerLogHasRows = (oldestHit?.earliest ?? null) !== null;

      const aiByDocument = new Map<string, { lastAt: Date; firstAt: Date }>();
      for (const row of aiCrawls) {
        if (row.documentId !== null) {
          aiByDocument.set(row.documentId, { lastAt: row.lastAt, firstAt: row.firstAt });
        }
      }

      /* ---- provider signal, or its documented absence ------------------- */

      const provider = deps.provider;
      const range = rangeOf(now, input.days);
      const previousRange = rangeOf(new Date(now.getTime() - input.days * 86_400_000), input.days);

      let current = new Map<string, PagePerformance>();
      let previous = new Map<string, PagePerformance>();
      let providerError: string | null = null;

      if (provider) {
        const paths = withPaths.map((entry) => entry.path);
        try {
          const rowsNow = await provider.listPagePerformance({ range, paths });
          current = indexByPath(rowsNow);
          if (provider.capabilities.search) {
            const rowsBefore = await provider.listPagePerformance({ range: previousRange, paths });
            previous = indexByPath(rowsBefore);
          }
        } catch (error) {
          /**
           * A failed fetch degrades the run; it does not empty it.
           *
           * Swallowing this and carrying on with no numbers is the "0
           * impressions" trap `@cms/analytics` is built to avoid — the screen
           * would look like a healthy site with nothing to do. The rules that
           * needed the provider are marked skipped with this message, which is
           * the same treatment as having no provider at all, because from an
           * editor's point of view it is the same situation.
           */
          providerError = isAnalyticsError(error)
            ? error.message
            : `The analytics provider failed: ${error instanceof Error ? error.message : String(error)}`;
        }
      }

      const searchAvailable =
        provider !== undefined && provider.capabilities.search && providerError === null;

      /* ---- assemble the rule inputs ------------------------------------ */

      const insightInputs: InsightInput[] = withPaths.map(({ doc, path }) => {
        const crawl = aiByDocument.get(doc.id);
        const publishedAt = doc.firstPublishedAt ?? doc.publishedAt;
        const facts: DocumentFacts = {
          documentId: doc.id,
          slug: doc.slug,
          path,
          title: doc.title,
          publishedAt: toIsoOrNull(publishedAt),
          dateModified: toIsoOrNull(doc.dateModified ?? publishedAt),
          wordCount: doc.wordCount,
          lastCrawledByAiAt: crawl ? crawl.lastAt.toISOString() : null,
        };
        // Left `undefined` rather than set to zero when the graph was not
        // computed: `findOrphans` skips an unknown count, and that is the
        // behaviour we want — "we did not look" must not read as "nothing
        // links here".
        const links = inboundLinks?.get(doc.id);
        if (links !== undefined) facts.internalInboundLinks = links;
        if (crawl && publishedAt) {
          const delta = crawl.firstAt.getTime() - publishedAt.getTime();
          if (delta >= 0) facts.firstAiCrawlDelayHours = Math.round((delta / 3_600_000) * 10) / 10;
        }
        return { facts, performance: current.get(path) ?? { path } };
      });

      const decayInputs: DecayInput[] = insightInputs.map((row) => ({
        facts: row.facts,
        current: row.performance,
        previous: previous.get(row.facts.path) ?? { path: row.facts.path },
      }));

      /* ---- run the rules, recording what each one could actually do ---- */

      const coverage: RuleCoverage[] = [];
      const insights: Insight[] = [];

      function record(
        kind: string,
        needs: RuleCoverage["needs"],
        found: Insight[],
        extra: { limitation?: string; note?: string } = {},
      ) {
        insights.push(...found);
        coverage.push({
          kind,
          needs,
          ran: true,
          found: found.length,
          limitation: extra.limitation ?? null,
          note: extra.note ?? null,
        });
      }

      function skip(kind: string, needs: RuleCoverage["needs"], reason: string) {
        coverage.push({ kind, needs, ran: false, found: 0, limitation: reason, note: null });
      }

      const searchSkipReason = providerError ?? NO_PROVIDER;

      if (searchAvailable) {
        record(INSIGHT_KINDS.lowCtrHighImpressions, "search", findLowCtrHighImpressions(insightInputs));
        record(INSIGHT_KINDS.nearMissRanking, "search", findNearMissRankings(insightInputs));
        record(INSIGHT_KINDS.decayingContent, "search", findDecayingContent(decayInputs, { now: nowIso }));
      } else {
        skip(INSIGHT_KINDS.lowCtrHighImpressions, "search", searchSkipReason);
        skip(INSIGHT_KINDS.nearMissRanking, "search", searchSkipReason);
        skip(INSIGHT_KINDS.decayingContent, "search", searchSkipReason);
      }

      if (inboundLinks === null) {
        skip(
          INSIGHT_KINDS.orphan,
          "first-party",
          `This site has more than ${MAX_LINK_GRAPH_DOCUMENTS} published documents, so the internal ` +
            "link graph was not computed in this pass. Reporting a partial graph would name " +
            "well-linked pages as orphans.",
        );
      } else {
        record(INSIGHT_KINDS.orphan, "first-party", findOrphans(insightInputs));
      }

      if (!crawlerLogHasRows) {
        skip(
          INSIGHT_KINDS.neverCrawledByAi,
          "first-party",
          "No crawler hits have been recorded for this site at all. Until logging has produced a " +
            "row, an absence says nothing about crawlers — every document would be flagged.",
        );
      } else {
        record(
          INSIGHT_KINDS.neverCrawledByAi,
          "first-party",
          findNeverCrawledByAi(insightInputs, { now: nowIso, minAgeDays: input.minAgeDays }),
          {
            note:
              `"Never" means no AI-crawler hit since ${isoDay(oldestHit?.earliest ?? now)}, which is ` +
              `as far back as the raw hit log is retained (${RAW_HIT_RETENTION_DAYS} days).`,
          },
        );
      }

      const thin = findThinUnderperformers(insightInputs, {
        now: nowIso,
        minAgeDays: input.minAgeDays,
      });
      record(
        INSIGHT_KINDS.thinUnderperformer,
        "first-party",
        thin,
        /**
         * Word count is first-party; the other half of this rule is not.
         *
         * A page is only "thin and underperforming" if search is also ignoring
         * it, and without impressions no page can be judged — so the rule runs
         * and correctly finds nothing. That is a very different statement from
         * "your short pages are fine", and it has to be said out loud or the
         * empty result reads as the reassurance.
         */
        searchAvailable
          ? {}
          : {
              limitation:
                "Ran, but found nothing it could judge: thinness is only a finding when search is " +
                "also ignoring the page, and impressions are unavailable without an analytics provider.",
            },
      );

      const ranked = rankInsights(insights).slice(0, input.limit);
      const skippedRules = coverage.filter((rule) => !rule.ran).map((rule) => rule.kind);

      return {
        insights: ranked,
        /** Enough to render each finding as a link to its editor, without a second query. */
        documents: withPaths.map(({ doc, path }) => ({
          id: doc.id,
          type: doc.type,
          slug: doc.slug,
          title: doc.title,
          path,
        })),
        generatedAt: now,
        range,
        coverage: {
          provider:
            provider === undefined
              ? null
              : {
                  name: provider.name,
                  audience: provider.capabilities.audience,
                  search: provider.capabilities.search,
                  error: providerError,
                },
          documentsAnalysed: withPaths.length,
          linkGraphComputed: inboundLinks !== null,
          rules: coverage,
          skippedRules,
          /**
           * The one field a caller must read before treating an empty list as
           * good news. False whenever any rule was skipped or hobbled — which,
           * with no credential storage for Search Console or Falorb anywhere in
           * this system, is the normal case today.
           */
          complete: coverage.every((rule) => rule.ran && rule.limitation === null),
        },
      };
    },
  }) as AnyCapability;
}

function indexByPath(rows: readonly PagePerformance[]): Map<string, PagePerformance> {
  const map = new Map<string, PagePerformance>();
  for (const row of rows) {
    const path = normalizePath(row.path);
    if (path !== undefined) map.set(path, { ...row, path });
  }
  return map;
}

/**
 * Build the insight capabilities, optionally against a provider.
 *
 * A factory rather than a module-level constant because the provider is an
 * injected dependency and there is nowhere to persist one yet. Called with no
 * argument — which is how `insightsCapabilities` below is built, and how the
 * registry gets them today — the search rules are skipped and say so.
 */
export function createInsightsCapabilities(deps: InsightsDeps = {}): AnyCapability[] {
  return [createGetCrawlerHits(), createListInsights(deps)];
}

export const insightsCapabilities = createInsightsCapabilities();
