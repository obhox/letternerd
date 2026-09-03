import type { FetchLike, NextFetchInit } from "../http";
import type { CmsPost, CmsPostSummary, CmsSite } from "../types";

/**
 * A `fetch` that never touches a network.
 *
 * Every test in this package drives the client through this, which is the only
 * way to assert the things that actually matter about an HTTP client: which
 * headers it sent, which cache tags it declared, and what it does with a status
 * code. A test that hit a real API would assert none of them reliably.
 */

export interface RecordedCall {
  url: URL;
  init: NextFetchInit | undefined;
}

export interface FakeFetch {
  fetch: FetchLike;
  calls: RecordedCall[];
  /** The last call, for the common single-request assertion. */
  last(): RecordedCall;
}

export type Handler = (
  url: URL,
  init: NextFetchInit | undefined,
  callIndex: number,
) => Response | Promise<Response>;

export function fakeFetch(handler: Handler): FakeFetch {
  const calls: RecordedCall[] = [];

  const fetchImpl: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    return handler(url, init, calls.length - 1);
  };

  return {
    fetch: fetchImpl,
    calls,
    last() {
      const call = calls[calls.length - 1];
      if (!call) throw new Error("No fetch calls were recorded.");
      return call;
    },
  };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

export function apiError(status: number, code: string, message = "nope"): Response {
  return json({ error: code, message }, { status });
}

export const site: CmsSite = {
  id: "site_1",
  name: "SpendTab",
  baseUrl: "https://spendtab.com",
  blogBasePath: "/blog",
  locale: "en-GB",
  orgName: "SpendTab Ltd",
  orgLogoUrl: "/logo.png",
  orgSameAs: ["https://www.linkedin.com/company/spendtab"],
  twitterHandle: "@spendtab",
  feedTitle: "The SpendTab Blog",
  feedDescription: "Spend management, written down.",
  llmsIntro: "SpendTab is a spend management tool.",
};

export function summary(overrides: Partial<CmsPostSummary> = {}): CmsPostSummary {
  const slug = overrides.slug ?? "cash-flow-basics";
  return {
    id: `doc_${slug}`,
    type: "post",
    status: "published",
    slug,
    title: "Cash flow basics",
    description: "What cash flow is and why it bites.",
    excerpt: "A short excerpt.",
    canonicalUrl: `https://spendtab.com/blog/${slug}`,
    publishedAt: "2026-01-05T09:00:00.000Z",
    dateModified: "2026-02-01T09:00:00.000Z",
    updatedAt: "2026-02-01T09:00:00.000Z",
    readingTimeMinutes: 6,
    wordCount: 1200,
    author: { name: "Jane Doe", slug: "jane-doe", jobTitle: "Finance Writer" },
    category: { name: "Finance", slug: "finance" },
    tags: [
      { name: "Cash flow", slug: "cash-flow" },
      { name: "Pricing", slug: "pricing" },
    ],
    ...overrides,
  };
}

export function post(overrides: Partial<CmsPost> = {}): CmsPost {
  return {
    ...summary(overrides as Partial<CmsPostSummary>),
    subtitle: null,
    bodyHtml: '<p class="cms-tldr">Cash flow is timing.</p><p>Body.</p>',
    bodyText: "Cash flow is timing. Body.",
    bodyMdPublic: "---\ntitle: \"Cash flow basics\"\n---\n\n# Cash flow basics\n\nBody.",
    headings: [{ depth: 2, text: "Body", id: "body" }],
    tldr: "Cash flow is timing.",
    keyTakeaways: ["Invoice earlier."],
    authors: [{ name: "Jane Doe", slug: "jane-doe", jobTitle: "Finance Writer" }],
    entities: [{ name: "Stripe", wikidataId: "Q1113411", isPrimary: true }],
    qa: [],
    howTo: null,
    canonicalUrlOverride: null,
    ...overrides,
  };
}

/** `{documents, nextCursor}`, exactly as `search_content` returns it. */
export function listing(
  documents: CmsPostSummary[],
  nextCursor: string | null = null,
): { documents: CmsPostSummary[]; nextCursor: string | null } {
  return { documents, nextCursor };
}
