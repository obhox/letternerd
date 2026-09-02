/**
 * Everything a crawler, a feed reader or an answer engine sees.
 *
 * The rule the whole package obeys: content is authored here and served on the
 * consuming site's own domain, so every absolute URL is built from
 * `site.baseUrl` and never from the CMS's hostname. A sitemap listing one
 * origin's URLs from another origin is rejected outright, and the quieter
 * versions of the same mistake — a canonical, a feed `guid`, a JSON-LD `@id`
 * pointing at the CMS — cost rankings without ever reporting an error.
 *
 * Every export is a pure function. No database, no network, no environment, no
 * clock.
 */

export * from "./types.js";
export * from "./url.js";
export * from "./jsonld/index.js";
export * from "./validate/index.js";
export * from "./artifacts/index.js";
export * from "./metadata.js";
