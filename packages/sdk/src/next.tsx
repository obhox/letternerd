import type { Metadata } from "next";
import type { ReactElement } from "react";
import {
  buildAtom,
  buildJsonFeed,
  buildLlmsTxt,
  buildRobotsTxt,
  buildRss,
  buildSitemap,
  buildSitemapIndex,
  chunkSitemapEntries,
  documentSitemapEntries,
  jsonLdScript,
  pageMetadataFields,
  streamLlmsFullTxt,
  type JsonLdObject,
  type PageMetadataOptions,
  type SeoDocument,
  type SeoSite,
  type SitemapEntry,
} from "@cms/seo";
import { buildPictureSources, DEFAULT_SIZES } from "@cms/media/srcset";
import { byNewestFirst, toSeoDocument, toSeoDocuments } from "./adapt";
import { cacheTags, type CmsClient } from "./client";
import type { CmsIndex, CmsMedia, CmsPost, CmsPostSummary, CmsSite } from "./types";
import { verifyWebhookSignature } from "./webhook";

/**
 * The Next.js adapters: route handlers, metadata and three components.
 *
 * Everything here is a thin mapping onto `@cms/seo`, which already decides what
 * a sitemap, a feed, a robots.txt and a `<head>` should contain. The value this
 * file adds is the plumbing a consuming site would otherwise write badly — the
 * right content types, a streamed `llms-full.txt`, a webhook that cannot be
 * forged, and metadata mapped onto Next's own `Metadata` shape.
 *
 * `next/cache` is imported lazily, inside the one handler that needs it, so
 * that importing this module does not require the framework to be present at
 * module-evaluation time.
 */

/* ------------------------------------------------------------- responses -- */

const XML = "application/xml; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";

/**
 * How long a CDN may serve an artifact, and how long it may serve a stale one
 * while it refetches. Generous because every one of these files is also
 * invalidated by tag the moment a document is published — the timer is the
 * backstop, not the mechanism.
 */
const ARTIFACT_CACHE = "public, s-maxage=3600, stale-while-revalidate=86400";

function textResponse(body: string, contentType: string, cache = ARTIFACT_CACHE): Response {
  return new Response(body, {
    headers: { "Content-Type": contentType, "Cache-Control": cache },
  });
}

export type RouteHandler = (request: Request) => Promise<Response>;

/** Next 15+ hands params as a promise; older shapes are still accepted. */
export type RouteContext<T> = { params: Promise<T> | T };

async function paramsOf<T>(context: RouteContext<T>): Promise<T> {
  return await context.params;
}

/* ----------------------------------------------------------- hydration --- */

export interface HydrateOptions {
  /** Requests in flight at once. Enough to be fast, few enough to be polite. */
  concurrency?: number;
}

/**
 * Listing summaries carry no body, and a feed of summaries is a feed of
 * excerpts — which is the thing `@cms/seo`'s feed module exists to avoid. So
 * the artifacts that need bodies fetch them, in a bounded pool rather than all
 * at once: a thousand simultaneous requests is a self-inflicted rate limit.
 */
async function hydrate(
  client: CmsClient,
  summaries: CmsPostSummary[],
  options: HydrateOptions = {},
): Promise<CmsPost[]> {
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const out: CmsPost[] = new Array<CmsPost>(summaries.length);
  let cursor = 0;
  let written = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      const summary = summaries[index];
      if (!summary) return;
      const post = await client.getPost(summary.slug);
      // A post that vanished between the listing and this fetch is skipped, not
      // fatal: it was unpublished a moment ago and simply is not in the feed.
      if (post) out[written++] = post;
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, summaries.length) }, worker));
  return out.slice(0, written);
}

/* -------------------------------------------------------------- sitemap -- */

export interface SitemapRouteOptions {
  /** Extra URLs on the consuming site: the home page, static pages. */
  extraEntries?: SitemapEntry[];
}

export function createBlogSitemapRoute(
  client: CmsClient,
  options: SitemapRouteOptions = {},
): RouteHandler {
  return async () => {
    const { site, posts } = await client.getIndex();
    const entries = [
      ...(options.extraEntries ?? []),
      ...documentSitemapEntries(toSeoDocuments(byNewestFirst(posts)), site),
    ];
    return textResponse(buildSitemap(entries, site), XML);
  };
}

export interface SitemapIndexRouteOptions {
  /** Where the chunk files are served, e.g. `/sitemaps/blog` → `/sitemaps/blog-1.xml`. */
  chunkBasePath?: string;
  chunkSize?: number;
  /** Sitemaps this site serves that the CMS knows nothing about. */
  extraSitemaps?: string[];
}

