import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { ChevronRightIcon, PlusIcon } from "lucide-react";
import { Button, PageHeader } from "@cms/ui";
import { dispatchOrThrow, studioContext } from "@/server/context";
import { DocumentFilters } from "./document-filters";
import { DocumentTable } from "./document-table";
import { listHref, parseListFilters, type ListFilters, type RawSearchParams } from "./search-params";
import { TYPE_META, type DocumentPage, type DocumentType } from "./types";

/**
 * Small enough that a page arrives quickly on a slow connection, large enough
 * that an editor scanning for one document rarely pages at all.
 */
const PAGE_SIZE = 25;

export interface DocumentListScreenProps {
  siteSlug: string;
  type: DocumentType;
  searchParams: RawSearchParams;
}

function newDocumentHref(siteSlug: string, type: DocumentType): string {
  // One create screen serves all three types; it reads `type` from the URL so
  // arriving from Pages does not silently start a post.
  return `/${siteSlug}/posts/new?type=${type}`;
}

function NewDocumentButton({ siteSlug, type }: { siteSlug: string; type: DocumentType }) {
  return (
    <Button asChild>
      <Link href={newDocumentHref(siteSlug, type)}>
        <PlusIcon aria-hidden="true" />
        New {TYPE_META[type].singular}
      </Link>
    </Button>
  );
}

/**
 * The list itself, split out so the header and the filters paint immediately
 * and only the query streams in behind a Suspense boundary. On a large site
 * the full-text branch of `search_content` is the slow part of this screen,
 * and blocking the controls on it would mean the reader cannot even retype a
 * filter while waiting for the last one.
 */
async function DocumentRows({
  siteSlug,
  type,
  filters,
  basePath,
}: {
  siteSlug: string;
  type: DocumentType;
  filters: ListFilters;
  basePath: string;
}) {
  const meta = TYPE_META[type];
  const ctx = await studioContext(siteSlug);
  const { documents, nextCursor } = await dispatchOrThrow<DocumentPage>(ctx, "search_content", {
    type,
    status: filters.status,
    query: filters.query,
    cursor: filters.cursor,
    limit: PAGE_SIZE,
  });

  const filtered = filters.status !== undefined || filters.query !== undefined;

  return (
    <div className="flex flex-col gap-3">
      <DocumentTable
        rows={documents}
        siteSlug={siteSlug}
        caption={`${meta.title} on this site`}
        emptyTitle={filtered ? `No ${meta.plural} match these filters` : meta.emptyTitle}
        emptyDescription={
          filtered
            ? "Try a different status, or clear the search."
            : meta.emptyDescription
        }
        emptyAction={filtered ? undefined : <NewDocumentButton siteSlug={siteSlug} type={type} />}
      />

      {(documents.length > 0 || filters.cursor !== undefined) && (
        <nav aria-label={`${meta.title} pagination`} className="flex items-center gap-3">
          <p className="text-xs text-[var(--color-ink-muted)]">
            {documents.length} {documents.length === 1 ? meta.singular : meta.plural} on this page
          </p>
          <div className="ml-auto flex items-center gap-2">
            {/*
              Keyset pagination has a next and no previous — the cursor names a
              row, not an offset, so there is no arithmetic that walks back.
              Numbered pages would have to invent a total and an offset the
              query cannot honour, so the way back is to the start.
            */}
            {filters.cursor !== undefined && (
              <Button asChild variant="outline">
                <Link href={listHref(basePath, { status: filters.status, query: filters.query })}>
                  First page
                </Link>
              </Button>
            )}
            {nextCursor !== null && (
              <Button asChild variant="outline">
                <Link
                  href={listHref(basePath, {
                    status: filters.status,
                    query: filters.query,
                    cursor: nextCursor,
                  })}
                >
                  Next
                  <ChevronRightIcon aria-hidden="true" />
                </Link>
              </Button>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}

/** The whole screen for one document type. Posts, pages and blocks differ only in words. */
export function DocumentListScreen({
  siteSlug,
  type,
  searchParams,
}: DocumentListScreenProps): ReactNode {
  const meta = TYPE_META[type];
  const basePath = `/${siteSlug}/${meta.section}`;
  const filters = parseListFilters(searchParams);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={meta.title}
        description={meta.description}
        actions={<NewDocumentButton siteSlug={siteSlug} type={type} />}
        className="pb-0"
      />

      <DocumentFilters basePath={basePath} filters={filters} plural={meta.plural} />

      {/*
        Keyed on the filters so a navigation re-shows the skeleton rather than
        leaving the previous page's rows on screen looking like the answer.
      */}
      <Suspense
        key={`${filters.status ?? ""}|${filters.query ?? ""}|${filters.cursor ?? ""}`}
        fallback={
          <DocumentTable
            rows={[]}
            siteSlug={siteSlug}
            caption={`${meta.title} on this site`}
            emptyTitle={meta.emptyTitle}
            emptyDescription={meta.emptyDescription}
            loading
          />
        }
      >
        <DocumentRows siteSlug={siteSlug} type={type} filters={filters} basePath={basePath} />
      </Suspense>
    </div>
  );
}
