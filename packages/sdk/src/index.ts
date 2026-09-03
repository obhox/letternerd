/**
 * `@obhox/cms-sdk` — the typed client a consuming site renders CMS content
 * with.
 *
 * This entry point is runtime-agnostic on purpose. It needs `fetch` and
 * nothing else: no `next`, no `react`, no Node built-in. That is what lets the
 * same client run inside a Next server component, a Cloudflare Worker, a
 * scheduled export script and a test — and it is why the Next-specific
 * adapters live in `@obhox/cms-sdk/next` rather than here. An `import` of a
 * framework in this file would be invisible until someone deployed to an edge
 * runtime and found out at request time.
 *
 * The SEO builders are re-exported rather than reimplemented. `@cms/seo` is
 * pure, has no dependencies and is already the CMS's own answer for what a
 * crawler sees; it is inlined into this package's bundle so a consuming site
 * gets it from one import without being able to install it separately — and,
 * more to the point, without there being a second implementation of a sitemap
 * to disagree with the first.
 */

export * from "./types";
export * from "./errors";
export * from "./client";
export { toSeoDocument, toSeoDocuments, toSeoSite, byNewestFirst } from "./adapt";
export type { FetchLike, HttpClientOptions, NextFetchInit, RequestOptions } from "./http";

export {
  // JSON-LD.
  blogPostingLd,
  organizationLd,
  personLd,
  websiteLd,
  breadcrumbLd,
  faqLd,
  howToLd,
  speakableLd,
  collectionPageLd,
  jsonLdScript,
  // Artifacts.
  buildSitemap,
  buildSitemapIndex,
  chunkSitemapEntries,
  documentSitemapEntry,
  documentSitemapEntries,
  buildRobotsTxt,
  buildRss,
  buildAtom,
  buildJsonFeed,
  buildLlmsTxt,
  buildLlmsFullTxt,
  streamLlmsFullTxt,
  AI_CRAWLER_USER_AGENTS,
  SITEMAP_CHUNK_SIZE,
  // Metadata and URLs. `canonicalUrlFor` is exported for callers that hold a
  // document the API did not build a canonical for; the client itself never
  // calls it (see the note in `client.ts`).
  pageMetadataFields,
  canonicalUrlFor,
  documentUrl,
  documentPath,
  absoluteUrl,
  normalizeBaseUrl,
} from "@cms/seo";

export type {
  SeoSite,
  SeoDocument,
  SeoAuthor,
  SeoTerm,
  SeoImage,
  SeoEntity,
  SeoQuestion,
  SeoHowTo,
  SeoBreadcrumb,
  JsonLdObject,
  SitemapEntry,
  JsonFeed,
  PageMetadataFields,
} from "@cms/seo";
