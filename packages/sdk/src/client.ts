import { CmsError } from "./errors";
import { HttpClient, type HttpClientOptions, type RequestOptions } from "./http";
import type {
  CmsAuthor,
  CmsEntity,
  CmsIndex,
  CmsPost,
  CmsPostSummary,
  CmsRedirect,
  CmsSite,
  CmsTerm,
  CrawlerHit,
  ListPostsOptions,
  ListPostsResult,
} from "./types";

/**
 * The client.
 *
 * Everything a consuming site needs to server-render content it does not host,
 * and nothing else. Three rules run through all of it:
 *
 * **Errors are typed and loud.** Only `getPost` may answer with `null`, and
 * only for a genuine 404.
 *
 * **Caching is declared.** Every read states a revalidation window and the tags
 * it belongs to, so `revalidateTag("cms:post:my-slug")` from the webhook
 * invalidates one page instead of a whole deployment.
 *
 * **URLs come from the API.** The client never assembles a canonical, a feed
 * `guid` or a JSON-LD `@id` from a base URL and a slug. The CMS owns the site's
 * `baseUrl`, its blog base path and any syndication override, and the moment a
 * client starts joining those itself there are two implementations of the same
 * rule — which is how a trailing slash, a locale prefix or a rename produces a
 * canonical that disagrees with the sitemap and a duplicate-content report
 * nobody can trace.
 */

/** The tags every read is filed under. The webhook route revalidates these. */
export const cacheTags = {
  site: "cms:site",
  /** Listings, feeds, sitemaps: anything whose contents change when any post does. */
  index: "cms:index",
  post: (slug: string) => `cms:post:${slug}`,
  authors: "cms:authors",
  terms: "cms:terms",
  redirects: "cms:redirects",
} as const;

export interface CmsClientOptions extends HttpClientOptions {}

export interface GetPostOptions {
  /**
   * Bypass the cache and ask for the document as it stands right now. Whether
   * *drafts* are visible is a property of the API key, not of this flag — a
   * publishable key never sees one, which is what keeps an unpublished post out
   * of a public page even if a preview link leaks.
   */
  preview?: boolean;
  type?: string;
}

export interface GetRelatedOptions {
  limit?: number;
  /** How wide a net to score against. Kept small; this is one extra request. */
  candidatePoolSize?: number;
}

export interface CmsClient {
  getSite(): Promise<CmsSite>;
  listPosts(options?: ListPostsOptions): Promise<ListPostsResult>;
  listAllPosts(options?: Omit<ListPostsOptions, "cursor">): AsyncGenerator<CmsPostSummary>;
  getPost(slug: string, options?: GetPostOptions): Promise<CmsPost | null>;
  getPostMarkdown(slug: string): Promise<string | null>;
  getRelated(slug: string, options?: GetRelatedOptions): Promise<CmsPostSummary[]>;
  listAuthors(): Promise<CmsAuthor[]>;
  getAuthor(slug: string): Promise<CmsAuthor | null>;
  listTags(): Promise<CmsTerm[]>;
  listCategories(): Promise<CmsTerm[]>;
  listEntities(): Promise<CmsEntity[]>;
  getRedirects(since?: Date | string): Promise<CmsRedirect[]>;
  getIndex(): Promise<CmsIndex>;
  search(query: string, options?: Omit<ListPostsOptions, "query">): Promise<ListPostsResult>;
  logCrawlerHit(hit: CrawlerHit): Promise<void>;
  /** Escape hatch for endpoints this client does not wrap yet. Still typed, still throws. */
  raw<T>(path: string, options?: RequestOptions): Promise<T>;
}

const DEFAULT_PAGE_SIZE = 20;

