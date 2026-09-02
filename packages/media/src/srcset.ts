/**
 * Turning stored variant rows into the markup a browser can choose from.
 *
 * These take a `publicUrl` function rather than reading a base URL, so that the
 * renderer stays honest about where URLs come from: the storage driver owns CDN
 * resolution, and nothing here needs to know whether the deployment is on R2,
 * MinIO or a local folder.
 */

/** The subset of a variant row these builders need. Anything wider is accepted. */
export interface SrcsetVariant {
  key: string;
  width: number;
  format: string;
}

/**
 * A reasonable default for a single-column article body.
 *
 * Without a `sizes` attribute a browser assumes `100vw` and downloads the
 * widest candidate that fits the viewport, which on a 27" display means the
 * 1920 for an image rendered at 720. Worth overriding wherever the layout is
 * actually known.
 */
export const DEFAULT_SIZES = "(max-width: 720px) 100vw, 720px";

/**
 * Format preference order.
 *
 * A browser takes the first `<source>` whose `type` it understands and never
 * looks at the rest, so this list is a ranking, not a set: AVIF is the smallest
 * at equal quality, WebP is the widely-supported second, and the raster
 * fallback is what remains for clients that implement neither.
 */
const SOURCE_ORDER = ["avif", "webp", "jpeg", "png"] as const;

const MIME_TYPES: Record<string, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
};

/**
 * `"https://cdn/…/320.avif 320w, https://cdn/…/640.avif 640w"`.
 *
 * Ascending by width because that is the conventional reading order; browsers
 * do not care, humans reading page source do.
 */
export function buildSrcset(
  variants: readonly SrcsetVariant[],
  format: string,
  publicUrl: (key: string) => string,
): string {
  const seen = new Set<number>();
  return variants
    .filter((variant) => variant.format === format)
    .slice()
    .sort((a, b) => a.width - b.width)
    .filter((variant) => {
      // Two objects at the same width in the same format would give the browser
      // a meaningless choice; keep the first, which sorting made deterministic.
      if (seen.has(variant.width)) return false;
      seen.add(variant.width);
      return true;
    })
    .map((variant) => `${publicUrl(variant.key)} ${variant.width}w`)
    .join(", ");
}

/** The `<source>` list for a `<picture>`, already in the order a browser should try. */
export function buildPictureSources(
  variants: readonly SrcsetVariant[],
  publicUrl: (key: string) => string,
): { type: string; srcset: string }[] {
  const sources: { type: string; srcset: string }[] = [];

  for (const format of SOURCE_ORDER) {
    const srcset = buildSrcset(variants, format, publicUrl);
    if (srcset.length === 0) continue;
    sources.push({ type: MIME_TYPES[format]!, srcset });
  }

  return sources;
}
