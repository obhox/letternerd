import type {
  SeoAuthor,
  SeoDocument,
  SeoEntity,
  SeoHowTo,
  SeoQuestion,
  SeoSite,
  SeoTerm,
} from "@cms/seo";

/**
 * The wire shapes, written out by hand.
 *
 * They are what `/api/v1` returns, narrowed to the fields a public site can
 * see. Deriving them from the capability schemas would be tighter but would
 * drag zod and the whole registry into a package that ships to a customer's
 * `node_modules`, and the API is versioned precisely so that a client can hold
 * a copy of the contract.
 *
 * Where a field exists on both sides it keeps the API's name. Where the API
 * hands back a timestamp it is an ISO-8601 string, because JSON has no dates
 * and pretending otherwise is how a `Date` that is really a string reaches a
 * `.getTime()` call.
 */

/** The consuming site's configuration. Every absolute URL derives from `baseUrl`. */
export interface CmsSite extends SeoSite {
  id: string;
}

export interface CmsTerm extends SeoTerm {
  id?: string;
  description?: string | null;
  documentCount?: number;
}

export interface CmsAuthor extends SeoAuthor {
  id?: string;
  isActive?: boolean;
}

export type CmsEntity = SeoEntity;

export interface CmsImageRef {
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
  blurhash?: string | null;
}

/** One rendition of an image, as the media pipeline stored it. */
export interface CmsMediaVariant {
  key: string;
  width: number;
  height?: number;
  format: string;
  /** Absolute, CDN-resolved. The storage driver owns this; the SDK never joins one. */
  url?: string;
}

export interface CmsMedia extends CmsImageRef {
  id?: string;
  mimeType?: string;
  variants?: CmsMediaVariant[];
}

export interface CmsHeading {
  depth: number;
  text: string;
  id: string;
  aliases?: string[];
}

export type CmsDocumentStatus =
  | "draft"
  | "in_review"
  | "scheduled"
  | "published"
  | "archived";

/**
 * What a listing returns: enough for a card, and no body.
 *
 * The listing endpoint deliberately does not send `bodyHtml` — twenty rendered
 * articles is megabytes to serve a page that shows twenty titles.
 */
export interface CmsPostSummary {
  id: string;
  type: string;
  status: CmsDocumentStatus;
  slug: string;
  title: string;
  description?: string | null;
  excerpt?: string | null;
  /**
   * Built by the API from the site's `baseUrl`, or from the document's
   * syndication override. Never assembled here — see the note in `client.ts`.
   */
  canonicalUrl: string;
  publishedAt?: string | null;
  dateModified?: string | null;
  updatedAt?: string | null;
  readingTimeMinutes?: number;
  wordCount?: number;
  noindex?: boolean;
  author?: CmsAuthor | null;
  authorName?: string | null;
  category?: CmsTerm | null;
  tags?: CmsTerm[];
  coverImage?: CmsImageRef | null;
  ogImage?: CmsImageRef | null;
}

/** One document, with everything needed to render its page. */
export interface CmsPost extends CmsPostSummary {
  subtitle?: string | null;
  /** Sanitised in the CMS. See the note on `<PostBody>` before touching it. */
  bodyHtml?: string | null;
  bodyText?: string | null;
  /** The public markdown rendition served at `/blog/<slug>.md`. */
  bodyMdPublic?: string | null;
  headings?: CmsHeading[];
  tldr?: string | null;
  keyTakeaways?: string[];
  authors?: CmsAuthor[];
  entities?: CmsEntity[];
  qa?: SeoQuestion[];
  howTo?: SeoHowTo | null;
  canonicalUrlOverride?: string | null;
  firstPublishedAt?: string | null;
}

/** A redirect the consuming site should serve, from either source the CMS has. */
export interface CmsRedirect {
  source: string;
  destination: string;
  /** 308/301 are permanent; 307/302 are not. Next wants the boolean. */
  permanent: boolean;
  statusCode: number;
  /** `manual` is a hand-written rule; `slug_history` was recorded by a rename. */
  origin: "manual" | "slug_history";
  createdAt?: string | null;
}

export interface ListPostsOptions {
  limit?: number;
  cursor?: string | null;
  /** Full-text query, passed to the API rather than filtered here. */
  query?: string;
  type?: string;
  status?: CmsDocumentStatus;
}

export interface ListPostsResult {
  posts: CmsPostSummary[];
  /** `null` when this was the last page. Opaque — never parse it. */
  nextCursor: string | null;
}

/** Everything the artifact routes need, fetched once. */
export interface CmsIndex {
  site: CmsSite;
  posts: CmsPostSummary[];
}

/** A bot fetch worth recording. Best-effort; see `logCrawlerHit`. */
export interface CrawlerHit {
  path: string;
  userAgent?: string | null;
  botName?: string | null;
  referer?: string | null;
  statusCode?: number;
  occurredAt?: string;
}
