"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileTextIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Badge,
  DataTable,
  EmptyState,
  LintBadge,
  StatusBadge,
  type DataTableColumn,
} from "@cms/ui";
import { summarizeLintReport } from "./lint-report";
import { RelativeTime } from "./relative-time";
import { editorHref, type DocumentSummary } from "./types";

/**
 * Lint state as one cell.
 *
 * "Never checked" is drawn as a neutral outline badge rather than as a green
 * one, because those are different facts: a document nobody has rendered has
 * no findings *and* no assurance, and colouring it like a clean document would
 * quietly promise a review that never happened.
 */
function LintCell({ report }: { report: unknown }) {
  const summary = summarizeLintReport(report);

  if (!summary.checked) {
    return (
      <Badge variant="outline" title="Lints run on preview and on publish.">
        Not checked
      </Badge>
    );
  }

  return <LintBadge errors={summary.errors} warnings={summary.warnings} />;
}

export interface DocumentTableProps {
  rows: readonly DocumentSummary[];
  siteSlug: string;
  /** Describes the table to assistive technology. */
  caption: string;
  emptyTitle: string;
  emptyDescription: string;
  /** Usually the same "New post" button the page header offers. */
  emptyAction?: ReactNode;
  loading?: boolean;
}

/**
 * The listing table shared by posts, pages and blocks.
 *
 * The three screens differ only in the `type` they query and the words around
 * them, so a per-screen table would be the same file copied three times and
 * three places for the lint semantics above to drift apart.
 */
export function DocumentTable({
  rows,
  siteSlug,
  caption,
  emptyTitle,
  emptyDescription,
  emptyAction,
  loading = false,
}: DocumentTableProps) {
  const router = useRouter();

  /**
   * `search_content` returns no byline today, so rather than a column of
   * dashes the column appears only once rows actually carry one. An always
   * empty column costs horizontal space on a dense screen and teaches readers
   * to ignore that position.
   */
  const showAuthor = rows.some(
    (row) => typeof row.authorName === "string" && row.authorName.length > 0,
  );

  const columns: Array<DataTableColumn<DocumentSummary>> = [
    {
      key: "title",
      header: "Title",
      render: (row) => (
        <div className="min-w-0">
          {/* A real link, not just the row click: this is what middle-click,
              "open in new tab" and sequential keyboard navigation need. */}
          <Link
            href={editorHref(siteSlug, row)}
            className="ui-focus-ring rounded font-medium text-[var(--color-ink)] hover:underline"
          >
            {row.title || "Untitled"}
          </Link>
          <p className="truncate text-xs text-[var(--color-ink-muted)]">/{row.slug}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: "9rem",
      render: (row) => <StatusBadge status={row.status} />,
    },
    ...(showAuthor
      ? [
          {
            key: "author",
            header: "Author",
            width: "10rem",
            render: (row: DocumentSummary) => (
              <span className="truncate text-[var(--color-ink-muted)]">
                {row.authorName}
              </span>
            ),
          },
        ]
      : []),
    {
      key: "updated",
      header: "Updated",
      width: "9rem",
      render: (row) => (
        <RelativeTime value={row.updatedAt} className="text-[var(--color-ink-muted)]" />
      ),
    },
    {
      key: "lint",
      header: "Checks",
      width: "8rem",
      render: (row) => <LintCell report={row.lintReport} />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      getRowKey={(row) => row.id}
      onRowClick={(row) => router.push(editorHref(siteSlug, row))}
      loading={loading}
      caption={caption}
      empty={
        <EmptyState
          icon={FileTextIcon}
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
          className="border-0"
        />
      }
    />
  );
}
