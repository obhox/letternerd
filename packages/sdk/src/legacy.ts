import type { CmsClient } from "./client";
import { byNewestFirst } from "./adapt";
import type { CmsPost, CmsPostSummary } from "./types";

/**
 * The drop-in adapter, and the acceptance test for this whole design.
 *
 * An existing marketing site reads its posts through a small module — a `Post`
 * interface and three functions — and every page under `app/blog/**` is written
 * against those. If adopting the CMS means rewriting those pages, adoption
 * costs a sprint and gets deferred; if it means replacing the body of one file,
 * it happens on a Tuesday afternoon.
 *
 * So this module reproduces that contract exactly: the same field names, the
 * same types, the same three signatures, the same newest-first ordering, the
 * same `null` for a missing post. Nothing here is a better idea than what the
 * site already had — deliberately. A "improved" field name is a page component
 * that needs changing, which is the one thing this exists to avoid.
 */

/** The shape the consuming site already renders against. Field-for-field. */
export interface LegacyPost {
  slug: string;
  /** Meta description and card excerpt. */
  title: string;
  description: string;
  /** ISO 8601 — `YYYY-MM-DD`. */
  date: string;
  /** ISO 8601 — falls back to `date` when the CMS has no separate value. */
  dateModified?: string;
  author: string;
  authorTitle?: string;
  category: string;
  tags: string[];
  /** Minutes. */
  readingTime: number;
  /** Rendered HTML. */
  content: string;
}

/** The listing type: everything but the body. */
export type LegacyPostMeta = Omit<LegacyPost, "content">;

export interface LegacyOptions {
  /**
   * Byline for a document with no author record. The filesystem version
   * defaulted this in frontmatter; a CMS document can genuinely have none.
   */
  defaultAuthor?: string;
  /** Category for an unfiled document. The filesystem version used "General". */
  defaultCategory?: string;
}

const WORDS_PER_MINUTE = 200;

/**
 * `YYYY-MM-DD`, because that is what the interface documents and what the
 * pages sort on.
 *
 * The CMS stores a full timestamp. Truncating rather than reformatting keeps
 * the strings lexicographically sortable, which is what the original
 * implementation relied on and what any date-comparison in the existing pages
 * still relies on.
 */
function isoDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

export function toLegacyPost(
  post: CmsPost | CmsPostSummary,
  options: LegacyOptions = {},
): LegacyPost {
  const full = post as CmsPost;
  const author = post.author ?? full.authors?.[0] ?? null;

  const readingTime =
    post.readingTimeMinutes ??
    (post.wordCount ? Math.max(1, Math.ceil(post.wordCount / WORDS_PER_MINUTE)) : 1);

  const dateModified = isoDate(post.dateModified);
  const date = isoDate(post.publishedAt ?? full.firstPublishedAt);

  return {
    slug: post.slug,
    title: post.title,
    // The legacy field is a meta description first and a card excerpt second,
    // which is the CMS's `description`; `excerpt` is the fallback because a
    // card with the wrong copy beats a card with none.
    description: post.description ?? post.excerpt ?? "",
    date,
    // Omitted rather than set equal to `date`: the interface says it falls back,
    // and the consuming pages implement that fallback themselves.
    ...(dateModified && dateModified !== date ? { dateModified } : {}),
    author: author?.name ?? post.authorName ?? options.defaultAuthor ?? "",
    ...(author?.jobTitle ? { authorTitle: author.jobTitle } : {}),
    category: post.category?.name ?? options.defaultCategory ?? "General",
    tags: (post.tags ?? []).map((tag) => tag.name),
    readingTime,
    content: full.bodyHtml ?? "",
  };
}

export interface LegacyApiOptions extends LegacyOptions {
  /**
   * Fetch each post's body in `getAllPosts`.
   *
   * On by default, because the signature promises a `Post[]` and a `Post` has
   * `content`. A listing page that only reads the metadata pays for bodies it
   * does not use — cached, so once per revalidation — and a site with hundreds
   * of posts should turn this off and use `getPostBySlug` on the detail page.
   * Off, `content` is an empty string, which is honest but is a trap if any
   * listing renders it.
   */
  hydrate?: boolean;
  concurrency?: number;
}

export interface LegacyApi {
  /** All posts, newest first. */
  getAllPosts(): Promise<LegacyPost[]>;
  /** One post, or `null` when there is no such slug. */
  getPostBySlug(slug: string): Promise<LegacyPost | null>;
  /** Every slug — for `generateStaticParams`. */
  getAllSlugs(): Promise<string[]>;
}

/**
 * The three functions, with the signatures the existing pages already call.
 *
 * `lib/posts.ts` becomes:
 *
 *     export const { getAllPosts, getPostBySlug, getAllSlugs } =
 *       createLegacyApi(createCmsClient({ ... }));
 *     export type { LegacyPost as Post } from "@letternerd/sdk/legacy";
 *
 * and `app/blog/**` is untouched.
 */
export function createLegacyApi(client: CmsClient, options: LegacyApiOptions = {}): LegacyApi {
  const hydrate = options.hydrate ?? true;
  const concurrency = Math.max(1, options.concurrency ?? 8);

  async function collect(): Promise<CmsPostSummary[]> {
    const posts: CmsPostSummary[] = [];
    for await (const post of client.listAllPosts({ status: "published", limit: 100 })) {
      posts.push(post);
    }
    return byNewestFirst(posts);
  }

  return {
    async getAllPosts(): Promise<LegacyPost[]> {
      const summaries = await collect();
      if (!hydrate) return summaries.map((post) => toLegacyPost(post, options));

      const out: LegacyPost[] = new Array<LegacyPost>(summaries.length);
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(concurrency, summaries.length) }, async () => {
          for (;;) {
            const index = cursor++;
            const summary = summaries[index];
            if (!summary) return;
            const post = await client.getPost(summary.slug);
            // Indexed rather than pushed, so the fetch order does not disturb
            // the newest-first ordering the interface promises.
            out[index] = toLegacyPost(post ?? summary, options);
          }
        }),
      );
      return out.filter((post): post is LegacyPost => post !== undefined);
    },

    async getPostBySlug(slug: string): Promise<LegacyPost | null> {
      const post = await client.getPost(slug);
      return post ? toLegacyPost(post, options) : null;
    },

    async getAllSlugs(): Promise<string[]> {
      const summaries = await collect();
      return summaries.map((post) => post.slug);
    },
  };
}
