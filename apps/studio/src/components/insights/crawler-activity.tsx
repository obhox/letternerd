import Link from "next/link";
import { BotIcon } from "lucide-react";
import { Badge, EmptyState } from "@cms/ui";
import type { CrawlerActivityView, InsightDocument } from "./types";

/**
 * What answer engines actually did with this site's pages.
 *
 * The interesting number here is not volume, it is latency: how long after
 * publishing a crawler first arrived. That is the only direct evidence that
 * sitemap `lastmod` and on-demand revalidation are doing their job, and it is
 * the reason this section exists at all.
 *
 * Nothing on this screen renders a zero it did not measure. An empty window
 * says it is empty; a document whose crawl history predates the retained log
 * says "unknown" rather than "never", because those two answers send an editor
 * in opposite directions — one to check robots.txt, the other to stop worrying.
 */

function formatHours(hours: number): string {
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}

function editorHref(siteSlug: string, document: InsightDocument | undefined, id: string): string {
  return `/${siteSlug}/${document?.type ?? "post"}s/${id}`;
}

export function CrawlerActivity({
  siteSlug,
  activity,
  documents,
}: {
  siteSlug: string;
  activity: CrawlerActivityView;
  documents: InsightDocument[];
}) {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const timing = activity.timeToFirstCrawl;

  // One scale across every bot's row, so two rows of the same height mean the
  // same number of hits. Per-row scaling would make a bot with three hits look
  // as busy as one with three hundred.
  const peak = Math.max(1, ...activity.byBot.flatMap((bot) => bot.days.map((day) => day.hits)));

  const neverCrawled = timing.rows.filter((row) => row.state === "never");
  const unknown = timing.rows.filter((row) => row.state === "unknown");

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">
          Hits by bot, last {activity.days} days
        </h3>

        {activity.byBot.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              icon={BotIcon}
              title="No crawler hits recorded in this window"
              // Explicitly not "0 hits": if the logging middleware is not
              // deployed on the consuming site, no row will ever appear, and a
              // chart of zeroes would look like a crawling problem instead of
              // an instrumentation one.
              description="Either no bot fetched a page in this period, or the consuming site is not reporting crawler hits to the CMS. Both look identical from here, so nothing is charted."
            />
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {activity.byBot.map((bot) => (
              <li key={bot.botName}>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium text-[var(--color-ink)]">{bot.botName}</span>
                  <span className="font-mono text-xs text-[var(--color-ink-muted)]">
                    {bot.hits.toLocaleString()} hits
                  </span>
                </div>
                <div className="ui-scroll mt-1 flex h-12 items-end gap-0.5 overflow-x-auto">
                  {bot.days.map((day) => (
                    <span
                      key={day.date}
                      title={`${day.date}: ${day.hits} hits`}
                      className="w-2 shrink-0 rounded-t bg-[var(--color-accent)]"
                      // A floor of 2px so a day with one hit is visible as a
                      // day with one hit rather than as no day at all.
                      style={{ height: `${Math.max(2, (day.hits / peak) * 48)}px` }}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-[var(--color-ink)]">Time to first crawl</h3>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          How long after publishing an AI crawler first fetched each document. This is what proves
          the sitemap’s <code className="font-mono text-xs">lastmod</code> and on-demand
          revalidation are working.
        </p>

        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <dt className="text-xs text-[var(--color-ink-muted)]">Median</dt>
            <dd className="mt-0.5 text-lg font-semibold text-[var(--color-ink)]">
              {timing.medianHours === null ? (
                // Not "0 h". No document in the retained log has both a publish
                // date and a first crawl, which is a measurement problem, not a
                // fast one.
                <span className="text-sm font-normal text-[var(--color-ink-muted)]">
                  Not measured
                </span>
              ) : (
                formatHours(timing.medianHours)
              )}
            </dd>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <dt className="text-xs text-[var(--color-ink-muted)]">Measured</dt>
            <dd className="mt-0.5 text-lg font-semibold text-[var(--color-ink)]">
              {timing.crawledCount}
            </dd>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <dt className="text-xs text-[var(--color-ink-muted)]">Never crawled</dt>
            <dd className="mt-0.5 text-lg font-semibold text-[var(--color-ink)]">
              {timing.neverCount}
            </dd>
          </div>

          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
            <dt className="text-xs text-[var(--color-ink-muted)]">Unknown</dt>
            <dd className="mt-0.5 text-lg font-semibold text-[var(--color-ink)]">
              {timing.unknownCount}
            </dd>
          </div>
        </dl>

        <p className="mt-2 text-xs text-[var(--color-ink-muted)]">
          Raw crawler hits are kept for {timing.rawHitRetentionDays} days
          {timing.logRetainedSince
            ? `, and this site's log currently reaches back to ${new Date(timing.logRetainedSince).toLocaleDateString()}`
            : ", and this site has no crawler hits recorded at all"}
          . Documents published before that are counted as unknown rather than as never crawled — a
          pruned hit and an absent one look the same.
        </p>
      </section>

      {neverCrawled.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">
            No AI crawler has ever fetched these
          </h3>
          <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            {neverCrawled.map((row) => (
              <li key={row.documentId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Link
                  href={editorHref(siteSlug, byId.get(row.documentId), row.documentId)}
                  className="ui-focus-ring min-w-0 flex-1 truncate rounded font-medium text-[var(--color-accent)] hover:underline"
                >
                  {row.title}
                </Link>
                <Badge variant="danger">Never fetched</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unknown.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-[var(--color-ink)]">Not measurable</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
            These have no first-crawl time that can be trusted. They are listed separately rather
            than counted as never crawled, because acting on the wrong one of those two wastes an
            afternoon on a sitemap that is already fine.
          </p>
          <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
            {unknown.map((row) => (
              <li key={row.documentId} className="px-3 py-2 text-sm">
                <Link
                  href={editorHref(siteSlug, byId.get(row.documentId), row.documentId)}
                  className="ui-focus-ring rounded font-medium text-[var(--color-accent)] hover:underline"
                >
                  {row.title}
                </Link>
                {row.unknownBecause && (
                  <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{row.unknownBecause}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
