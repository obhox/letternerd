import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { CalendarClockIcon, CircleAlertIcon, PlusIcon } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DOCUMENT_STATUSES,
  PageHeader,
  StatusBadge,
  Spinner,
  type DocumentStatus,
} from "@cms/ui";
import { dispatchOrThrow, studioContext, type StudioContext } from "@/server/context";
import { summarizeLintReport } from "@/components/documents/lint-report";
import { RelativeTime } from "@/components/documents/relative-time";
import { listHref } from "@/components/documents/search-params";
import {
  editorHref,
  TYPE_META,
  type DocumentPage,
  type DocumentSummary,
  type DocumentType,
} from "@/components/documents/types";

export const metadata: Metadata = { title: "Overview" };

/**
 * The listing capability's ceiling, and therefore the ceiling of every number
 * on this screen.
 *
 * There is no aggregate-count capability, so a "total" here would have to be
 * invented. What this screen can say truthfully is "at least this many", and
 * it says exactly that — see `formatCount`.
 */
const SCAN_LIMIT = 100;

interface StatusBucket {
  status: DocumentStatus;
  documents: DocumentSummary[];
  /** More rows exist than were scanned, so the count is a floor, not a total. */
  capped: boolean;
}

async function scanStatus(ctx: StudioContext, status: DocumentStatus): Promise<StatusBucket> {
  const page = await dispatchOrThrow<DocumentPage>(ctx, "search_content", {
    status,
    limit: SCAN_LIMIT,
  });
  return { status, documents: page.documents, capped: page.nextCursor !== null };
}

function formatCount(bucket: StatusBucket): string {
  return bucket.capped ? `${bucket.documents.length}+` : String(bucket.documents.length);
}

