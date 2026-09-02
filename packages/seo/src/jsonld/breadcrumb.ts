import type { JsonLdObject, SeoBreadcrumb, SeoSite } from "../types";
import { absoluteUrl } from "../url";
import { SCHEMA_CONTEXT } from "./shared";

/**
 * The trail is given as root-relative paths and absolutised here, for the same
 * reason everything else is: a breadcrumb `item` pointing at the CMS host
 * describes a page that does not exist for the reader.
 */
export function breadcrumbLd(trail: SeoBreadcrumb[], site: SeoSite): JsonLdObject {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((step, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: step.name,
      item: absoluteUrl(site, step.path),
    })),
  };
}
