import type { SeoDocument, SeoImage, SeoSite } from "@cms/seo";
import type { CmsImageRef, CmsPost, CmsPostSummary, CmsSite } from "./types";

/**
 * Wire shapes in, `@cms/seo` shapes out.
 *
 * This module is the entire reason the SDK does not contain any SEO logic: the
 * JSON-LD builders, the sitemap writer, the feed writers and `llms.txt` all
 * consume `SeoDocument` and `SeoSite`, so adapting once here makes every one of
 * them available without a line of the CMS's SEO thinking being restated in a
 * client library, where it would immediately begin to drift.
 */

function toSeoImage(image: CmsImageRef | null | undefined): SeoImage | null {
  if (!image) return null;
  return {
    url: image.url,
    width: image.width ?? null,
    height: image.height ?? null,
    alt: image.alt ?? null,
  };
}

/** The site row is already the SEO site; the extra `id` is harmless. */
export function toSeoSite(site: CmsSite): SeoSite {
  return site;
}

/**
 * A post as the SEO builders want it.
 *
 * The one subtlety is `canonicalUrlOverride`. The API returns `canonicalUrl`
 * fully formed — it knows the site's `baseUrl` and whether the document
 * canonicalises somewhere else — and `canonicalUrlFor` in `@cms/seo` would
 * otherwise rebuild that URL from parts. Feeding the server's answer in as the
 * override means every builder emits exactly the URL the CMS published, so the
 * canonical in the `<head>`, the `<loc>` in the sitemap, the `guid` in the feed
 * and the `@id` in the JSON-LD are one string with one origin rather than four
 * derivations that agree until one of them does not.
 */
export function toSeoDocument(post: CmsPostSummary | CmsPost): SeoDocument {
  const full = post as CmsPost;

  return {
    slug: post.slug,
    title: post.title,
    description: post.description ?? null,
    excerpt: post.excerpt ?? null,
    bodyHtml: full.bodyHtml ?? null,
    bodyText: full.bodyMdPublic ?? full.bodyText ?? null,
    publishedAt: post.publishedAt ?? null,
    dateModified: post.dateModified ?? post.publishedAt ?? null,
    author: post.author ?? null,
    authors: full.authors ?? (post.author ? [post.author] : []),
    category: post.category ?? null,
    tags: post.tags ?? [],
    entities: full.entities ?? [],
    coverImage: toSeoImage(post.coverImage),
    ogImage: toSeoImage(post.ogImage),
    qa: full.qa ?? [],
    howTo: full.howTo ?? null,
    ...(post.wordCount === undefined ? {} : { wordCount: post.wordCount }),
    ...(post.readingTimeMinutes === undefined
      ? {}
      : { readingTimeMinutes: post.readingTimeMinutes }),
    canonicalUrlOverride: post.canonicalUrl ?? null,
    noindex: post.noindex ?? false,
    tldr: full.tldr ?? null,
    keyTakeaways: full.keyTakeaways ?? [],
  };
}

export function toSeoDocuments(posts: (CmsPostSummary | CmsPost)[]): SeoDocument[] {
  return posts.map(toSeoDocument);
}

/**
 * Newest first, by publication date.
 *
 * The listing endpoint orders by `updatedAt` — right for an editor's screen,
 * wrong for a feed, where a typo fix would otherwise republish a two-year-old
 * post to the top of every reader's inbox. Applied only where the whole set is
 * already in hand, since it cannot be done across a paginated boundary.
 */
export function byNewestFirst<T extends { publishedAt?: string | null }>(posts: T[]): T[] {
  return [...posts].sort((a, b) => (a.publishedAt ?? "") < (b.publishedAt ?? "") ? 1 : -1);
}