function byNewest(a: DocumentSummary, b: DocumentSummary): number {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function countByType(documents: readonly DocumentSummary[]): Array<[DocumentType, number]> {
  const counts = new Map<DocumentType, number>();
  for (const doc of documents) counts.set(doc.type, (counts.get(doc.type) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/** One row of the recent/attention lists: a link, a badge and a timestamp. */
function DocumentLine({
  siteSlug,
  doc,
  trailing,
}: {
  siteSlug: string;
  doc: DocumentSummary;
  trailing?: ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 border-b border-[var(--color-border)] py-2 last:border-b-0">
      <Link
        href={editorHref(siteSlug, doc)}
        className="ui-focus-ring min-w-0 flex-1 truncate rounded text-sm text-[var(--color-ink)] hover:underline"
      >
        {doc.title || "Untitled"}
      </Link>
      {trailing}
    </li>
  );
}

async function Overview({ siteSlug }: { siteSlug: string }) {
  const ctx = await studioContext(siteSlug);

  /**
   * Five scans, one per status, rather than one broad scan.
   *
   * They ride `documents_site_status_updated_idx` exactly, and between them
   * they also produce the recent list and the lint pool below, so the screen
   * costs five queries rather than five plus two more that would return
   * substantially the same rows.
   */
  const buckets = await Promise.all(
    DOCUMENT_STATUSES.map((status) => scanStatus(ctx, status)),
  );

  const everything = buckets.flatMap((bucket) => bucket.documents).sort(byNewest);
  const recent = everything.slice(0, 8);

  const scheduledBucket = buckets.find((bucket) => bucket.status === "scheduled");
  const scheduled = (scheduledBucket?.documents ?? []).slice(0, 5);

  /**
   * The listing payload has no `scheduledFor`, and "scheduled" without the
   * time it goes live is barely worth showing — so the handful on screen are
   * fetched individually for the one field that makes the card mean anything.
   */
  const scheduledDetails = await Promise.all(
    scheduled.map(async (doc) => {
      const full = await dispatchOrThrow<{ scheduledFor: Date | string | null }>(
        ctx,
        "get_document",
        { id: doc.id },
      );
      return { doc, scheduledFor: full.scheduledFor };
    }),
  );

  const needsAttention = everything
    .map((doc) => ({ doc, lint: summarizeLintReport(doc.lintReport) }))
    .filter((entry) => entry.lint.errors > 0)
    .slice(0, 8);

  const scanned = everything.length;
  const anyCapped = buckets.some((bucket) => bucket.capped);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Content by status</CardTitle>
          {anyCapped ? (
            <CardDescription>
              {`Counts stop at the ${SCAN_LIMIT} most recently updated per status; "+" means more.`}
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {buckets.map((bucket) => (
              <div
                key={bucket.status}
                className="rounded-md border border-[var(--color-border)] p-3"
              >
                <dt className="flex items-center justify-between gap-2">
                  <StatusBadge status={bucket.status} />
                </dt>
                <dd className="mt-2">
                  <p className="text-2xl leading-none font-semibold text-[var(--color-ink)]">
                    {formatCount(bucket)}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {bucket.capped ? (
                      // A breakdown of a truncated scan would be a sample
                      // dressed up as a census, so it is withheld entirely.
                      <span className="text-[var(--color-ink-muted)]">
                        More than {SCAN_LIMIT}
                      </span>
                    ) : bucket.documents.length === 0 ? (
                      <span className="text-[var(--color-ink-muted)]">None</span>
                    ) : (
                      countByType(bucket.documents).map(([type, count]) => (
                        <Link
                          key={type}
                          href={listHref(`/${siteSlug}/${TYPE_META[type].section}`, {
                            status: bucket.status,
                          })}
                          className="ui-focus-ring rounded text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] hover:underline"
                        >
                          {count} {count === 1 ? TYPE_META[type].singular : TYPE_META[type].plural}
                        </Link>
                      ))
                    )}
                  </div>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recently updated</CardTitle>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-ink-muted)]">
              Nothing yet.
            </p>
          ) : (
            <ul>
              {recent.map((doc) => (
                <DocumentLine
                  key={doc.id}
                  siteSlug={siteSlug}
                  doc={doc}
                  trailing={
                    <>
                      <StatusBadge status={doc.status} />
                      <RelativeTime
                        value={doc.updatedAt}
                        className="w-24 shrink-0 text-right text-xs text-[var(--color-ink-muted)]"
                      />
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClockIcon className="size-4 text-[var(--color-ink-muted)]" aria-hidden="true" />
            Scheduled
          </CardTitle>
        </CardHeader>
        <CardContent>
          {scheduledDetails.length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-ink-muted)]">Nothing is scheduled.</p>
          ) : (
            <ul>
              {scheduledDetails.map(({ doc, scheduledFor }) => (
                <DocumentLine
                  key={doc.id}
                  siteSlug={siteSlug}
                  doc={doc}
                  trailing={
                    <RelativeTime
                      value={scheduledFor}
                      fallback="No time set"
                      className="shrink-0 text-xs text-[var(--color-ink-muted)]"
                    />
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlertIcon className="size-4 text-[var(--color-danger)]" aria-hidden="true" />
            Needs attention
          </CardTitle>
          <CardDescription>
            Lint errors, which the publish gate refuses. Warnings and unchecked documents are
            not listed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {needsAttention.length === 0 ? (
            <p className="py-4 text-sm text-[var(--color-ink-muted)]">
              No blocking findings among the {scanned}{" "}
              {scanned === 1 ? "document" : "documents"} checked.
            </p>
          ) : (
            <ul>
              {needsAttention.map(({ doc, lint }) => (
                <DocumentLine
                  key={doc.id}
                  siteSlug={siteSlug}
                  doc={doc}
                  trailing={
                    <>
                      <span className="hidden max-w-sm truncate text-xs text-[var(--color-ink-muted)] sm:block">
                        {lint.findings.find((finding) => finding.severity === "error")?.message}
                      </span>
                      <Badge variant="danger">
                        {lint.errors} {lint.errors === 1 ? "error" : "errors"}
                      </Badge>
                    </>
                  }
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default async function OverviewPage({ params }: { params: Promise<{ site: string }> }) {
  const { site } = await params;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Overview"
        className="pb-0"
        actions={
          <Button asChild>
            <Link href={`/${site}/posts/new`}>
              <PlusIcon aria-hidden="true" />
              New post
            </Link>
          </Button>
        }
      />
      <Suspense
        fallback={
          <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-ink-muted)]">
            <Spinner size="sm" label="Loading the site overview" />
            Loading…
          </div>
        }
      >
        <Overview siteSlug={site} />
      </Suspense>
    </div>
  );
}
