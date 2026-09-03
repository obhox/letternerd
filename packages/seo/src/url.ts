import type { SeoDocument, SeoSite } from "./types";

/**
 * Every absolute URL this package emits is built here.
 *
 * The CMS is headless and multi-tenant: content is authored on one host and
 * served on another. Anything a crawler finds at a well-known path — a
 * sitemap, a feed, a JSON-LD `@id` — has to be expressed in the *content's*
 * origin, which is `site.baseUrl`. Funnelling every join through three
 * functions is what makes that checkable, and what keeps a stray
 * `process.env.CMS_URL` from ever creeping into a `<loc>`.
 *
 * The shape chosen throughout: absolute, no trailing slash, root is the bare
 * origin. Consistency matters more than which convention wins, because a
 * canonical that disagrees with a sitemap entry by one slash is two URLs to a
 * crawler and a duplicate-content report to a customer.
 */

/**
 * Joins path segments into one root-relative path.
 *
 * Segments may each carry, omit or double up their slashes — they arrive from
 * a settings column (`/blog`, `blog/`, `/blog/`) and from a slug, and the
 * result must not depend on which. Empty segments vanish, so `joinPath("/")`
 * and `joinPath("", null)` both give the root.
 */
export function joinPath(...segments: (string | null | undefined)[]): string {
  const parts = segments
    .filter((segment): segment is string => typeof segment === "string")
    .flatMap((segment) => segment.split("/"))
    .filter((part) => part.length > 0);

  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

/** `https://spendtab.com/` and `https://spendtab.com` are the same origin. */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

/**
 * A root-relative path resolved against the consuming site's origin.
 *
 * An input that is already an `http:` or `https:` URL is returned untouched:
 * callers pass user-supplied image and profile URLs through here, and those
 * legitimately point at a CDN or at LinkedIn. Those two schemes are the only
 * ones that count as absolute. Everything this function produces is written
 * into a `<loc>`, an `href`, a JSON-LD `url` or a `Sitemap:` line, and a
 * `javascript:` or `data:` URL has no business in any of them — yet an avatar
 * or logo URL is a settings field, and a settings field is where such a value
 * would arrive. Rather than trusting the scheme prefix, anything that is not
 * a web URL (a protocol-relative `//host` included) is treated as a path under
 * the site's own origin: the harmless outcome, a 404 here instead of a script
 * URL there. `mailto:` is not carved out because no caller needs it; if one
 * ever does, the exception belongs here, not at the call site.
 */
export function absoluteUrl(site: SeoSite, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;

  const origin = normalizeBaseUrl(site.baseUrl);
  const resolved = joinPath(path);
  return resolved === "/" ? origin : `${origin}${resolved}`;
}

/** Where a document lives on the consuming site, ignoring any syndication override. */
export function documentPath(site: SeoSite, doc: Pick<SeoDocument, "slug">): string {
  return joinPath(site.blogBasePath, doc.slug);
}

/** The document's own URL on the consuming site. Never the canonical override. */
export function documentUrl(site: SeoSite, doc: Pick<SeoDocument, "slug">): string {
  return absoluteUrl(site, documentPath(site, doc));
}

/** The two fields a canonical URL is derived from. */
export type CanonicalTarget = Pick<SeoDocument, "slug" | "canonicalUrlOverride">;

/**
 * What the page should declare as canonical.
 *
 * An override is emitted verbatim rather than normalised. It names a URL on
 * someone else's site — often one that ends in a slash, because WordPress —
 * and trimming it would point the canonical at a URL that redirects, which is
 * exactly the signal a canonical exists to avoid. The only adjustment made is
 * resolving a root-relative override against this site, since that form can
 * only mean "a different path here".
 */
export function canonicalUrlFor(site: SeoSite, doc: CanonicalTarget): string {
  const override = doc.canonicalUrlOverride?.trim();
  if (override) {
    // Verbatim only for a real web URL, resolved here only for a root-relative
    // path. Anything else — a scheme like `javascript:` that `.url()` lets
    // through — is not a canonical; it is ignored and the document's own URL
    // stands, which is the answer a consumer can render without thinking.
    if (/^https?:\/\//i.test(override)) return override;
    if (override.startsWith("/")) return absoluteUrl(site, override);
  }
  return documentUrl(site, doc);
}

/** True when the document's canonical points somewhere this site does not own. */
export function isSyndicated(site: SeoSite, doc: CanonicalTarget): boolean {
  return !canonicalUrlFor(site, doc).startsWith(`${normalizeBaseUrl(site.baseUrl)}/`);
}
