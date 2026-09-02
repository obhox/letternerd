import type { PagePerformance } from "./types";

/**
 * Numbers into a ranked list of things worth doing this week.
 *
 * This is the part neither provider can produce alone. Falorb and Search
 * Console know the traffic; only the CMS knows that this URL is a document
 * published fourteen months ago, 380 words long, linked from nothing, and last
 * touched before the product was renamed. The join is the product.
 *
 * Everything here is a pure function. No fetch, no database, no clock — rules
 * that need "now" take it as an argument, so a finding is reproducible and a
 * test can sit on any date it likes.
 *
 * ## The statistics, and why they are like this
 *
 * **Medians, not means.** Page traffic is a power law: a handful of pages
 * carry most of the impressions. A mean impression count on a normal site sits
 * above roughly 80% of the pages, so "above average impressions" quietly means
 * "in the top fifth" and every threshold built on it fires on almost nothing.
 * A median splits the corpus in half, which is what the wording of these rules
 * actually claims.
 *
 * **CTR is compared within a position band, never across.** A 2% CTR at
 * position 3 is a disaster; the same 2% at position 25 is remarkable. Ranking
 * pages by raw CTR is the classic mistake in this space and it produces a list
 * sorted almost perfectly by average position — i.e. no information at all.
 * Every CTR comparison here is against the median CTR of pages in the *same*
 * band.
 *
 * **Minimum sample sizes, everywhere.** A post with three clicks that drops to
 * one has "lost 67% of its traffic". A band with two pages in it has a median
 * that means nothing. Both are excluded rather than reported quietly, because
 * a dashboard of noise is worse than no dashboard: it teaches editors that
 * this screen is not worth reading, and then the one real finding is ignored
 * too.
 *
 * **No finding without an action.** Every rule ends in a sentence an editor
 * can start doing. If a signal cannot be phrased that way it does not belong
 * on this screen.
 */

/** What the CMS knows about a document, joined to what the providers know about its path. */
export interface DocumentFacts {
  documentId: string;
  slug: string;
  path: string;
  title: string;
  publishedAt?: string | null;
  dateModified?: string | null;
  wordCount?: number;
  internalInboundLinks?: number;
  lastCrawledByAiAt?: string | null;
  firstAiCrawlDelayHours?: number | null;
}

export interface Insight {
  kind: string;
  documentId: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  metric?: Record<string, number | string>;
  suggestedAction: string;
}

/** One document and its numbers for the window being analysed. */
export interface InsightInput {
  facts: DocumentFacts;
  performance: PagePerformance;
}

/** One document across two adjacent windows, for the decay rule. */
export interface DecayInput {
  facts: DocumentFacts;
  /** The recent window. */
  current: PagePerformance;
  /** The window immediately before it, of the same length. */
  previous: PagePerformance;
}

export const INSIGHT_KINDS = {
  lowCtrHighImpressions: "low-ctr-high-impressions",
  nearMissRanking: "near-miss-ranking",
  decayingContent: "decaying-content",
  orphan: "orphan",
  neverCrawledByAi: "never-crawled-by-ai",
  thinUnderperformer: "thin-underperformer",
} as const;

/* ------------------------------------------------------------------ */
/* Small statistics, kept honest                                       */
/* ------------------------------------------------------------------ */

/**
 * The median, or `undefined` for an empty set.
 *
 * `undefined` rather than `0`, for the same reason `PagePerformance` uses it:
 * a threshold computed from a median that does not exist is not a threshold,
 * and comparing against zero would make every rule fire on everything.
 */
export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

/**
 * SERP position bands.
 *
 * The boundaries sit on halves because average position is fractional: a page
 * averaging 10.4 belongs with page one, 10.6 with page two, and an integer
 * boundary would put both in whichever band the `<=` happened to favour. The
 * bands themselves follow how click-through actually behaves — the drop from
 * the top three to the rest of page one is larger than the drop across the
 * whole of page two.
 */
