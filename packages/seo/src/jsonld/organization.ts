import type { JsonLdObject, SeoSite } from "../types";
import { absoluteUrl, normalizeBaseUrl } from "../url";
import { SCHEMA_CONTEXT, listOrUndefined, prune } from "./shared";

/**
 * The publisher, as a stable node other nodes point at.
 *
 * The `@id` is the consuming site's origin with a fragment, not the CMS's.
 * Every article on that origin references the same `@id`, which is how a
 * crawler collapses a hundred `publisher` objects into one organisation
 * rather than a hundred organisations that happen to share a name.
 */
export function organizationId(site: SeoSite): string {
  return `${normalizeBaseUrl(site.baseUrl)}/#organization`;
}

/** The embedded form: no `@context`, because it is nested inside one. */
export function organizationNode(site: SeoSite): JsonLdObject {
  return prune({
    "@type": "Organization",
    "@id": organizationId(site),
    name: site.orgName ?? site.name,
    url: normalizeBaseUrl(site.baseUrl),
    logo: site.orgLogoUrl
      ? prune({ "@type": "ImageObject", url: absoluteUrl(site, site.orgLogoUrl) })
      : undefined,
    sameAs: listOrUndefined(site.orgSameAs),
  });
}

export function organizationLd(site: SeoSite): JsonLdObject {
  return { "@context": SCHEMA_CONTEXT, ...organizationNode(site) };
}
