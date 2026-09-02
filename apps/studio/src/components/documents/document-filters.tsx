"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition, type FormEvent } from "react";
import {
  Button,
  DOCUMENT_STATUSES,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Toolbar,
  ToolbarGroup,
  statusLabel,
  type DocumentStatus,
} from "@cms/ui";
import { hasActiveFilters, listHref, type ListFilters } from "./search-params";

/** Radix needs a non-empty value per item, and "no filter" needs a spelling. */
const ANY_STATUS = "all";

export interface DocumentFiltersProps {
  /** The list screen's path, e.g. `/acme/posts`. */
  basePath: string;
  filters: ListFilters;
  /** Plural noun for the labels — "posts", "pages", "blocks". */
  plural: string;
}

/**
 * Status and free-text filters, written to the URL rather than to state.
 *
 * Every control here navigates. That is the whole design: the screen behind it
 * is a server component, so the URL is the only channel a filter can travel
 * down, and routing through it buys linkability, refresh-survival and a back
 * button that steps through filter changes for free.
 */
export function DocumentFilters({ basePath, filters, plural }: DocumentFiltersProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const searchId = useId();

  /**
   * The text box is the one control that cannot navigate on every keystroke,
   * so it holds a draft — resynchronised whenever the URL's own value moves
   * underneath it, which is what "Clear" and the back button do. Adjusting
   * during render rather than in an effect avoids rendering the stale text
   * first and correcting it a frame later.
   */
  const [draft, setDraft] = useState(filters.query ?? "");
  const [seenQuery, setSeenQuery] = useState(filters.query);
  if (filters.query !== seenQuery) {
    setSeenQuery(filters.query);
    setDraft(filters.query ?? "");
  }

  function go(next: Partial<ListFilters>): void {
    // No cursor: any filter change invalidates the keyset position it encodes.
    startTransition(() => {
      router.push(listHref(basePath, { status: filters.status, query: filters.query, ...next }));
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    go({ query: draft.trim() || undefined });
  }

  const active = hasActiveFilters(filters);

  return (
    <Toolbar
      aria-label={`Filter ${plural}`}
      className="h-auto flex-wrap gap-2 rounded-lg border border-[var(--color-border)] px-2 py-2"
    >
      {/* A real form, so Enter in the text box searches without a mouse.
          No `role="search"`: that is a landmark, and a landmark nested inside a
          toolbar is not a structure assistive technology can make sense of. */}
      <form onSubmit={onSubmit} className="flex items-center gap-2">
        <label htmlFor={searchId} className="sr-only">
          Search {plural}
        </label>
        <Input
          id={searchId}
          type="search"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={`Search ${plural}…`}
          className="w-56"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <ToolbarGroup>
        <Select
          value={filters.status ?? ANY_STATUS}
          onValueChange={(value) =>
            go({ status: value === ANY_STATUS ? undefined : (value as DocumentStatus) })
          }
        >
          <SelectTrigger aria-label="Filter by status" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY_STATUS}>Any status</SelectItem>
            {DOCUMENT_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {statusLabel(status)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </ToolbarGroup>

      <ToolbarGroup className="ml-auto">
        {pending && <Spinner size="sm" label="Loading results" className="text-[var(--color-ink-muted)]" />}
        {active && (
          <Button asChild variant="ghost">
            <Link href={basePath}>Clear filters</Link>
          </Button>
        )}
      </ToolbarGroup>
    </Toolbar>
  );
}
