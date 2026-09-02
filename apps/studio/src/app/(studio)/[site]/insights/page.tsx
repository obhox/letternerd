import type { Metadata } from "next";
import { PageHeader } from "@cms/ui";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { CrawlerActivity } from "@/components/insights/crawler-activity";
import { InsightList } from "@/components/insights/insight-list";
import { ProviderNotice } from "@/components/insights/provider-notice";
import type {
  CoverageView,
  CrawlerActivityView,
  InsightDocument,
  InsightView,
} from "@/components/insights/types";

export const metadata: Metadata = { title: "Insights" };

interface ListInsightsResult {
  insights: InsightView[];
  documents: InsightDocument[];
  generatedAt: Date;
  range: { start: string; end: string };
  coverage: CoverageView;
}

interface CrawlerHitsResult {
  range: { days: number };
  byBot: { botName: string; hits: number; days: { date: string; hits: number }[] }[];
  timeToFirstCrawl: {
    rows: {
      documentId: string;
      title: string;
      slug: string;
      publishedAt: Date | null;
      firstAiCrawlAt: Date | null;
      hoursToFirstCrawl: number | null;
      state: "crawled" | "never" | "unknown";
      unknownBecause?: string;
    }[];
    medianHours: number | null;
    crawledCount: number;
    neverCount: number;
    unknownCount: number;
    rawHitRetentionDays: number;
    logRetainedSince: Date | null;
  };
}

const WINDOW_DAYS = 28;

/**
 * Insights.
 *
 * Ordered by what an editor should do, not by what happened. The ranked list is
 * first and the crawler view is underneath it, because "ClaudeBot fetched 412
 * pages last week" is interesting and "this post has 4,000 impressions and a
 * broken title" is actionable, and a screen that leads with the first buries
 * the second.
 *
 * The honesty rule runs through the whole page: no chart is drawn from data
 * that does not exist, no unmeasured metric is rendered as zero, and the
 * checks that could not run are named at the top rather than left to be
 * inferred from a short list.
 */
export default async function InsightsPage({ params }: { params: Promise<{ site: string }> }) {
  const { site: slug } = await params;
  const ctx = await studioContext(slug);

  // Independent reads; there is no reason for the crawler panel to wait on the
  // link-graph pass that `list_insights` performs.
  const [insights, crawler] = await Promise.all([
    dispatchOrThrow<ListInsightsResult>(ctx, "list_insights", { days: WINDOW_DAYS }),
    dispatchOrThrow<CrawlerHitsResult>(ctx, "get_crawler_hits", { days: WINDOW_DAYS }),
  ]);

  const activity: CrawlerActivityView = {
    days: crawler.range.days,
    byBot: crawler.byBot,
    timeToFirstCrawl: {
      ...crawler.timeToFirstCrawl,
      rows: crawler.timeToFirstCrawl.rows.map((row) => ({
        ...row,
        publishedAt: row.publishedAt?.toISOString() ?? null,
        firstAiCrawlAt: row.firstAiCrawlAt?.toISOString() ?? null,
      })),
      logRetainedSince: crawler.timeToFirstCrawl.logRetainedSince?.toISOString() ?? null,
    },
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Insights"
        description={`What to do next, ranked. Based on the last ${WINDOW_DAYS} days and ${insights.coverage.documentsAnalysed} published documents.`}
      />

      <ProviderNotice coverage={insights.coverage} />

      <section>
        <h2 className="pb-2 text-sm font-semibold text-[var(--color-ink)]">
          Worth doing{insights.insights.length > 0 ? ` (${insights.insights.length})` : ""}
        </h2>
        <InsightList
          siteSlug={slug}
          insights={insights.insights}
          documents={insights.documents}
          coverage={insights.coverage}
        />
      </section>

      <section className="border-t border-[var(--color-border)] pt-6">
        <h2 className="pb-3 text-sm font-semibold text-[var(--color-ink)]">AI crawlers</h2>
        <CrawlerActivity siteSlug={slug} activity={activity} documents={insights.documents} />
      </section>
    </div>
  );
}