export interface PositionBand {
  label: string;
  min: number;
  max: number;
}

export const POSITION_BANDS: readonly PositionBand[] = [
  { label: "1-3", min: 0, max: 3.5 },
  { label: "4-10", min: 3.5, max: 10.5 },
  { label: "11-20", min: 10.5, max: 20.5 },
  { label: "21+", min: 20.5, max: Number.POSITIVE_INFINITY },
] as const;

export function positionBandOf(position: number): PositionBand | undefined {
  return POSITION_BANDS.find((band) => position >= band.min && position < band.max);
}

/** Whole days from `from` to `to`, or `undefined` if either date is unusable. */
export function daysBetween(from: string | null | undefined, to: string): number | undefined {
  if (typeof from !== "string" || from.length === 0) return undefined;
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  return Math.floor((end - start) / 86_400_000);
}

/** Published means "has a publish date". A document with none was never live. */
function isPublished(facts: DocumentFacts): boolean {
  return typeof facts.publishedAt === "string" && facts.publishedAt.length > 0;
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Severity from raw opportunity size.
 *
 * Absolute rather than relative to the site, deliberately: an editor's day is
 * finite in the same way whatever the site's size, and 40 impressions is a
 * small opportunity on a small site too. The thresholds are options so a
 * high-volume site can move them.
 */
function severityFromImpressions(
  impressions: number,
  high: number,
  medium: number,
): Insight["severity"] {
  if (impressions >= high) return "high";
  if (impressions >= medium) return "medium";
  return "low";
}

/* ------------------------------------------------------------------ */
/* 1. High impressions, low CTR for the position band                  */
/* ------------------------------------------------------------------ */

export interface LowCtrOptions {
  /** Floor on impressions before a page can be flagged at all. Default 100. */
  minImpressions?: number;
  /** Pages needed in a band before its median CTR is trusted. Default 5. */
  minBandSample?: number;
  /** Impressions a page needs to count towards a band median. Default 10. */
  minImpressionsForBandMedian?: number;
  /** Flag at or below this share of the band's median CTR. Default 0.5. */
  ctrRatioOfBandMedian?: number;
  highImpressions?: number;
  mediumImpressions?: number;
}

/**
 * Pages plenty of people see in search and almost nobody clicks.
 *
 * The cheapest fix in content marketing: the ranking is already earned, the
 * title and description are losing the click. But it is only a finding when
 * the CTR is bad *for where the page ranks*, which is why the comparison is
 * against the median CTR of the page's own position band and why a band with
 * too few pages in it is skipped rather than guessed at.
 *
 * Pages with a handful of impressions are excluded from the band medians as
 * well as from the findings: one impression and one click is a 100% CTR, and a
 * few of those drag a band's median somewhere no real page lives, which then
 * suppresses every genuine finding in that band.
 */
export function findLowCtrHighImpressions(
  rows: InsightInput[],
  options: LowCtrOptions = {},
): Insight[] {
  const minImpressions = options.minImpressions ?? 100;
  const minBandSample = options.minBandSample ?? 5;
  const minForMedian = options.minImpressionsForBandMedian ?? 10;
  const ratio = options.ctrRatioOfBandMedian ?? 0.5;
  const highImpressions = options.highImpressions ?? 1000;
  const mediumImpressions = options.mediumImpressions ?? 300;

  const measured = rows.filter(
    (row) =>
      row.performance.impressions !== undefined &&
      row.performance.ctr !== undefined &&
      row.performance.position !== undefined,
  );

  const corpusMedianImpressions = median(measured.map((row) => row.performance.impressions as number));
  if (corpusMedianImpressions === undefined) return [];

  const ctrByBand = new Map<string, number[]>();
  for (const row of measured) {
    const band = positionBandOf(row.performance.position as number);
    if (!band) continue;
    if ((row.performance.impressions as number) < minForMedian) continue;
    const bucket = ctrByBand.get(band.label) ?? [];
    bucket.push(row.performance.ctr as number);
    ctrByBand.set(band.label, bucket);
  }

  const insights: Insight[] = [];
  for (const row of measured) {
    const impressions = row.performance.impressions as number;
    const ctr = row.performance.ctr as number;
    const position = row.performance.position as number;

    if (impressions < minImpressions) continue;
    if (impressions < corpusMedianImpressions) continue;

    const band = positionBandOf(position);
    if (!band) continue;

    const sample = ctrByBand.get(band.label) ?? [];
    // Too few comparable pages to know what "normal" looks like here. Staying
    // quiet is the correct answer, not falling back to a site-wide median that
    // mixes position 2 and position 40.
    if (sample.length < minBandSample) continue;

    const bandMedian = median(sample);
    if (bandMedian === undefined || bandMedian <= 0) continue;
    if (ctr > bandMedian * ratio) continue;

    insights.push({
      kind: INSIGHT_KINDS.lowCtrHighImpressions,
      documentId: row.facts.documentId,
      severity: severityFromImpressions(impressions, highImpressions, mediumImpressions),
      title: `"${row.facts.title}" is seen in search but rarely clicked`,
      detail:
        `${impressions.toLocaleString("en-US")} impressions at average position ${round1(position)}, ` +
        `but only ${percent(ctr)} of those became clicks. Pages ranking ${band.label} on this site ` +
        `get ${percent(bandMedian)}. The ranking is working; the result snippet is not.`,
      metric: {
        impressions,
        clicks: row.performance.clicks ?? 0,
        ctr,
        position,
        positionBand: band.label,
        bandMedianCtr: bandMedian,
      },
      suggestedAction:
        `Rewrite the title tag and meta description for ${row.facts.path} to match what searchers ` +
        `are actually asking. Check listQueries for this page first — the winning phrasing is usually in the query list.`,
    });
  }

  return insights;
}

/* ------------------------------------------------------------------ */
/* 2. Near-miss rankings                                               */
/* ------------------------------------------------------------------ */

export interface NearMissOptions {
  /** Default 8 — anything better is already on page one and needs no rescue. */
  minPosition?: number;
  /** Default 20 — beyond page two, a refresh rarely closes the gap. */
  maxPosition?: number;
  /** Default 50. Below this the ranking is not yet evidence of demand. */
  minImpressions?: number;
  highImpressions?: number;
  mediumImpressions?: number;
}

/**
 * Pages sitting just off the visible part of page one.
 *
 * The cheapest wins on the whole screen. Google already considers the page a
 * plausible answer, and the distance from position 14 to position 8 is usually
 * an afternoon of expanding and updating — where the distance from 60 to 8 is
 * a new article. The window stops at 20 for that reason: past there the honest
 * advice is "write something new", which is a different decision.
 */
export function findNearMissRankings(rows: InsightInput[], options: NearMissOptions = {}): Insight[] {
  const minPosition = options.minPosition ?? 8;
  const maxPosition = options.maxPosition ?? 20;
  const minImpressions = options.minImpressions ?? 50;
  const highImpressions = options.highImpressions ?? 500;
  const mediumImpressions = options.mediumImpressions ?? 150;

  const insights: Insight[] = [];
  for (const row of rows) {
    const { position, impressions } = row.performance;
    if (position === undefined || impressions === undefined) continue;
    if (position < minPosition || position > maxPosition) continue;
    if (impressions < minImpressions) continue;

    insights.push({
      kind: INSIGHT_KINDS.nearMissRanking,
      documentId: row.facts.documentId,
      severity: severityFromImpressions(impressions, highImpressions, mediumImpressions),
      title: `"${row.facts.title}" is one push from page one`,
      detail:
        `Average position ${round1(position)} on ${impressions.toLocaleString("en-US")} impressions. ` +
        `Google already treats this page as a candidate answer — it is simply below where people look.`,
      metric: {
        position,
        impressions,
        clicks: row.performance.clicks ?? 0,
        ...(row.performance.ctr === undefined ? {} : { ctr: row.performance.ctr }),
      },
      suggestedAction:
        `Refresh and expand ${row.facts.path}: cover the sub-questions in its query list, update anything ` +
        `stale, and add internal links from your strongest related pages.`,
    });
  }
  return insights;
}

/* ------------------------------------------------------------------ */
/* 3. Decaying content                                                 */
/* ------------------------------------------------------------------ */

export interface DecayOptions {
  /** ISO date the analysis is run for. Injected so this stays pure. */
  now: string;
  /** Clicks the earlier window needs before a drop is signal. Default 20. */
  minBaselineClicks?: number;
  /** Impressions the earlier window needs before a position slide is signal. Default 200. */
  minBaselineImpressions?: number;
  /** Share of clicks lost that counts as decay. Default 0.3. */
  clickDropRatio?: number;
  /** Positions lost that counts as decay. Default 3. */
  positionDropPoints?: number;
  /** How stale the document must be for decay to be actionable. Default 180 days. */
  staleAfterDays?: number;
}

/**
 * Content that used to work and has been sliding.
 *
 * Two adjacent windows of equal length, compared. Three guards keep this from
 * being the noisiest rule on the screen:
 *
 *  - A minimum baseline. A post that went from 3 clicks to 1 has "lost 67%",
 *    and reporting that trains editors to distrust every percentage here.
 *  - A staleness requirement. A page that dropped in the fortnight after it
 *    was rewritten is usually Google re-evaluating it, not decay; recommending
 *    another rewrite would be actively harmful advice.
 *  - Position slides need their own volume floor, because average position on
 *    a page with a dozen impressions swings on which long-tail query happened
 *    to surface that week.
 */
export function findDecayingContent(rows: DecayInput[], options: DecayOptions): Insight[] {
  const minBaselineClicks = options.minBaselineClicks ?? 20;
  const minBaselineImpressions = options.minBaselineImpressions ?? 200;
  const clickDropRatio = options.clickDropRatio ?? 0.3;
  const positionDropPoints = options.positionDropPoints ?? 3;
  const staleAfterDays = options.staleAfterDays ?? 180;

  const insights: Insight[] = [];

  for (const row of rows) {
    if (!isPublished(row.facts)) continue;

    const touchedAt = row.facts.dateModified ?? row.facts.publishedAt;
    const ageDays = daysBetween(touchedAt, options.now);
    if (ageDays === undefined || ageDays < staleAfterDays) continue;

    const prevClicks = row.previous.clicks;
    const currClicks = row.current.clicks;
    const prevPosition = row.previous.position;
    const currPosition = row.current.position;
    const prevImpressions = row.previous.impressions;

    let clickDrop: number | undefined;
    if (
      prevClicks !== undefined &&
      currClicks !== undefined &&
      prevClicks >= minBaselineClicks &&
      currClicks < prevClicks
    ) {
      const drop = (prevClicks - currClicks) / prevClicks;
      if (drop >= clickDropRatio) clickDrop = drop;
    }

    let positionDrop: number | undefined;
    if (
      prevPosition !== undefined &&
      currPosition !== undefined &&
      prevImpressions !== undefined &&
      prevImpressions >= minBaselineImpressions &&
      currPosition - prevPosition >= positionDropPoints
    ) {
      positionDrop = currPosition - prevPosition;
    }

    if (clickDrop === undefined && positionDrop === undefined) continue;

    const severity: Insight["severity"] =
      (clickDrop !== undefined && clickDrop >= 0.6) || (positionDrop !== undefined && positionDrop >= 8)
        ? "high"
        : (clickDrop !== undefined && clickDrop >= 0.4) ||
            (positionDrop !== undefined && positionDrop >= 5)
          ? "medium"
          : "low";

    const parts: string[] = [];
    if (clickDrop !== undefined) {
      parts.push(
        `clicks fell from ${(prevClicks as number).toLocaleString("en-US")} to ` +
          `${(currClicks as number).toLocaleString("en-US")} (${percent(clickDrop)} down)`,
      );
    }
    if (positionDrop !== undefined) {
      parts.push(
        `average position slipped from ${round1(prevPosition as number)} to ${round1(currPosition as number)}`,
      );
    }

    const metric: Record<string, number | string> = { daysSinceUpdated: ageDays };
    if (prevClicks !== undefined) metric["previousClicks"] = prevClicks;
    if (currClicks !== undefined) metric["currentClicks"] = currClicks;
    if (clickDrop !== undefined) metric["clickDropRatio"] = clickDrop;
    if (prevPosition !== undefined) metric["previousPosition"] = prevPosition;
    if (currPosition !== undefined) metric["currentPosition"] = currPosition;
    if (positionDrop !== undefined) metric["positionDropPoints"] = positionDrop;

    insights.push({
      kind: INSIGHT_KINDS.decayingContent,
      documentId: row.facts.documentId,
      severity,
      title: `"${row.facts.title}" is losing ground`,
      detail:
        `Against the previous window of the same length, ${parts.join(" and ")}. ` +
        `The page has not been updated in ${ageDays} days, so this is drift rather than a recent edit settling.`,
      metric,
      suggestedAction:
        `Update ${row.facts.path}: correct anything that has gone out of date, answer the questions ` +
        `now appearing in its query list, and republish with a fresh dateModified.`,
    });
  }

  return insights;
}

/* ------------------------------------------------------------------ */
/* 4. Orphans                                                          */
/* ------------------------------------------------------------------ */

export interface OrphanOptions {
  /** Inbound internal links at or below this count counts as orphaned. Default 1. */
  maxInboundLinks?: number;
  /** Impressions above which an orphan is a tidy-up, not a rescue. Default 500. */
  wellPerformingImpressions?: number;
}

/**
 * Published pages nothing links to.
 *
 * An orphan is reachable only from the sitemap. Crawlers find it late, it
 * inherits no authority from the rest of the site, and readers who liked a
 * neighbouring article never arrive.
 *
 * A document whose `internalInboundLinks` is `undefined` is skipped, not
 * treated as zero. Undefined here means the link graph was not computed for
 * this run, and reporting "linked from nowhere" for every document because a
 * job did not run is precisely the kind of confident wrongness that gets a
 * dashboard closed for good.
 */
export function findOrphans(rows: InsightInput[], options: OrphanOptions = {}): Insight[] {
  const maxInboundLinks = options.maxInboundLinks ?? 1;
  const wellPerforming = options.wellPerformingImpressions ?? 500;

  const insights: Insight[] = [];
  for (const row of rows) {
    if (!isPublished(row.facts)) continue;

    const links = row.facts.internalInboundLinks;
    if (links === undefined) continue;
    if (links > maxInboundLinks) continue;

    const impressions = row.performance.impressions;
    // A page ranking well despite being orphaned is still worth fixing, but it
    // is not what an editor should do before lunch.
    const severity: Insight["severity"] =
      impressions !== undefined && impressions >= wellPerforming ? "low" : links === 0 ? "high" : "medium";

    insights.push({
      kind: INSIGHT_KINDS.orphan,
      documentId: row.facts.documentId,
      severity,
      title:
        links === 0
          ? `"${row.facts.title}" is linked from nowhere on the site`
          : `"${row.facts.title}" has almost no internal links`,
      detail:
        `${links === 0 ? "No" : String(links)} internal link${links === 1 ? "" : "s"} point at this page. ` +
        `Crawlers reach it only through the sitemap and it inherits no authority from the rest of the site.`,
      metric: {
        internalInboundLinks: links,
        ...(impressions === undefined ? {} : { impressions }),
      },
      suggestedAction:
        `Add links to ${row.facts.path} from two or three related published pages — the ones already ` +
        `ranking on the same topic — using the phrasing people search for as the anchor text.`,
    });
  }
  return insights;
}

/* ------------------------------------------------------------------ */
/* 5. Never crawled by an answer engine                                */
/* ------------------------------------------------------------------ */

export interface NeverCrawledOptions {
  now: string;
  /** How long a page must have been live before the absence means anything. Default 30 days. */
  minAgeDays?: number;
}

/**
 * Published a while ago and no AI crawler has ever fetched it.
 *
 * This is the one place in the package where a missing value is read as a
 * zero, and it is worth being explicit about why that is legitimate here and
 * nowhere else: crawler hits are collected first-party by the CMS itself. No
 * third-party connection can be silently disconnected, so "no row" really does
 * mean "no crawler came" rather than "we could not ask".
 *
 * The age floor carries the remaining ambiguity. A page published yesterday
 * that no crawler has seen is not a finding, it is Tuesday. Callers should also
 * only pass documents from sites where crawler logging has been running for
 * longer than `minAgeDays` — otherwise absence reflects when logging started.
 */
export function findNeverCrawledByAi(rows: InsightInput[], options: NeverCrawledOptions): Insight[] {
  const minAgeDays = options.minAgeDays ?? 30;

  const insights: Insight[] = [];
  for (const row of rows) {
    if (!isPublished(row.facts)) continue;

    const ageDays = daysBetween(row.facts.publishedAt, options.now);
    if (ageDays === undefined || ageDays < minAgeDays) continue;

    const crawled = row.facts.lastCrawledByAiAt;
    if (typeof crawled === "string" && crawled.length > 0) continue;

    const severity: Insight["severity"] =
      ageDays >= minAgeDays * 3 ? "high" : ageDays >= minAgeDays * 2 ? "medium" : "low";

    insights.push({
      kind: INSIGHT_KINDS.neverCrawledByAi,
      documentId: row.facts.documentId,
      severity,
      title: `"${row.facts.title}" has never been fetched by an answer engine`,
      detail:
        `Published ${ageDays} days ago and no AI crawler has requested it. Whatever it says, ` +
        `answer engines are not currently able to cite it.`,
      metric: { daysSincePublished: ageDays },
      suggestedAction:
        `Check that ${row.facts.path} is in the sitemap and not blocked in robots.txt for AI user agents, ` +
        `then link to it from a page crawlers already visit often.`,
    });
  }
  return insights;
}

/* ------------------------------------------------------------------ */
/* 6. Thin and underperforming                                         */
/* ------------------------------------------------------------------ */

export interface ThinUnderperformerOptions {
  /** Below this many words a page is thin. Default 500. */
  maxWordCount?: number;
  /** Below this many impressions it is also not working. Default 50. */
  maxImpressions?: number;
  /** Optional; when given, pages younger than `minAgeDays` are skipped. */
  now?: string;
  /** Default 30 days. Only applied when `now` is supplied. */
  minAgeDays?: number;
}

/**
 * Short pages that search has also ignored.
 *
 * Both halves are required. Short and performing is fine — plenty of good
 * answers are 300 words. Long and ignored is a different problem with a
 * different fix. It is the pair that says "this page is not earning its place".
 *
 * Capped at medium severity on purpose. This is backlog work: consolidate,
 * expand or retire. Letting it reach `high` would push genuine, time-sensitive
 * findings down the single ranked list, which is the one thing `rankInsights`
 * exists to prevent.
 */
export function findThinUnderperformers(
  rows: InsightInput[],
  options: ThinUnderperformerOptions = {},
): Insight[] {
  const maxWordCount = options.maxWordCount ?? 500;
  const maxImpressions = options.maxImpressions ?? 50;
  const minAgeDays = options.minAgeDays ?? 30;

  const insights: Insight[] = [];
  for (const row of rows) {
    if (!isPublished(row.facts)) continue;

    const { wordCount } = row.facts;
    const { impressions } = row.performance;
    // Both are required measurements. An unknown word count or unmeasured
    // impressions is not evidence of thinness.
    if (wordCount === undefined || impressions === undefined) continue;
    if (wordCount >= maxWordCount || impressions >= maxImpressions) continue;

    if (options.now !== undefined) {
      const ageDays = daysBetween(row.facts.publishedAt, options.now);
      if (ageDays === undefined || ageDays < minAgeDays) continue;
    }

    const severity: Insight["severity"] = wordCount < maxWordCount / 2 ? "medium" : "low";

    insights.push({
      kind: INSIGHT_KINDS.thinUnderperformer,
      documentId: row.facts.documentId,
      severity,
      title: `"${row.facts.title}" is thin and search is ignoring it`,
      detail:
        `${wordCount.toLocaleString("en-US")} words and ${impressions.toLocaleString("en-US")} impressions ` +
        `over the window. It is neither deep enough to rank nor visible enough to be worth keeping as is.`,
      metric: { wordCount, impressions, clicks: row.performance.clicks ?? 0 },
      suggestedAction:
        `Decide one of three things for ${row.facts.path}: merge it into a stronger page on the same topic ` +
        `and redirect, expand it to genuinely answer the question, or retire it.`,
    });
  }
  return insights;
}

/* ------------------------------------------------------------------ */
/* Ranking                                                             */
/* ------------------------------------------------------------------ */

const SEVERITY_RANK: Record<Insight["severity"], number> = { high: 0, medium: 1, low: 2 };

/**
 * Tie-break between kinds of equal severity, cheapest-and-surest first.
 *
 * A low-CTR page is a title rewrite against a ranking that already exists; a
 * thin page is a decision about whether to keep it at all. Both may be
 * "medium", and the editor should meet the first one first.
 */
const KIND_RANK: Record<string, number> = {
  [INSIGHT_KINDS.lowCtrHighImpressions]: 0,
  [INSIGHT_KINDS.nearMissRanking]: 1,
  [INSIGHT_KINDS.decayingContent]: 2,
  [INSIGHT_KINDS.orphan]: 3,
  [INSIGHT_KINDS.neverCrawledByAi]: 4,
  [INSIGHT_KINDS.thinUnderperformer]: 5,
};

function opportunityOf(insight: Insight): number {
  const impressions = insight.metric?.["impressions"];
  return typeof impressions === "number" ? impressions : -1;
}

/**
 * One ordering across every kind.
 *
 * Six separate lists is six decisions about where to start, made every morning
 * by someone who wanted to be told. So: severity first, then the size of the
 * opportunity (impressions, where a rule measured them), then the kind order
 * above.
 *
 * The final tie-break on `documentId` and `kind` is not decoration — it makes
 * the ordering *total*, so the same findings always render in the same order
 * regardless of the order the rules ran in. A list that reshuffles between two
 * loads of the same data reads as unreliable even when every row is correct.
 * The input array is not mutated, for the same reason a caller should be able
 * to rank twice and get the same answer.
 */
export function rankInsights(insights: Insight[]): Insight[] {
  return [...insights].sort((a, b) => {
    const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;

    const byOpportunity = opportunityOf(b) - opportunityOf(a);
    if (byOpportunity !== 0) return byOpportunity;

    const aKind = KIND_RANK[a.kind] ?? Number.MAX_SAFE_INTEGER;
    const bKind = KIND_RANK[b.kind] ?? Number.MAX_SAFE_INTEGER;
    if (aKind !== bKind) return aKind - bKind;

    if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
    if (a.documentId !== b.documentId) return a.documentId < b.documentId ? -1 : 1;
    return 0;
  });
}
