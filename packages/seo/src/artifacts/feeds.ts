import type { SeoAuthor, SeoDocument, SeoSite } from "../types.js";
import { absoluteUrl, canonicalUrlFor, normalizeBaseUrl } from "../url.js";
import { cdata, escapeXml, iso8601, rfc822 } from "./xml.js";

/**
 * Feeds, carrying the whole article rather than a teaser.
 *
 * This used to be a trade-off about ad impressions. It is not any more: feeds
 * are one of the few surfaces an answer engine can read cheaply, completely
 * and without rendering JavaScript, and a feed of 200-character excerpts is a
 * feed that gets summarised as 200 characters. `content:encoded` carries the
 * full body, and the excerpt goes in `description` where a reader's feed app
 * expects a preview.
 */

export interface FeedOptions {
  /** The listing page these items came from. Default: the blog base path. */
  path?: string;
  /** Where this feed is served. Used for the `self` link. */
  selfPath?: string;
  /** Overrides the feed-level timestamp. Default: the newest item's date. */
  updatedAt?: string | null;
}

function feedTitle(site: SeoSite): string {
  return site.feedTitle ?? site.name;
}

function authorNames(doc: SeoDocument): string[] {
  const authors: SeoAuthor[] = doc.authors && doc.authors.length > 0
    ? doc.authors
    : doc.author
      ? [doc.author]
      : [];
  return authors.map((author) => author.name);
}

function summaryOf(doc: SeoDocument): string {
  return doc.excerpt ?? doc.description ?? "";
}

function contentHtmlOf(doc: SeoDocument): string {
  return doc.bodyHtml ?? doc.bodyText ?? summaryOf(doc);
}

function itemDate(doc: SeoDocument): string | null {
  return doc.publishedAt ?? doc.dateModified ?? null;
}

/**
 * The newest date any item carries.
 *
 * There is no `Date.now()` anywhere in this package — a pure function that
 * reads the clock cannot be tested against a golden file, and a feed whose
 * `updated` changes on every request tells every reader that everything
 * changed. An empty feed simply has no update time to state.
 */
function latestDate(docs: SeoDocument[], override?: string | null): string {
  if (override) return iso8601(override);

  let latest = "";
  for (const doc of docs) {
    const value = iso8601(doc.dateModified ?? doc.publishedAt);
    if (value > latest) latest = value;
  }
  return latest;
}

/* -------------------------------------------------------------- RSS 2.0 -- */

