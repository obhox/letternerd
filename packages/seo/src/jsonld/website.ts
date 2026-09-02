import type { JsonLdObject, SeoSite } from "../types";
import { normalizeBaseUrl } from "../url";
import { organizationId } from "./organization";
import { SCHEMA_CONTEXT, prune } from "./shared";

export function websiteId(site: SeoSite): string {
  return `${normalizeBaseUrl(site.baseUrl)}/#website`;
}

/**
 * The site itself, published once from the home page.
 *
 * `publisher` is a reference rather than an inlined organisation: the full
 * node is emitted by `organizationLd` on the same page, and repeating it would
 * describe the publisher twice with two chances to disagree.
 */
export function websiteLd(site: SeoSite): JsonLdObject {
  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "WebSite",
    "@id": websiteId(site),
    name: site.name,
    url: normalizeBaseUrl(site.baseUrl),
    description: site.feedDescription ?? undefined,
    inLanguage: site.locale,
    publisher: { "@id": organizationId(site) },
  });
}
