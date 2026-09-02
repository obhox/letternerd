import type { RuleCoverage, TimeToFirstCrawlRow } from "@cms/capabilities";

/**
 * The shapes the insights screen renders.
 *
 * Taken from the capability where it exports a named type, so the rule
 * coverage a screen renders and the coverage a rule reports cannot drift. The
 * rest are the parts of an inferred handler return type there is no name for
 * yet; they transform dates to ISO strings for the client boundary.
 */

export interface InsightView {
  kind: string;
  documentId: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  metric?: Record<string, number | string>;
  suggestedAction: string;
}

export interface InsightDocument {
  id: string;
  type: string;
  slug: string;
  title: string;
  path: string;
}

export type RuleCoverageView = RuleCoverage;

export interface CoverageView {
  provider: { name: string; audience: boolean; search: boolean; error: string | null } | null;
  documentsAnalysed: number;
  linkGraphComputed: boolean;
  rules: RuleCoverageView[];
  skippedRules: string[];
  complete: boolean;
}

export interface CrawlerBotSeries {
  botName: string;
  hits: number;
  days: { date: string; hits: number }[];
}

export type CrawlTimingView = Omit<TimeToFirstCrawlRow, "publishedAt" | "firstAiCrawlAt"> & {
  publishedAt: string | null;
  firstAiCrawlAt: string | null;
};

export interface CrawlerActivityView {
  days: number;
  byBot: CrawlerBotSeries[];
  timeToFirstCrawl: {
    rows: CrawlTimingView[];
    medianHours: number | null;
    crawledCount: number;
    neverCount: number;
    unknownCount: number;
    rawHitRetentionDays: number;
    logRetainedSince: string | null;
  };
}

/** Human labels for the rule identifiers the capability reports. */
export const RULE_LABELS: Record<string, string> = {
  "low-ctr-high-impressions": "Seen in search, rarely clicked",
  "near-miss-ranking": "Just off page one",
  "decaying-content": "Losing ground",
  orphan: "Linked from nowhere",
  "never-crawled-by-ai": "Never fetched by an answer engine",
  "thin-underperformer": "Thin and ignored",
};

/** Labels for the numbers a rule attaches to its finding. */
export const METRIC_LABELS: Record<string, string> = {
  impressions: "impressions",
  clicks: "clicks",
  ctr: "CTR",
  position: "avg. position",
  positionBand: "position band",
  bandMedianCtr: "band median CTR",
  internalInboundLinks: "inbound internal links",
  daysSincePublished: "days since published",
  daysSinceUpdated: "days since updated",
  wordCount: "words",
  previousClicks: "clicks before",
  currentClicks: "clicks now",
  clickDropRatio: "clicks lost",
  previousPosition: "position before",
  currentPosition: "position now",
  positionDropPoints: "positions lost",
};
