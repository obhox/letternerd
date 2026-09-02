import type { SeoDocument, SeoImage, SeoSite } from "./types.js";
import { absoluteUrl, canonicalUrlFor, documentUrl } from "./url.js";

/**
 * The head of a document page, as plain data.
 *
 * Deliberately not Next's `Metadata`. This package is imported by the studio,
 * by the public API and by the SDK, and only the last of those is a Next app —
 * pulling `next` in here to borrow a type would make the SEO layer unusable
 * from a worker or a CLI. The SDK owns the twenty lines that map this onto
 * whatever its host framework wants; the decisions live here.
 */

export interface RobotsDirectives {
  index: boolean;
  follow: boolean;
  /**
   * The two directives that decide whether a result is a link or an answer.
   * A large image preview is what qualifies a page for Discover and for the
   * image-led result layouts, and an unlimited snippet is what lets an engine
   * quote enough of the page to cite it rather than paraphrase it. Both are
   * opt-in, and both default to something smaller.
   */
  "max-image-preview": "none" | "standard" | "large";
  "max-snippet": number;
  "max-video-preview": number;
}

export interface OpenGraphImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface AlternateLink {
  type: string;
  url: string;
}

export interface PageMetadataFields {
  title: string;
  description: string;
  canonical: string;
  robots: RobotsDirectives;
  alternates: {
    canonical: string;
    /** Additional representations of this same page, by media type. */
    types: AlternateLink[];
  };
  openGraph: {
    type: "article" | "website";
    url: string;
    siteName: string;
    title: string;
    description: string;
    locale: string;
    images: OpenGraphImage[];
    publishedTime?: string;
    modifiedTime?: string;
    authors?: string[];
    section?: string;
    tags?: string[];
  };
  twitter: {
    card: "summary_large_image" | "summary";
    title: string;
    description: string;
    images: string[];
    site?: string;
    creator?: string;
  };
}

export interface PageMetadataOptions {
  /** `false` suppresses the " · Site name" suffix, e.g. on a home page. */
  titleSuffix?: boolean;
  type?: "article" | "website";
  /** Used when the document has neither an og image nor a cover. */
  fallbackImageUrl?: string | null;
}

/**
 * Open Graph wants `en_GB` where BCP-47 says `en-GB`. It is one character and
 * it is the difference between Facebook and LinkedIn reading the locale and
 * ignoring it.
 */
export function openGraphLocale(locale: string): string {
  return locale.replace("-", "_");
}

/** `@handle`, however the setting was typed. */
function twitterHandle(handle: string | null | undefined): string | undefined {
  if (!handle) return undefined;
  const trimmed = handle.trim().replace(/^@+/, "");
  return trimmed === "" ? undefined : `@${trimmed}`;
}

function ogImages(doc: SeoDocument, site: SeoSite, fallback?: string | null): OpenGraphImage[] {
  const candidates: SeoImage[] = [];
  if (doc.ogImage) candidates.push(doc.ogImage);
  if (doc.coverImage) candidates.push(doc.coverImage);
  if (candidates.length === 0 && fallback) candidates.push({ url: fallback });

  const seen = new Set<string>();
  const images: OpenGraphImage[] = [];
  for (const candidate of candidates) {
    const url = absoluteUrl(site, candidate.url);
    if (seen.has(url)) continue;
    seen.add(url);
    images.push({
      url,
      ...(candidate.width ? { width: candidate.width } : {}),
      ...(candidate.height ? { height: candidate.height } : {}),
      ...(candidate.alt ? { alt: candidate.alt } : {}),
    });
  }
  return images;
}

export function pageMetadataFields(
  doc: SeoDocument,
  site: SeoSite,
  opts: PageMetadataOptions = {},
): PageMetadataFields {
  const { titleSuffix = true, type = "article", fallbackImageUrl = null } = opts;

  const canonical = canonicalUrlFor(site, doc);
  const description = doc.description ?? doc.excerpt ?? "";
  const socialTitle = titleSuffix ? `${doc.title} · ${site.name}` : doc.title;
  const images = ogImages(doc, site, fallbackImageUrl);
  const authors = (doc.authors && doc.authors.length > 0 ? doc.authors : doc.author ? [doc.author] : [])
    .map((author) => author.name);

  const handle = twitterHandle(site.twitterHandle);

  return {
    title: doc.title,
    description,
    canonical,
    robots: {
      index: !doc.noindex,
      // A noindex page is still worth following: it is usually a thin
      // landing or a paginated tail whose outbound links point at pages that
      // do want indexing, and `nofollow` would strand them.
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
    alternates: {
      canonical,
      types: [
        {
          // The markdown rendition of this page, for agents that would rather
          // not parse HTML. It hangs off the *site's own* URL rather than the
          // canonical: a syndicated post's canonical belongs to another
          // publisher, and this site cannot serve a `.md` on their domain.
          type: "text/markdown",
          url: `${documentUrl(site, doc)}.md`,
        },
      ],
    },
    openGraph: {
      type,
      url: canonical,
      siteName: site.name,
      title: socialTitle,
      description,
      locale: openGraphLocale(site.locale),
      images,
      ...(doc.publishedAt ? { publishedTime: doc.publishedAt } : {}),
      ...(doc.dateModified ? { modifiedTime: doc.dateModified } : {}),
      ...(authors.length > 0 ? { authors } : {}),
      ...(doc.category ? { section: doc.category.name } : {}),
      ...(doc.tags && doc.tags.length > 0 ? { tags: doc.tags.map((tag) => tag.name) } : {}),
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title: socialTitle,
      description,
      images: images.map((image) => image.url),
      ...(handle ? { site: handle, creator: handle } : {}),
    },
  };
}