/**
 * The index, sized from the actual number of URLs.
 *
 * Google's per-file limit is 50 000 URLs, and a site that quietly crosses it
 * has a sitemap that is simply ignored past the boundary. The chunk count is
 * therefore derived rather than configured.
 */
export function createSitemapIndexRoute(
  client: CmsClient,
  options: SitemapIndexRouteOptions = {},
): RouteHandler {
  const basePath = options.chunkBasePath ?? "/sitemaps/blog";

  return async () => {
    const { site, posts } = await client.getIndex();
    const entries = documentSitemapEntries(toSeoDocuments(byNewestFirst(posts)), site);
    const chunks = chunkSitemapEntries(entries, options.chunkSize);

    const sitemaps = chunks.map((chunk, index) => ({
      path: `${basePath}-${index + 1}.xml`,
      // The newest lastmod in the chunk, so a crawler can skip a file whose
      // contents it has already seen without opening it.
      dateModified: chunk.reduce<string | null>(
        (latest, entry) =>
          entry.dateModified && (!latest || entry.dateModified > latest)
            ? entry.dateModified
            : latest,
        null,
      ),
    }));

    return textResponse(
      buildSitemapIndex([...(options.extraSitemaps ?? []), ...sitemaps], site),
      XML,
    );
  };
}

/* --------------------------------------------------------------- robots -- */

export interface RobotsRouteOptions {
  aiCrawlers?: "allow" | "block";
  sitemapPath?: string;
  disallow?: string[];
}

export function createRobotsRoute(
  client: CmsClient,
  options: RobotsRouteOptions = {},
): RouteHandler {
  return async () => {
    const site = await client.getSite();
    return textResponse(buildRobotsTxt(site, options), TEXT);
  };
}

/* ---------------------------------------------------------------- feeds -- */

export type FeedKind = "rss" | "atom" | "json";

export interface FeedRouteOptions {
  /** Items in the feed. Twenty is what a reader shows; a full archive is the sitemap's job. */
  limit?: number;
  /**
   * Fetch each item's body. On by default: a feed carrying excerpts gets
   * summarised as excerpts by everything that reads it, which is the one thing
   * a feed is uniquely good at avoiding.
   */
  fullContent?: boolean;
  selfPath?: string;
  path?: string;
}

const FEED_CONTENT_TYPES: Record<FeedKind, string> = {
  rss: "application/rss+xml; charset=utf-8",
  atom: "application/atom+xml; charset=utf-8",
  json: "application/feed+json; charset=utf-8",
};

export function createFeedRoute(
  client: CmsClient,
  kind: FeedKind,
  options: FeedRouteOptions = {},
): RouteHandler {
  const limit = options.limit ?? 20;

  return async () => {
    const { site, posts } = await client.getIndex();
    const newest = byNewestFirst(posts).slice(0, limit);
    const documents =
      options.fullContent === false
        ? toSeoDocuments(newest)
        : toSeoDocuments(await hydrate(client, newest));

    const feedOptions = {
      ...(options.path ? { path: options.path } : {}),
      ...(options.selfPath ? { selfPath: options.selfPath } : {}),
    };

    if (kind === "json") {
      return Response.json(buildJsonFeed(documents, site, feedOptions), {
        headers: { "Content-Type": FEED_CONTENT_TYPES.json, "Cache-Control": ARTIFACT_CACHE },
      });
    }

    const body =
      kind === "rss"
        ? buildRss(documents, site, feedOptions)
        : buildAtom(documents, site, feedOptions);

    return textResponse(body, FEED_CONTENT_TYPES[kind]);
  };
}

/* ----------------------------------------------------------------- llms -- */

export function createLlmsTxtRoute(client: CmsClient): RouteHandler {
  return async () => {
    const { site, posts } = await client.getIndex();
    return textResponse(buildLlmsTxt(toSeoDocuments(byNewestFirst(posts)), site), TEXT);
  };
}

export interface LlmsFullTxtRouteOptions {
  /**
   * Documents fetched, rendered and released per batch. The file is every
   * article concatenated — tens of megabytes on a large site — so it is
   * streamed, and only a batch's worth of bodies is ever resident.
   */
  batchSize?: number;
  concurrency?: number;
}

