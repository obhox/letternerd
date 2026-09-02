import type { SeoDocument, SeoSite } from "../types.js";
import { absoluteUrl, documentPath, isSyndicated } from "../url.js";
import { escapeXml, iso8601 } from "./xml.js";

/**
 * The sitemap, and the clearest case for why this package exists.
 *
 * A sitemap is only valid for URLs on the host that serves it. The CMS knows
 * the content but does not own the domain, so it generates the XML and the
 * consuming site serves it from its own `/sitemap.xml`. Every `<loc>` is
 * therefore built from `site.baseUrl`; the moment one is built from the CMS's
 * own hostname the file becomes a cross-domain sitemap and Search Console
 * discards all of it, not just the offending line.
 */

export type ChangeFrequency =
  | "always"
  | "hourly"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "never";

export interface SitemapEntry {
  /** Root-relative path on the consuming site, or an absolute URL on it. */
  path: string;
  /** Becomes `<lastmod>`. The document's `dateModified`. */
  dateModified?: string | null;
  changeFrequency?: ChangeFrequency;
  /** 0.0–1.0. Omitted rather than defaulted; a uniform 0.5 on every URL says nothing. */
  priority?: number;
  /** Dropped from the output. A noindex URL in a sitemap asks a crawler to ignore itself. */
  noindex?: boolean;
}

/**
 * Google's limits are 50 000 URLs and 50 MB per file. Chunking at 45 000
 * leaves room to grow between one generation and the next: a boundary that
 * moves rewrites the contents of every later chunk and re-submits thousands of
 * URLs that never changed.
 */
export const SITEMAP_CHUNK_SIZE = 45_000;

export function chunkSitemapEntries<T>(entries: T[], size = SITEMAP_CHUNK_SIZE): T[][] {
  if (size < 1) throw new RangeError("Sitemap chunk size must be at least 1.");
  if (entries.length === 0) return [];

  const chunks: T[][] = [];
  for (let index = 0; index < entries.length; index += size) {
    chunks.push(entries.slice(index, index + size));
  }
  return chunks;
}

/**
 * A document's sitemap entry, or `null` when it does not belong in one.
 *
 * Syndicated documents are dropped: their canonical names another origin, and
 * an entry for a URL that disclaims itself is a contradiction a crawler
 * resolves by trusting neither statement.
 */
export function documentSitemapEntry(doc: SeoDocument, site: SeoSite): SitemapEntry | null {
  if (doc.noindex) return null;
  if (isSyndicated(site, doc)) return null;

  return {
    path: documentPath(site, doc),
    dateModified: doc.dateModified ?? doc.publishedAt ?? null,
  };
}

export function documentSitemapEntries(docs: SeoDocument[], site: SeoSite): SitemapEntry[] {
  return docs
    .map((doc) => documentSitemapEntry(doc, site))
    .filter((entry): entry is SitemapEntry => entry !== null);
}

export function buildSitemap(entries: SitemapEntry[], site: SeoSite): string {
  const urls = entries
    .filter((entry) => !entry.noindex)
    .map((entry) => {
      const lines = [`    <loc>${escapeXml(absoluteUrl(site, entry.path))}</loc>`];
      const lastmod = iso8601(entry.dateModified);
      if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
      if (entry.changeFrequency) lines.push(`    <changefreq>${entry.changeFrequency}</changefreq>`);
      if (entry.priority !== undefined) {
        lines.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
      }
      return `  <url>\n${lines.join("\n")}\n  </url>`;
    });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}

export interface SitemapIndexEntry {
  path: string;
  dateModified?: string | null;
}

/** Accepts paths or absolute URLs; both resolve against the consuming origin. */
export function buildSitemapIndex(
  sitemapUrls: (string | SitemapIndexEntry)[],
  site: SeoSite,
): string {
  const items = sitemapUrls.map((entry) => {
    const normalized: SitemapIndexEntry = typeof entry === "string" ? { path: entry } : entry;
    const lines = [`    <loc>${escapeXml(absoluteUrl(site, normalized.path))}</loc>`];
    const lastmod = iso8601(normalized.dateModified);
    if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
    return `  <sitemap>\n${lines.join("\n")}\n  </sitemap>`;
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...items,
    "</sitemapindex>",
    "",
  ].join("\n");
}
