/**
 * The shapes this package reads, and nothing more.
 *
 * These mirror columns in `@cms/db`, deliberately by hand. Importing the
 * schema would drag a database driver into a package whose entire purpose is
 * to be pure — the SEO layer runs in the studio, in the public API, inside the
 * SDK on a consuming site's server, and in tests, and only one of those has a
 * connection string. The cost is that a column rename has to be reflected here
 * too; the benefit is that `buildSitemap` can be called from anywhere.
 *
 * Every field is optional that could be absent on a real draft. A validator,
 * not a type error, is how this package reports a document that is not ready
 * to be published.
 */

/**
 * The *consuming* site — the origin the content is served from.
 *
 * This is the single most important type here. A sitemap, a feed, a robots.txt
 * and every absolute URL inside a JSON-LD node must be built from `baseUrl`.
 * The CMS's own hostname must never appear in generated output: a sitemap
 * listing spendtab.com URLs but served from cms.example.com is a cross-domain
 * sitemap, and Search Console rejects it outright.
 */
export interface SeoSite {
  /** `https://spendtab.com` — origin only, no trailing slash. */
  baseUrl: string;
  /** Where documents live on that origin, e.g. `/blog`. */
  blogBasePath: string;
  name: string;
  /** BCP-47, e.g. `en-GB`. */
  locale: string;
  orgName?: string | null;
  orgLogoUrl?: string | null;
  orgSameAs?: string[];
  twitterHandle?: string | null;
  feedTitle?: string | null;
  feedDescription?: string | null;
  robotsExtra?: string | null;
  llmsIntro?: string | null;
}

export interface SeoAuthor {
  name: string;
  slug: string;
  jobTitle?: string | null;
  bio?: string | null;
  url?: string | null;
  avatarUrl?: string | null;
  sameAs?: string[];
  knowsAbout?: string[];
}

export interface SeoTerm {
  name: string;
  slug: string;
}

export interface SeoImage {
  url: string;
  width?: number | null;
  height?: number | null;
  alt?: string | null;
}

/**
 * A named thing the document is about.
 *
 * `wikidataId` is what turns a string into a node in a knowledge graph. An
 * `about` of "Stripe" is a word; an `about` carrying Q1113411 is an entity an
 * engine can already reason about.
 */
export interface SeoEntity {
  name: string;
  sameAs?: string[];
  wikidataId?: string | null;
  isPrimary?: boolean;
}

export interface SeoQuestion {
  question: string;
  answerText: string;
  /** The `id` of the heading this answer sits under in the rendered body. */
  anchorId: string;
}

export interface SeoHowTo {
  name: string;
  description?: string;
  steps: { name: string; text: string }[];
}

export interface SeoDocument {
  slug: string;
  title: string;
  description?: string | null;
  excerpt?: string | null;
  bodyHtml?: string | null;
  /**
   * The markdown rendition produced by the content pipeline. It is what
   * `llms-full.txt` serves and what the `.md` alternate advertised in
   * `pageMetadataFields` points at.
   */
  bodyText?: string | null;
  publishedAt?: string | null;
  dateModified?: string | null;
  author?: SeoAuthor | null;
  authors?: SeoAuthor[];
  category?: SeoTerm | null;
  tags?: SeoTerm[];
  entities?: SeoEntity[];
  coverImage?: SeoImage | null;
  ogImage?: { url: string; width?: number | null; height?: number | null } | null;
  qa?: SeoQuestion[];
  howTo?: SeoHowTo | null;
  wordCount?: number;
  readingTimeMinutes?: number;
  /**
   * Set when this document was first published somewhere else. Honoured
   * verbatim — a syndicated post's canonical belongs to the original
   * publisher, and normalising it here would quietly claim it back.
   */
  canonicalUrlOverride?: string | null;
  noindex?: boolean;
  tldr?: string | null;
  keyTakeaways?: string[];
}

/** One step of a breadcrumb trail. `path` is root-relative on the consuming site. */
export interface SeoBreadcrumb {
  name: string;
  path: string;
}

/** A JSON-LD node. Plain data — this package never renders it itself. */
export type JsonLdObject = Record<string, unknown>;
