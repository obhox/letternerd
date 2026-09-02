import type { JsonLdObject, SeoDocument, SeoEntity, SeoImage, SeoSite } from "../types.js";
import { absoluteUrl, canonicalUrlFor } from "../url.js";
import { organizationNode } from "./organization.js";
import { personNode } from "./person.js";
import { SCHEMA_CONTEXT, listOrUndefined, prune } from "./shared.js";

/**
 * Google truncates a headline past this and the Rich Results test reports it
 * as an error, so the builder cuts it and keeps the original in
 * `alternativeHeadline` rather than dropping a title on the floor.
 */
export const HEADLINE_MAX = 110;

/**
 * Below this width Google Discover and the article rich result silently stop
 * showing the image. Nothing here resizes anything — the validator warns and
 * the media pipeline is what fixes it — but the number belongs next to the
 * code that picks the image.
 */
export const IMAGE_MIN_WIDTH = 1200;

export function truncateHeadline(title: string, max = HEADLINE_MAX): string {
  if (title.length <= max) return title;

  const cut = title.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  // Prefer a word boundary, but not one so early that the headline stops
  // making sense — a title with no spaces in its first 110 characters is
  // pathological enough that a hard cut is the better answer.
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function imageNode(site: SeoSite, image: SeoImage): JsonLdObject {
  return prune({
    "@type": "ImageObject",
    url: absoluteUrl(site, image.url),
    width: image.width ?? undefined,
    height: image.height ?? undefined,
    caption: image.alt ?? undefined,
  });
}

/**
 * The social card first, then the cover.
 *
 * `ogImage` is the deliberately-composed 1200x630 card; `coverImage` is
 * whatever the editor put at the top of the post. Both are offered because
 * Google picks per surface and prefers a choice of aspect ratios, and they are
 * deduplicated because a site that has not configured a separate card will
 * have the same URL in both columns.
 */
export function articleImages(doc: SeoDocument, site: SeoSite): JsonLdObject[] {
  const candidates: SeoImage[] = [];
  if (doc.ogImage) candidates.push(doc.ogImage);
  if (doc.coverImage) candidates.push(doc.coverImage);

  const seen = new Set<string>();
  const images: JsonLdObject[] = [];
  for (const candidate of candidates) {
    const url = absoluteUrl(site, candidate.url);
    if (seen.has(url)) continue;
    seen.add(url);
    images.push(imageNode(site, candidate));
  }
  return images;
}

/**
 * A named entity, identified rather than merely spelled.
 *
 * `wikidataId` becomes the node's `@id`, which is the difference between
 * telling an engine the article is about the word "Stripe" and telling it
 * which Stripe.
 */
export function entityNode(entity: SeoEntity): JsonLdObject {
  const wikidata = entity.wikidataId?.trim();
  const id = wikidata
    ? /^https?:/i.test(wikidata)
      ? wikidata
      : `https://www.wikidata.org/wiki/${wikidata}`
    : undefined;

  return prune({
    "@type": "Thing",
    "@id": id,
    name: entity.name,
    sameAs: listOrUndefined(entity.sameAs),
  });
}

/** `authors` wins when populated; `author` is the single-author shorthand. */
export function authorsOf(doc: SeoDocument): NonNullable<SeoDocument["authors"]> {
  if (doc.authors && doc.authors.length > 0) return doc.authors;
  return doc.author ? [doc.author] : [];
}

export function blogPostingLd(doc: SeoDocument, site: SeoSite): JsonLdObject {
  const url = canonicalUrlFor(site, doc);
  const authors = authorsOf(doc).map((author) => personNode(author, site));
  const entities = doc.entities ?? [];

  // An entity list with nothing marked primary is treated as all-primary:
  // `about` carrying every entity is a weaker signal than one carrying two,
  // but it beats an article that claims to be about nothing.
  const primary = entities.filter((entity) => entity.isPrimary);
  const about = (primary.length > 0 ? primary : entities).map(entityNode);
  const mentions = primary.length > 0 ? entities.filter((e) => !e.isPrimary).map(entityNode) : [];

  const headline = truncateHeadline(doc.title);

  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "BlogPosting",
    "@id": `${url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    headline,
    alternativeHeadline: headline === doc.title ? undefined : doc.title,
    description: doc.description ?? doc.excerpt ?? undefined,
    image: listOrUndefined(articleImages(doc, site)),
    datePublished: doc.publishedAt ?? undefined,
    // A document that has never been edited is still "modified" at
    // publication. Omitting `dateModified` makes freshness unreadable; lying
    // about it is worse, so it falls back to the publication date exactly.
    dateModified: doc.dateModified ?? doc.publishedAt ?? undefined,
    author: authors.length === 1 ? authors[0] : listOrUndefined(authors),
    publisher: organizationNode(site),
    inLanguage: site.locale,
    articleSection: doc.category?.name ?? undefined,
    keywords: listOrUndefined((doc.tags ?? []).map((tag) => tag.name)),
    wordCount: doc.wordCount,
    timeRequired: doc.readingTimeMinutes ? `PT${doc.readingTimeMinutes}M` : undefined,
    about: listOrUndefined(about),
    mentions: listOrUndefined(mentions),
  });
}