export function createLlmsFullTxtRoute(
  client: CmsClient,
  options: LlmsFullTxtRouteOptions = {},
): RouteHandler {
  const batchSize = Math.max(1, options.batchSize ?? 25);

  return async () => {
    const { site, posts } = await client.getIndex();
    const ordered = byNewestFirst(posts);
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for (let offset = 0; offset < ordered.length || offset === 0; offset += batchSize) {
            const batch = await hydrate(client, ordered.slice(offset, offset + batchSize), {
              ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
            });

            let chunkIndex = 0;
            for await (const chunk of streamLlmsFullTxt(toSeoDocuments(batch), site)) {
              /**
               * The generator's first chunk is the site header, and it must
               * appear exactly once. Emitting per batch is what keeps memory
               * bounded; skipping the header on every batch after the first is
               * the price, and it is a documented property of the generator
               * rather than a guess about its output.
               */
              if (chunkIndex++ === 0 && offset > 0) continue;
              controller.enqueue(encoder.encode(chunk));
            }
            if (ordered.length === 0) break;
          }
          controller.close();
        } catch (error) {
          // The response has already begun; there is no status left to change.
          // Erroring the stream truncates the file, which a client can detect,
          // rather than silently serving a half-written corpus as complete.
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: { "Content-Type": TEXT, "Cache-Control": ARTIFACT_CACHE },
    });
  };
}

/* ------------------------------------------------------------- markdown -- */

/**
 * `/blog/<slug>.md`, the plain-markdown alternate that `pageMetadataFields`
 * advertises. Agents that would rather not parse HTML fetch this; it is the
 * cheapest possible way to be quoted accurately.
 */
export function createPostMarkdownRoute(
  client: CmsClient,
): (request: Request, context: RouteContext<{ slug: string | string[] }>) => Promise<Response> {
  return async (_request, context) => {
    const params = await paramsOf(context);
    const raw = Array.isArray(params.slug) ? params.slug.join("/") : params.slug;
    // A route matched as `[slug].md` or `[...slug]` delivers the extension too.
    const slug = raw.replace(/\.md$/, "");

    const markdown = await client.getPostMarkdown(slug);
    if (markdown === null) {
      return new Response("Not found.", {
        status: 404,
        headers: { "Content-Type": TEXT, "Cache-Control": "no-store" },
      });
    }

    return textResponse(markdown, "text/markdown; charset=utf-8");
  };
}

/* -------------------------------------------------------------- webhook -- */

export interface RevalidateWebhookOptions {
  secret: string;
  /** Replay window in seconds. Five minutes covers clock skew and a retry. */
  toleranceSeconds?: number;
  signatureHeader?: string;
  timestampHeader?: string;
  /** Injected for tests. */
  now?: () => number;
}

/** What the CMS posts. Everything but `event` is optional. */
export interface RevalidatePayload {
  event?: string;
  slug?: string;
  slugs?: string[];
  tags?: string[];
  paths?: string[];
}

/**
 * The revalidation endpoint.
 *
 * It is a public URL that purges caches, so it verifies before it does
 * anything: an unsigned request is refused with a 401 and no work is done. The
 * signature covers the raw body and a timestamp, so a captured request cannot
 * be replayed after the window and a modified one does not verify at all.
 */
