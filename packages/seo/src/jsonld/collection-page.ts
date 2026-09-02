import type { JsonLdObject, SeoDocument, SeoSite } from "../types.js";
import { absoluteUrl, canonicalUrlFor } from "../url.js";
import { SCHEMA_CONTEXT, prune } from "./shared.js";
import { websiteId } from "./website.js";

export interface CollectionPageOptions {
  /** What this listing is called: "Blog", "Posts tagged Pricing", an author's name. */
  name: string;
  /** Root-relative path of the listing on the consuming site. */
  path: string;
  description?: string | null;
}

/**
 * An index, tag or author page described as a list of the things on it.
 *
 * The list carries `url` and `name` per item rather than inlining each
 * article: the articles describe themselves on their own pages, and a listing
 * that restates them invites an engine to treat the index as the canonical
 * home of content that lives elsewhere.
 */
export function collectionPageLd(
  docs: SeoDocument[],
  site: SeoSite,
  opts: CollectionPageOptions,
): JsonLdObject {
  const url = absoluteUrl(site, opts.path);

  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "CollectionPage",
    "@id": `${url}#collection`,
    url,
    name: opts.name,
    description: opts.description ?? undefined,
    inLanguage: site.locale,
    isPartOf: { "@id": websiteId(site) },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: docs.length,
      itemListElement: docs.map((doc, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: canonicalUrlFor(site, doc),
        name: doc.title,
      })),
    },
  });
}