export function createCmsClient(options: CmsClientOptions): CmsClient {
  const http = new HttpClient(options);

  async function getSite(): Promise<CmsSite> {
    return http.request<CmsSite>("/site", { tags: [cacheTags.site] });
  }

  async function listPosts(opts: ListPostsOptions = {}): Promise<ListPostsResult> {
    const payload = await http.request<{
      documents: CmsPostSummary[];
      nextCursor: string | null;
    }>("/documents", {
      query: {
        type: opts.type ?? "post",
        status: opts.status,
        query: opts.query,
        limit: opts.limit ?? DEFAULT_PAGE_SIZE,
        cursor: opts.cursor ?? undefined,
      },
      tags: [cacheTags.index],
    });

    // The API's field is `documents`; the SDK's noun is `posts`. Renamed once,
    // here, rather than leaking a CMS-internal word into every consuming page.
    return { posts: payload.documents ?? [], nextCursor: payload.nextCursor ?? null };
  }

  /**
   * Every post, following the cursor.
   *
   * The repeated-cursor guard is not defensive programming for its own sake. A
   * server bug that returns the same cursor twice turns a sitemap build into an
   * infinite loop that allocates until the build host dies, and the failure
   * looks like a hung deploy rather than an API fault. Detecting it and saying
   * so costs one `Set` and turns a hang into a stack trace.
   */
  async function* listAllPosts(
    opts: Omit<ListPostsOptions, "cursor"> = {},
  ): AsyncGenerator<CmsPostSummary> {
    const seen = new Set<string>();
    let cursor: string | null = null;

    for (;;) {
      const page: ListPostsResult = await listPosts({ ...opts, cursor });
      for (const post of page.posts) yield post;

      if (!page.nextCursor) return;
      if (seen.has(page.nextCursor)) {
        throw new CmsError({
          status: 200,
          code: "malformed_response",
          message:
            "The CMS returned a pagination cursor it had already returned. " +
            "Stopping rather than looping; the listing is incomplete.",
          details: { cursor: page.nextCursor, pages: seen.size },
        });
      }
      seen.add(page.nextCursor);
      cursor = page.nextCursor;
    }
  }

  async function getPost(slug: string, opts: GetPostOptions = {}): Promise<CmsPost | null> {
    try {
      return await http.request<CmsPost>(`/documents/${encodeURIComponent(slug)}`, {
        // Both forms are sent: the addressed segment, and the `slug`/`type`
        // pair the capability documents. A request that names the same document
        // twice cannot be ambiguous, and it survives either resolution order.
        query: { slug, type: opts.type ?? "post" },
        tags: [cacheTags.post(slug), cacheTags.index],
        ...(opts.preview ? { noStore: true, revalidate: 0 as const } : {}),
      });
    } catch (error) {
      /**
       * The one place an error becomes an absence, and only for the code that
       * actually means "there is no such document". A 401 must not land here:
       * it would render the site's 404 page for every URL and hand a crawler a
       * few thousand freshly-missing posts.
       */
      if (error instanceof CmsError && error.code === "not_found") return null;
      throw error;
    }
  }

  async function getPostMarkdown(slug: string): Promise<string | null> {
    const post = await getPost(slug);
    if (!post) return null;
    // `bodyMdPublic` is the rendition with CDN URLs resolved and frontmatter
    // prepended; `bodyText` is the plain-text fallback for a document published
    // before that column existed.
    return post.bodyMdPublic ?? post.bodyText ?? null;
  }

  /**
   * Related posts, scored here rather than fetched.
   *
   * There is no relatedness endpoint, and inventing one client-side is honest
   * about what this is: shared tags first, same category second, recency as the
   * tie-break. It costs one extra listing request, which the cache absorbs.
   */
  async function getRelated(
    slug: string,
    opts: GetRelatedOptions = {},
  ): Promise<CmsPostSummary[]> {
    const limit = opts.limit ?? 3;
    const post = await getPost(slug);
    if (!post) return [];

    const { posts } = await listPosts({ limit: opts.candidatePoolSize ?? 50 });
    const tagSlugs = new Set((post.tags ?? []).map((tag) => tag.slug));

    return posts
      .filter((candidate) => candidate.slug !== slug && candidate.status === "published")
      .map((candidate) => {
        const shared = (candidate.tags ?? []).filter((tag) => tagSlugs.has(tag.slug)).length;
        const sameCategory =
          post.category && candidate.category?.slug === post.category.slug ? 1 : 0;
        return { candidate, score: shared * 2 + sameCategory };
      })
      .filter((scored) => scored.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          ((a.candidate.publishedAt ?? "") < (b.candidate.publishedAt ?? "") ? 1 : -1),
      )
      .slice(0, limit)
      .map((scored) => scored.candidate);
  }

  async function listAuthors(): Promise<CmsAuthor[]> {
    const payload = await http.request<{ authors: CmsAuthor[] }>("/authors", {
      tags: [cacheTags.authors],
    });
    return payload.authors ?? [];
  }

  async function getAuthor(slug: string): Promise<CmsAuthor | null> {
    // Resolved from the list because there is no by-slug route, and an author
    // list is tens of rows served from one cached response — a dedicated
    // endpoint would be a second cache entry for the same bytes.
    const authors = await listAuthors();
    return authors.find((author) => author.slug === slug) ?? null;
  }

  async function listTerms(kind: "tag" | "category" | "entity"): Promise<CmsTerm[]> {
    const payload = await http.request<{ kind: string; terms: CmsTerm[] }>("/terms", {
      query: { kind },
      tags: [cacheTags.terms],
    });
    return payload.terms ?? [];
  }

  async function listEntities(): Promise<CmsEntity[]> {
    const terms = await listTerms("entity");
    return terms as unknown as CmsEntity[];
  }

  /**
   * Both kinds of redirect, flattened into the one shape a router wants.
   *
   * `slugHistory` rows matter as much as hand-written rules and are easier to
   * forget: they are written automatically when a published post is renamed, so
   * a site that serves only the manual table 404s exactly the URLs that used to
   * rank.
   */
  async function getRedirects(since?: Date | string): Promise<CmsRedirect[]> {
    const payload = await http.request<{
      redirects: {
        source: string;
        destination: string;
        statusCode?: number;
        createdAt?: string;
      }[];
      slugHistory: {
        oldSlug: string;
        newSlug: string;
        statusCode?: number;
        createdAt?: string;
      }[];
      blogBasePath?: string;
    }>("/redirects", { tags: [cacheTags.redirects] });

    const base = (payload.blogBasePath ?? "").replace(/\/+$/, "");

    const manual: CmsRedirect[] = (payload.redirects ?? []).map((rule) => ({
      source: rule.source,
      destination: rule.destination,
      statusCode: rule.statusCode ?? 301,
      permanent: (rule.statusCode ?? 301) === 301 || rule.statusCode === 308,
      origin: "manual" as const,
      createdAt: rule.createdAt ?? null,
    }));

    const renames: CmsRedirect[] = (payload.slugHistory ?? []).map((entry) => ({
      source: `${base}/${entry.oldSlug}`,
      destination: `${base}/${entry.newSlug}`,
      statusCode: entry.statusCode ?? 301,
      permanent: (entry.statusCode ?? 301) === 301 || entry.statusCode === 308,
      origin: "slug_history" as const,
      createdAt: entry.createdAt ?? null,
    }));

    const all = [...manual, ...renames];
    if (!since) return all;

    // Filtering client-side because the endpoint has no `since`. A redirect
    // table is small; the parameter exists so a caller can poll for changes
    // without re-writing a `next.config` that has not changed.
    const cutoff = typeof since === "string" ? new Date(since) : since;
    return all.filter((rule) => rule.createdAt != null && new Date(rule.createdAt) >= cutoff);
  }

  /**
   * The site and every published post, in one call.
   *
   * This is what a sitemap, a feed and `llms.txt` each need, and fetching it
   * under one tag means the three of them share a cache entry instead of
   * paginating the same table three times per revalidation.
   */
  async function getIndex(): Promise<CmsIndex> {
    const [site, posts] = await Promise.all([
      getSite(),
      (async () => {
        const collected: CmsPostSummary[] = [];
        for await (const post of listAllPosts({ status: "published", limit: 100 })) {
          collected.push(post);
        }
        return collected;
      })(),
    ]);

    return { site, posts };
  }

  async function search(
    query: string,
    opts: Omit<ListPostsOptions, "query"> = {},
  ): Promise<ListPostsResult> {
    return listPosts({ ...opts, query });
  }

  /**
   * Records that a bot fetched a page. Never throws, never blocks.
   *
   * The CMS's crawler log is what makes "has ClaudeBot fetched this post yet"
   * answerable, and it can only be collected where the page is actually served
   * — on the consuming site. But a page render must not depend on it: if the
   * CMS is down, the reader (or the bot) still gets the article, and the hit is
   * simply not recorded.
   */
  async function logCrawlerHit(hit: CrawlerHit): Promise<void> {
    await http.send("/insights/crawler-hits", { method: "POST", body: hit });
  }

  return {
    getSite,
    listPosts,
    listAllPosts,
    getPost,
    getPostMarkdown,
    getRelated,
    listAuthors,
    getAuthor,
    listTags: () => listTerms("tag"),
    listCategories: () => listTerms("category"),
    listEntities,
    getRedirects,
    getIndex,
    search,
    logCrawlerHit,
    raw: <T,>(path: string, opts: RequestOptions = {}) => http.request<T>(path, opts),
  };
}