export function createRevalidateWebhookRoute(options: RevalidateWebhookOptions): RouteHandler {
  const signatureHeader = options.signatureHeader ?? "x-cms-signature";
  const timestampHeader = options.timestampHeader ?? "x-cms-timestamp";

  return async (request: Request) => {
    // Read the bytes once, verify them, and only then parse. Parsing first and
    // re-serialising to check the signature would verify a different string
    // than the one that was signed.
    const rawBody = await request.text();

    const verification = verifyWebhookSignature({
      secret: options.secret,
      rawBody,
      signatureHeader: request.headers.get(signatureHeader),
      timestampHeader: request.headers.get(timestampHeader),
      ...(options.toleranceSeconds === undefined
        ? {}
        : { toleranceSeconds: options.toleranceSeconds }),
      ...(options.now === undefined ? {} : { now: options.now }),
    });

    if (!verification.ok) {
      return Response.json(
        { revalidated: false, reason: verification.reason },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }

    let payload: RevalidatePayload;
    try {
      payload = rawBody === "" ? {} : (JSON.parse(rawBody) as RevalidatePayload);
    } catch {
      return Response.json({ revalidated: false, reason: "invalid_json" }, { status: 400 });
    }

    const tags = new Set<string>([cacheTags.index, ...(payload.tags ?? [])]);
    for (const slug of [...(payload.slug ? [payload.slug] : []), ...(payload.slugs ?? [])]) {
      tags.add(cacheTags.post(slug));
    }
    if (payload.event === "site.updated" || payload.event === "settings.updated") {
      tags.add(cacheTags.site);
    }

    /**
     * Imported here rather than at the top of the file. `next/cache` only
     * exists inside a Next server, and a static import would make this module —
     * and therefore every route that shares it — unloadable anywhere else,
     * including in this package's own tests.
     */
    const { revalidateTag, revalidatePath } = await import("next/cache");
    // `"max"` is the cacheLife profile Next 16 requires as a second argument
    // and Next 15 ignores, so one call is correct on both: purge the entry
    // rather than merely shortening its life.
    for (const tag of tags) revalidateTag(tag, "max");
    for (const path of payload.paths ?? []) revalidatePath(path);

    return Response.json(
      { revalidated: true, tags: [...tags], paths: payload.paths ?? [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  };
}

/* ------------------------------------------------------------ redirects -- */

export interface NextRedirect {
  source: string;
  destination: string;
  permanent: boolean;
}

/**
 * For `next.config`'s `redirects()`.
 *
 * Renames recorded by the CMS become 301s on the consuming site without anyone
 * having to remember, which is the entire point: the editor who renamed the
 * post is not thinking about the inbound links, and a redirect that depends on
 * remembering does not exist.
 *
 * It throws if the CMS cannot be reached. That is deliberate — a build that
 * quietly ships an empty redirect table 404s every URL that used to rank, and a
 * failed build is far cheaper than finding that out from Search Console.
 */
export function cmsRedirects(client: CmsClient): () => Promise<NextRedirect[]> {
  return async () => {
    const redirects = await client.getRedirects();
    return redirects.map((rule) => ({
      source: rule.source,
      destination: rule.destination,
      permanent: rule.permanent,
    }));
  };
}

/* ------------------------------------------------------------- metadata -- */

function toNextMetadata(fields: ReturnType<typeof pageMetadataFields>): Metadata {
  const alternateTypes: Record<string, string> = {};
  for (const alternate of fields.alternates.types) alternateTypes[alternate.type] = alternate.url;

  return {
    title: fields.title,
    description: fields.description,
    alternates: { canonical: fields.alternates.canonical, types: alternateTypes },
    robots: {
      index: fields.robots.index,
      follow: fields.robots.follow,
      // Next only emits the max-* directives inside the googlebot group, which
      // is also the only place Google reads them.
      googleBot: {
        index: fields.robots.index,
        follow: fields.robots.follow,
        "max-image-preview": fields.robots["max-image-preview"],
        "max-snippet": fields.robots["max-snippet"],
        "max-video-preview": fields.robots["max-video-preview"],
      },
    },
    openGraph: {
      type: fields.openGraph.type,
      url: fields.openGraph.url,
      siteName: fields.openGraph.siteName,
      title: fields.openGraph.title,
      description: fields.openGraph.description,
      locale: fields.openGraph.locale,
      images: fields.openGraph.images,
      ...(fields.openGraph.publishedTime
        ? { publishedTime: fields.openGraph.publishedTime }
        : {}),
      ...(fields.openGraph.modifiedTime ? { modifiedTime: fields.openGraph.modifiedTime } : {}),
      ...(fields.openGraph.authors ? { authors: fields.openGraph.authors } : {}),
      ...(fields.openGraph.section ? { section: fields.openGraph.section } : {}),
      ...(fields.openGraph.tags ? { tags: fields.openGraph.tags } : {}),
    },
    twitter: {
      card: fields.twitter.card,
      title: fields.twitter.title,
      description: fields.twitter.description,
      images: fields.twitter.images,
      ...(fields.twitter.site ? { site: fields.twitter.site } : {}),
      ...(fields.twitter.creator ? { creator: fields.twitter.creator } : {}),
    },
  };
}

/** A post page's `<head>`, decided by `@cms/seo` and mapped onto Next's shape. */
export function postMetadata(
  post: CmsPost | CmsPostSummary,
  site: CmsSite | SeoSite,
  options: PageMetadataOptions = {},
): Metadata {
  return toNextMetadata(pageMetadataFields(toSeoDocument(post), site, options));
}

export interface ListingMetadataOptions extends PageMetadataOptions {
  title: string;
  description?: string;
  /** Root-relative path of the listing, e.g. `/blog` or `/blog/tag/pricing`. */
  path: string;
  canonicalUrl?: string;
}

/**
 * A listing page's `<head>`.
 *
 * Modelled as a document with no body so the same decisions — the robots
 * directives, the OG locale, the Twitter card size — are made in one place
 * rather than twice with two different answers.
 */
export function listingMetadata(
  site: CmsSite | SeoSite,
  options: ListingMetadataOptions,
): Metadata {
  const { title, description, path, canonicalUrl, ...rest } = options;

  const document: SeoDocument = {
    slug: path.replace(/^\/+/, ""),
    title,
    description: description ?? null,
    // The listing's own URL, passed through rather than rebuilt — the same rule
    // the client follows for a post's canonical.
    canonicalUrlOverride: canonicalUrl ?? path,
  };

  return toNextMetadata(pageMetadataFields(document, site, { type: "website", ...rest }));
}

/* ----------------------------------------------------------- components -- */

export interface JsonLdProps {
  data: JsonLdObject | (JsonLdObject | null | undefined)[];
}

/**
 * One `<script type="application/ld+json">`, escaped by `jsonLdScript`.
 *
 * The escaping is not optional and is not React's: React escapes for HTML text,
 * and this content is inside a `<script>`, where the parser is looking for
 * `</script` and nothing else. `jsonLdScript` emits `<`, `>` and `&` as unicode
 * escapes so a post titled with a closing tag cannot end the element.
 */
export function JsonLd({ data }: JsonLdProps): ReactElement {
  const nodes = Array.isArray(data) ? data : [data];
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdScript(...nodes) }}
    />
  );
}

export interface PostBodyProps {
  post: Pick<CmsPost, "bodyHtml">;
  className?: string;
}

/**
 * The article body.
 *
 * The HTML is sanitised in the CMS, at publish time, by `rehype-sanitize` with
 * the schema the content pipeline owns — it is sanitised once, by the system
 * that knows which elements the editor is allowed to produce, and stored in
 * that form.
 *
 * Do NOT re-sanitise it here or on the client. A second pass with a stock
 * allow-list strips exactly the things the pipeline deliberately emits: the
 * `cms-*` class names every article style is written against (`cms-tldr`,
 * `cms-takeaways`, `cms-callout`), the heading `id` attributes the anchor
 * contract and the FAQ JSON-LD point at, and the `<figure>`/`<figcaption>`
 * structure. The result is an article that renders unstyled with dead anchors,
 * and it is not obvious in review because the text is all still there.
 */
export function PostBody({ post, className }: PostBodyProps): ReactElement {
  return (
    <div
      className={className ?? "cms-body"}
      dangerouslySetInnerHTML={{ __html: post.bodyHtml ?? "" }}
    />
  );
}

export interface CmsImageProps {
  media: CmsMedia;
  /** Defaults to the single-column article width `@cms/media` recommends. */
  sizes?: string;
  className?: string;
  /**
   * The one image above the fold — usually the cover. Everything else stays
   * lazy: eagerly loading a gallery is how a good LCP becomes a bad one.
   */
  priority?: boolean;
  alt?: string;
}

/**
 * A `<picture>` built from the variants the media pipeline produced.
 *
 * Deliberately not `next/image`: these files are already resized, already
 * AVIF/WebP, and already on a CDN, so routing them through the Next optimizer
 * would re-encode work that is done and bill for it. `buildPictureSources` from
 * `@cms/media` decides the format order — AVIF, then WebP, then the raster
 * fallback — because a browser takes the first `<source>` it understands and
 * never looks at the rest.
 */
export function CmsImage({
  media,
  sizes,
  className,
  priority = false,
  alt,
}: CmsImageProps): ReactElement {
  const variants = media.variants ?? [];
  // The storage driver resolved these; the SDK only looks them up, and falls
  // back to the key when a variant arrived without one — a key from an
  // already-public bucket is the URL.
  const urlByKey = new Map(variants.map((variant) => [variant.key, variant.url ?? variant.key]));
  const sources = buildPictureSources(variants, (key) => urlByKey.get(key) ?? key);

  return (
    <picture>
      {sources.map((source) => (
        <source
          key={source.type}
          type={source.type}
          srcSet={source.srcset}
          sizes={sizes ?? DEFAULT_SIZES}
        />
      ))}
      <img
        src={media.url}
        alt={alt ?? media.alt ?? ""}
        {...(media.width ? { width: media.width } : {})}
        {...(media.height ? { height: media.height } : {})}
        className={className}
        loading={priority ? "eager" : "lazy"}
        decoding={priority ? "sync" : "async"}
        {...(priority ? { fetchPriority: "high" as const } : {})}
      />
    </picture>
  );
}

export type { CmsIndex };
export { cacheTags };
export { verifyWebhookSignature, signWebhookPayload } from "./webhook";