export function buildRss(docs: SeoDocument[], site: SeoSite, opts: FeedOptions = {}): string {
  const { path = site.blogBasePath, selfPath = "/rss.xml" } = opts;
  const home = absoluteUrl(site, path);
  const self = absoluteUrl(site, selfPath);

  const items = docs.map((doc) => {
    const url = canonicalUrlFor(site, doc);
    const lines = [
      `      <title>${escapeXml(doc.title)}</title>`,
      `      <link>${escapeXml(url)}</link>`,
      // The canonical doubles as the guid: it is stable across edits, unique
      // per document, and already the identity every other surface uses.
      `      <guid isPermaLink="true">${escapeXml(url)}</guid>`,
    ];

    const published = rfc822(itemDate(doc));
    if (published) lines.push(`      <pubDate>${published}</pubDate>`);

    for (const name of authorNames(doc)) {
      lines.push(`      <dc:creator>${escapeXml(name)}</dc:creator>`);
    }
    if (doc.category) lines.push(`      <category>${escapeXml(doc.category.name)}</category>`);
    for (const tag of doc.tags ?? []) {
      lines.push(`      <category>${escapeXml(tag.name)}</category>`);
    }

    const summary = summaryOf(doc);
    if (summary) lines.push(`      <description>${escapeXml(summary)}</description>`);
    lines.push(`      <content:encoded>${cdata(contentHtmlOf(doc))}</content:encoded>`);

    return `    <item>\n${lines.join("\n")}\n    </item>`;
  });

  const channel = [
    `    <title>${escapeXml(feedTitle(site))}</title>`,
    `    <link>${escapeXml(home)}</link>`,
    `    <description>${escapeXml(site.feedDescription ?? "")}</description>`,
    `    <language>${escapeXml(site.locale)}</language>`,
    `    <atom:link href="${escapeXml(self)}" rel="self" type="application/rss+xml" />`,
  ];
  const updated = latestDate(docs, opts.updatedAt);
  if (updated) channel.push(`    <lastBuildDate>${rfc822(updated)}</lastBuildDate>`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    ...channel,
    ...items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

/* ----------------------------------------------------------------- Atom -- */

export function buildAtom(docs: SeoDocument[], site: SeoSite, opts: FeedOptions = {}): string {
  const { path = site.blogBasePath, selfPath = "/atom.xml" } = opts;
  const home = absoluteUrl(site, path);
  const self = absoluteUrl(site, selfPath);

  const entries = docs.map((doc) => {
    const url = canonicalUrlFor(site, doc);
    const published = iso8601(itemDate(doc));
    const updated = iso8601(doc.dateModified ?? itemDate(doc));

    const lines = [
      `    <title>${escapeXml(doc.title)}</title>`,
      `    <id>${escapeXml(url)}</id>`,
      `    <link rel="alternate" type="text/html" href="${escapeXml(url)}" />`,
    ];
    if (updated) lines.push(`    <updated>${updated}</updated>`);
    if (published) lines.push(`    <published>${published}</published>`);
    for (const name of authorNames(doc)) {
      lines.push(`    <author><name>${escapeXml(name)}</name></author>`);
    }
    for (const tag of doc.tags ?? []) {
      lines.push(`    <category term="${escapeXml(tag.slug)}" label="${escapeXml(tag.name)}" />`);
    }
    const summary = summaryOf(doc);
    if (summary) lines.push(`    <summary>${escapeXml(summary)}</summary>`);
    lines.push(`    <content type="html">${cdata(contentHtmlOf(doc))}</content>`);

    return `  <entry>\n${lines.join("\n")}\n  </entry>`;
  });

  const head = [
    `  <title>${escapeXml(feedTitle(site))}</title>`,
    `  <id>${escapeXml(`${normalizeBaseUrl(site.baseUrl)}/`)}</id>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(home)}" />`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(self)}" />`,
  ];
  const updated = latestDate(docs, opts.updatedAt);
  if (updated) head.push(`  <updated>${updated}</updated>`);
  if (site.feedDescription) {
    head.push(`  <subtitle>${escapeXml(site.feedDescription)}</subtitle>`);
  }
  head.push(`  <author><name>${escapeXml(site.orgName ?? site.name)}</name></author>`);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="${escapeXml(site.locale)}">`,
    ...head,
    ...entries,
    "</feed>",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------ JSON Feed -- */

export interface JsonFeedItem {
  id: string;
  url: string;
  title: string;
  content_html: string;
  summary?: string;
  date_published?: string;
  date_modified?: string;
  authors?: { name: string; url?: string }[];
  tags?: string[];
  image?: string;
  language?: string;
}

export interface JsonFeed {
  version: "https://jsonfeed.org/version/1.1";
  title: string;
  home_page_url: string;
  feed_url: string;
  description?: string;
  language?: string;
  authors?: { name: string; url?: string }[];
  items: JsonFeedItem[];
}

/**
 * Returned as an object, not a string: the SDK serialises it into a JSON
 * response, and handing back pre-stringified JSON only invites it to be parsed
 * and re-stringified on the way out.
 */
export function buildJsonFeed(docs: SeoDocument[], site: SeoSite, opts: FeedOptions = {}): JsonFeed {
  const { path = site.blogBasePath, selfPath = "/feed.json" } = opts;

  const items: JsonFeedItem[] = docs.map((doc) => {
    const url = canonicalUrlFor(site, doc);
    const authors = (doc.authors && doc.authors.length > 0 ? doc.authors : doc.author ? [doc.author] : [])
      .map((author) => ({
        name: author.name,
        ...(author.url ? { url: author.url } : {}),
      }));

    const published = iso8601(itemDate(doc));
    const modified = iso8601(doc.dateModified);
    const summary = summaryOf(doc);
    const image = doc.ogImage?.url ?? doc.coverImage?.url;

    return {
      id: url,
      url,
      title: doc.title,
      content_html: contentHtmlOf(doc),
      ...(summary ? { summary } : {}),
      ...(published ? { date_published: published } : {}),
      ...(modified ? { date_modified: modified } : {}),
      ...(authors.length > 0 ? { authors } : {}),
      ...(doc.tags && doc.tags.length > 0 ? { tags: doc.tags.map((tag) => tag.name) } : {}),
      ...(image ? { image: absoluteUrl(site, image) } : {}),
    };
  });

  return {
    version: "https://jsonfeed.org/version/1.1",
    title: feedTitle(site),
    home_page_url: absoluteUrl(site, path),
    feed_url: absoluteUrl(site, selfPath),
    ...(site.feedDescription ? { description: site.feedDescription } : {}),
    language: site.locale,
    authors: [{ name: site.orgName ?? site.name, url: normalizeBaseUrl(site.baseUrl) }],
    items,
  };
}
