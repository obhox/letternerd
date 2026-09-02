/**
 * Where every object lives, and why the layout never changes.
 *
 * A key is derived from ids that are themselves immutable, and from the
 * rendition's own parameters. Nothing in a key depends on the filename the user
 * uploaded, on the site's domain, or on anything else that can be edited later.
 * Two consequences follow, and both are the point:
 *
 *   - Every object can ship `IMMUTABLE_CACHE_CONTROL`. A key's bytes never
 *     change meaning, so a year-long browser and edge cache is safe and no
 *     purge is ever needed. Replacing an image means a new asset id, not new
 *     bytes at an old key.
 *   - Deleting an asset is `sites/<siteId>/media/<assetId>/` — one prefix, no
 *     index to consult.
 *
 * The site id leads because it is the tenant boundary. A bucket policy or an
 * R2 token scoped to `sites/<siteId>/*` is then sufficient to isolate a tenant,
 * which would be impossible with a flat `media/<assetId>` layout.
 */

/**
 * One year, immutable. Safe only because of the layout above — if keys were
 * ever reused for different bytes this header would strand stale images in
 * caches we do not control.
 */
export const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** `sites/<siteId>/media/<assetId>` — the prefix that holds one asset's whole family. */
export function assetPrefix(siteId: string, assetId: string): string {
  return `sites/${segment(siteId)}/media/${segment(assetId)}`;
}

/** `sites/<siteId>/media/<assetId>/original.<ext>` */
export function originalKey(siteId: string, assetId: string, ext: string): string {
  return `${assetPrefix(siteId, assetId)}/original.${segment(stripDot(ext))}`;
}

/** `sites/<siteId>/media/<assetId>/<width>.<format>` */
export function variantKey(
  siteId: string,
  assetId: string,
  width: number,
  format: string,
): string {
  if (!Number.isInteger(width) || width <= 0) {
    throw new Error(`Invalid variant width: ${width}`);
  }
  return `${assetPrefix(siteId, assetId)}/${width}.${segment(stripDot(format))}`;
}

/**
 * `sites/<siteId>/og/<documentId>-<hash>.png`
 *
 * OG images live outside the media tree because they are derived from a
 * document, not uploaded against an asset. The hash is over the inputs that
 * produced the card — title, template, theme — which is what lets the key stay
 * immutable while a document's title changes: an edited title simply produces a
 * different key, and the crawler that cached the old one is not lied to.
 */
export function ogKey(siteId: string, documentId: string, hash: string): string {
  return `sites/${segment(siteId)}/og/${segment(documentId)}-${segment(hash)}.png`;
}

/**
 * The ref a document body stores instead of a URL.
 *
 * Rendering resolves it against the asset table and the configured CDN base, so
 * changing CDN domain is one env var. Storing `https://cdn.old/...` in a
 * thousand document bodies would make it a migration.
 */
export function mediaRef(assetId: string): string {
  return `media://${segment(assetId)}`;
}

export function parseMediaRef(ref: string): string | null {
  if (!ref.startsWith("media://")) return null;
  const id = ref.slice("media://".length);
  return id.length > 0 && !id.includes("/") ? id : null;
}

/**
 * Ids reach here from route params and from import pipelines. A `/` or `..` in
 * one would silently retarget the key into another tenant's prefix, so this
 * refuses rather than sanitising — a caller passing a malformed id has a bug
 * worth surfacing, and quietly rewriting it would hide a tenancy break.
 */
function segment(value: string): string {
  if (value.length === 0 || !/^[A-Za-z0-9._-]+$/.test(value) || value === "." || value === "..") {
    throw new Error(`Invalid key segment: ${JSON.stringify(value)}`);
  }
  return value;
}

function stripDot(ext: string): string {
  return ext.startsWith(".") ? ext.slice(1) : ext;
}
