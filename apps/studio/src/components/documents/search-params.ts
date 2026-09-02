import { DOCUMENT_STATUSES, type DocumentStatus } from "@cms/ui";

/**
 * The list screens' state lives in the URL, and this is the one place that
 * knows its spelling.
 *
 * Filters in component state would make a filtered list unlinkable and would
 * not survive a refresh; worse, the screens are server components, so state
 * that never reaches the server cannot narrow the query at all. Putting it in
 * search params means navigation re-runs the fetch, the back button steps
 * through filter changes, and a colleague can be sent "the drafts with lint
 * errors" as a link.
 */

export type RawSearchParams = Record<string, string | string[] | undefined>;

export interface ListFilters {
  status: DocumentStatus | undefined;
  query: string | undefined;
  cursor: string | undefined;
}

/** A repeated param is a malformed URL, not a multi-select; take the first. */
function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function asStatus(value: string | undefined): DocumentStatus | undefined {
  if (value === undefined) return undefined;
  // An unrecognised status is dropped rather than sent to the capability,
  // which would answer a hand-edited URL with a validation error page.
  return (DOCUMENT_STATUSES as readonly string[]).includes(value)
    ? (value as DocumentStatus)
    : undefined;
}

export function parseListFilters(params: RawSearchParams): ListFilters {
  return {
    status: asStatus(first(params.status)),
    query: first(params.q),
    cursor: first(params.cursor),
  };
}

/**
 * Build a link to the list with some filters changed.
 *
 * `cursor` is omitted unless explicitly asked for: a keyset cursor encodes a
 * position in one particular ordered result set, so carrying it across a
 * filter change would page into a list that no longer exists.
 */
export function listHref(
  basePath: string,
  filters: Partial<ListFilters>,
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.query) params.set("q", filters.query);
  if (filters.cursor) params.set("cursor", filters.cursor);
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

/** True when the reader has narrowed the list in any way. */
export function hasActiveFilters(filters: ListFilters): boolean {
  return filters.status !== undefined || filters.query !== undefined;
}
