import Link from "next/link";
import { ArrowRightIcon, CheckCircle2Icon } from "lucide-react";
import { Badge, EmptyState } from "@cms/ui";
import {
  METRIC_LABELS,
  RULE_LABELS,
  type CoverageView,
  type InsightDocument,
  type InsightView,
} from "./types";

/**
 * The ranked list of things to do.
 *
 * Ordered by the capability, not here — `rankInsights` produces one total
 * order across every rule so that the answer to "what should I do first" is the
 * top of one list rather than a judgement call across six. Re-sorting in the UI
 * would quietly undo that.
 *
 * Each row is finding, evidence and action, in that order, and ends in a link
 * to the editor for the document in question. A finding an editor has to go and
 * look up is a finding they will not act on.
 */

const SEVERITY_VARIANT = {
  high: "danger",
  medium: "warning",
  low: "outline",
} as const;

const SEVERITY_LABEL = {
  high: "Do this first",
  medium: "Worth doing",
  low: "Backlog",
} as const;

/** Numbers are the evidence, so they are formatted rather than dumped. */
function formatMetric(key: string, value: number | string): string {
  if (typeof value === "string") return value;
  if (key === "ctr" || key === "bandMedianCtr" || key === "clickDropRatio") {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (key === "position" || key === "previousPosition" || key === "currentPosition") {
    return value.toFixed(1);
  }
  return value.toLocaleString();
}

function editorHref(siteSlug: string, document: InsightDocument | undefined): string | null {
  if (!document) return null;
  // The studio routes documents by their plural type: posts, pages, blocks.
  return `/${siteSlug}/${document.type}s/${document.id}`;
}

export function InsightList({
  siteSlug,
  insights,
  documents,
  coverage,
}: {
  siteSlug: string;
  insights: InsightView[];
  documents: InsightDocument[];
  coverage: CoverageView;
}) {
  const byId = new Map(documents.map((document) => [document.id, document]));

  if (insights.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2Icon}
        title={
          coverage.complete
            ? "Nothing needs attention"
            : "Nothing found by the checks that could run"
        }
        description={
          coverage.complete
            ? `Every rule ran against ${coverage.documentsAnalysed} published documents and found nothing.`
            : "The checks that ran found nothing. That is not the same as everything being fine — see the skipped checks above."
        }
      />
    );
  }

  return (
    <ol className="flex flex-col gap-3">
      {insights.map((insight, index) => {
        const document = byId.get(insight.documentId);
        const href = editorHref(siteSlug, document);
        const metrics = Object.entries(insight.metric ?? {});

        return (
          <li
            key={`${insight.kind}-${insight.documentId}-${index}`}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={SEVERITY_VARIANT[insight.severity]}>
                {SEVERITY_LABEL[insight.severity]}
              </Badge>
              <Badge variant="default">{RULE_LABELS[insight.kind] ?? insight.kind}</Badge>
              {document && (
                <code className="ml-auto truncate font-mono text-xs text-[var(--color-ink-muted)]">
                  {document.path}
                </code>
              )}
            </div>

            <h3 className="mt-2 text-sm font-semibold text-[var(--color-ink)]">{insight.title}</h3>

            {/* The evidence, in the rule's own words — it already states the
                numbers in context, which is more useful than a bare figure. */}
            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{insight.detail}</p>

            {metrics.length > 0 && (
              <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                {metrics.map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-1.5">
                    <dt className="text-xs text-[var(--color-ink-muted)]">
                      {METRIC_LABELS[key] ?? key}
                    </dt>
                    <dd className="font-mono text-xs font-medium text-[var(--color-ink)]">
                      {formatMetric(key, value)}
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            <div className="mt-3 border-t border-[var(--color-border)] pt-3">
              <p className="text-sm text-[var(--color-ink)]">
                <span className="font-medium">Do this: </span>
                {insight.suggestedAction}
              </p>

              {href && (
                <Link
                  href={href}
                  className="ui-focus-ring mt-2 inline-flex items-center gap-1 rounded text-sm font-medium text-[var(--color-accent)] hover:underline"
                >
                  Open “{document?.title}” in the editor
                  <ArrowRightIcon className="size-3.5" aria-hidden="true" />
                </Link>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
