import { createHash } from "node:crypto";

import { invalidInput } from "@cms/core";
import { encode as encodeBlurhash } from "blurhash";
import sharp, { type Metadata as SharpMetadata, type SharpOptions } from "sharp";

import { IMMUTABLE_CACHE_CONTROL, originalKey, variantKey } from "./keys";
import type { StorageService } from "./storage";

/**
 * The rendition ladder.
 *
 * Chosen to bracket the common CSS breakpoints rather than to be evenly spaced:
 * 320 is a phone at 1x, 640 the same phone at 2x, 960/1280 the article column
 * on a laptop, 1920 a full-bleed hero. Adding a width is cheap; removing one is
 * not, because published HTML already names it in a `srcset`.
 */
export const VARIANT_WIDTHS = [320, 640, 960, 1280, 1920] as const;

/**
 * 25 MB. Well above any reasonable photograph off a phone, well below what it
 * takes to exhaust a worker decoding it. The caller may lower it per plan.
 */
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * 50 megapixels. The byte limit above does not bound decoding cost: a PNG of
 * one colour compresses to a few kilobytes per hundred megapixels, and the
 * decoder allocates the full raster regardless — three or four bytes per
 * pixel, per worker, for as long as the request takes. Fifty megapixels is
 * above any camera an author is likely to own and still under 200 MB of
 * raster, which a worker survives. Unlike the byte limit this one is a
 * ceiling a caller may lower but never raise, because it protects the
 * process rather than the plan.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Every decoder in this file is constructed with these.
 *
 * `limitInputPixels` makes libvips refuse a raster over the ceiling before it
 * allocates one, so the check in `processUpload` is not the only line of
 * defence — a variant or a blurhash is decoded from the normalised original,
 * which is already bounded, but nothing here should depend on that ordering.
 * `failOn: "warning"` refuses a file libvips only partly understands; an
 * upload that trips a decoder warning is either corrupt or crafted, and in
 * neither case is "best effort" the right answer for something that will be
 * served from the CDN origin.
 */
const DECODER_OPTIONS = {
  failOn: "warning",
  limitInputPixels: MAX_INPUT_PIXELS,
} as const satisfies SharpOptions;

/** AVIF earns its keep at low quality; 50 is roughly WebP 75 to the eye at a third the bytes. */
const AVIF_QUALITY = 50;
const WEBP_QUALITY = 78;

/** Quality for the re-encoded original, high enough that the generation loss from stripping EXIF is not visible. */
const ORIGINAL_QUALITY = 92;

/**
 * The fallback exists for clients that understand neither AVIF nor WebP, which
 * in practice means old email clients and scrapers. One width is enough — those
 * clients do not implement `srcset` either.
 */
const FALLBACK_WIDTH = 1280;

/** Blurhash is a ~30-byte perceptual smear; encoding above this resolution changes nothing and costs time. */
const BLURHASH_SIZE = 32;
const BLURHASH_COMPONENTS_X = 4;
const BLURHASH_COMPONENTS_Y = 3;

/**
 * Formats we will decode.
 *
 * An allowlist, not a denylist, and deliberately without SVG: an SVG is a
 * document with script and external-entity semantics, not a raster, and
 * accepting one into a pipeline that later serves it from the CDN origin is how
 * a media library becomes a stored-XSS vector.
 */
const RASTER_FORMATS = new Set(["jpeg", "png", "webp", "avif", "heif", "gif", "tiff", "jp2"]);

/** What the stored original is re-encoded to, per decoded format. */
const ORIGINAL_ENCODING: Record<string, "jpeg" | "png" | "webp" | "avif"> = {
  jpeg: "jpeg",
  png: "png",
  webp: "webp",
  avif: "avif",
  heif: "jpeg",
  jp2: "jpeg",
  // GIF and TIFF are re-encoded to PNG: both may carry alpha, and neither is
  // worth serving as-is. Animation is not preserved — animated media is a
  // separate asset kind, not a variant ladder.
  gif: "png",
  tiff: "png",
};

const MIME_TYPES: Record<string, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
};

const EXTENSIONS: Record<string, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
  avif: "avif",
};

export interface ProcessedVariant {
  key: string;
  width: number;
  height: number;
  format: string;
  bytes: number;
}

export interface ProcessedUpload {
  /** Over the bytes the caller handed us, so `(siteId, checksum)` dedupes re-uploads of the same file. */
  checksumSha256: string;
  /** Of the stored original, which is a re-encode — see `processUpload`. */
  mimeType: string;
  /** Size of the stored original object, not of the uploaded buffer. */
  bytes: number;
  width: number;
  height: number;
  blurhash: string | null;
  dominantColor: string | null;
  original: { key: string };
  variants: ProcessedVariant[];
}

export interface ProcessUploadInput {
  buffer: Buffer;
  siteId: string;
  assetId: string;
  filename?: string;
  storage: StorageService;
  maxBytes?: number;
  /** A lower pixel ceiling than `MAX_INPUT_PIXELS`. A higher one is ignored. */
  maxPixels?: number;
}

/**
 * Exposed separately so the caller can dedupe before paying for any of this.
 *
 * Re-uploading the same photograph is the common case in an editorial workflow,
 * and the cheapest possible answer to it is to hash the bytes, find the
 * existing asset row, and never call `processUpload` at all.
 */
export function checksumOf(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Decode, sanitise, rescale and store one uploaded image.
 *
 * Performs no database work by design. Storage writes cannot participate in a
 * transaction, so the caller runs this first and then writes the asset and
 * variant rows in one transaction from the returned metadata. If the
 * transaction fails, the orphaned objects are reconciled by prefix later —
 * which is recoverable, whereas a committed row pointing at an object that was
 * never written is a broken image on a published page.
 */
export async function processUpload(input: ProcessUploadInput): Promise<ProcessedUpload> {
  const { buffer, siteId, assetId, storage } = input;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxPixels = Math.min(input.maxPixels ?? MAX_INPUT_PIXELS, MAX_INPUT_PIXELS);

  const checksumSha256 = checksumOf(buffer);

  // Before sharp touches it: a size check is free, and decoding a hostile
  // 500 MB upload just to reject it afterwards is the denial of service.
  if (buffer.byteLength > maxBytes) {
    throw invalidInput(
      `Image is ${buffer.byteLength} bytes, which exceeds the ${maxBytes} byte limit.`,
      { bytes: buffer.byteLength, maxBytes },
    );
  }

  const metadata = await readMetadata(buffer);
  const format = metadata.format;

  // The client's declared MIME type is not consulted anywhere in this function.
  // It is attacker-controlled, and "image/png" on a PHP file is the oldest
  // upload exploit there is. What the decoder actually recognises is the only
  // fact worth acting on.
  if (!format || !RASTER_FORMATS.has(format)) {
    throw invalidInput(
      `Unsupported upload: expected a raster image (${[...RASTER_FORMATS].join(", ")}), got ${format ?? "an unrecognised file"}.`,
      { detectedFormat: format ?? null },
    );
  }

  if (!metadata.width || !metadata.height) {
    throw invalidInput("Image has no readable dimensions.", { detectedFormat: format });
  }

  // Before `normalise` decodes anything: the header has told us the raster
  // size, and a decompression bomb is rejected on that alone, the same way an
  // oversized upload is rejected on its byte length.
  const pixels = metadata.width * metadata.height;
  if (pixels > maxPixels) {
    throw invalidInput(
      `Image is ${metadata.width}x${metadata.height} (${pixels} pixels), which exceeds the ${maxPixels} pixel limit.`,
      { width: metadata.width, height: metadata.height, pixels, maxPixels },
    );
  }

  // EXIF orientation is applied rather than preserved (see `normalise`), so for
  // orientations 5-8 the displayed image is the transpose of the stored one.
  const rotated = (metadata.orientation ?? 1) >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  const hasAlpha = metadata.hasAlpha === true;

  const originalFormat = ORIGINAL_ENCODING[format] ?? "jpeg";
  const normalised = await normalise(buffer, originalFormat);

  const specs = variantSpecs(width, hasAlpha);

  const [variantResults, blurhash, dominantColor] = await Promise.all([
    Promise.all(specs.map((spec) => renderVariant(normalised, spec))),
    computeBlurhash(normalised),
    computeDominantColor(normalised),
  ]);

  const originalObjectKey = originalKey(siteId, assetId, EXTENSIONS[originalFormat] ?? "bin");
  const originalMime = MIME_TYPES[originalFormat] ?? "application/octet-stream";

  const variants: ProcessedVariant[] = variantResults.map((result) => ({
    key: variantKey(siteId, assetId, result.width, result.format),
    width: result.width,
    height: result.height,
    format: result.format,
    bytes: result.body.byteLength,
  }));

  await Promise.all([
    storage.put(originalObjectKey, normalised, originalMime, IMMUTABLE_CACHE_CONTROL),
    ...variantResults.map((result, index) =>
      storage.put(
        variants[index]!.key,
        result.body,
        MIME_TYPES[result.format] ?? "application/octet-stream",
        IMMUTABLE_CACHE_CONTROL,
      ),
    ),
  ]);

  return {
    checksumSha256,
    mimeType: originalMime,
    bytes: normalised.byteLength,
    width,
    height,
    blurhash,
    dominantColor,
    original: { key: originalObjectKey },
    variants,
  };
}

async function readMetadata(buffer: Buffer): Promise<SharpMetadata> {
  try {
    return await sharp(buffer, DECODER_OPTIONS).metadata();
  } catch (error) {
    // sharp applies `limitInputPixels` while reading the header, so a raster
    // over `MAX_INPUT_PIXELS` is refused here, before its dimensions ever
    // reach the check in `processUpload` (which still owns the per-caller
    // ceiling). That rejection must not fall into the "not an image" bucket
    // below: the editor needs to hear "too large", not "unreadable", to know
    // what to do about it.
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw invalidInput(`Image exceeds the ${MAX_INPUT_PIXELS} pixel limit.`, {
        maxPixels: MAX_INPUT_PIXELS,
      });
    }
    // sharp's own message names libvips loaders, which is noise to an editor
    // who dragged a PDF into the media library.
    throw invalidInput("Unsupported upload: the file could not be decoded as an image.");
  }
}

/**
 * The stored original: orientation baked in, every other tag gone.
 *
 * `rotate()` with no argument reads the EXIF orientation tag and applies it, and
 * sharp writes no metadata to the output unless asked — so one call both makes
 * the pixels upright and drops the rest. Dropping the rest is the part that
 * matters. A photograph off a phone carries GPS coordinates to the metre, a
 * device serial and a capture timestamp, and an author illustrating a post from
 * their camera roll is publishing their home address to anyone who runs
 * `exiftool` on the CDN URL. Nobody audits this, and nobody notices when it
 * leaks, so it is stripped unconditionally rather than behind a setting.
 *
 * The cost is one generational re-encode of the original, which is why quality
 * is high here — a lossless copy is not on offer if the metadata must go.
 */
async function normalise(
  buffer: Buffer,
  format: "jpeg" | "png" | "webp" | "avif",
): Promise<Buffer> {
  const pipeline = sharp(buffer, DECODER_OPTIONS).rotate();
  switch (format) {
    case "jpeg":
      return pipeline.jpeg({ quality: ORIGINAL_QUALITY, mozjpeg: true }).toBuffer();
    case "png":
      return pipeline.png({ compressionLevel: 9 }).toBuffer();
    case "webp":
      return pipeline.webp({ quality: ORIGINAL_QUALITY }).toBuffer();
    case "avif":
      return pipeline.avif({ quality: 65 }).toBuffer();
  }
}

interface VariantSpec {
  width: number;
  format: "avif" | "webp" | "jpeg" | "png";
}

/**
 * Which renditions to produce for a source of this width.
 *
 * Upscaling is never useful: it costs bytes and CPU to ship blur. So the ladder
 * is truncated at the source width, and a small source simply gets fewer
 * variants. The raster fallback is pinned separately at the source width when
 * that is under `FALLBACK_WIDTH`, which is why a 400px source still yields a
 * 400px object even though 400 is not a ladder width.
 */
function variantSpecs(sourceWidth: number, hasAlpha: boolean): VariantSpec[] {
  const specs: VariantSpec[] = [];

  for (const width of VARIANT_WIDTHS) {
    if (width > sourceWidth) continue;
    specs.push({ width, format: "avif" });
    specs.push({ width, format: "webp" });
  }

  // PNG when the source has alpha: a JPEG fallback would flatten transparency
  // onto an assumed background and look broken on any other one.
  specs.push({
    width: Math.min(FALLBACK_WIDTH, sourceWidth),
    format: hasAlpha ? "png" : "jpeg",
  });

  return specs;
}

interface RenderedVariant {
  width: number;
  height: number;
  format: string;
  body: Buffer;
}

async function renderVariant(source: Buffer, spec: VariantSpec): Promise<RenderedVariant> {
  // `withoutEnlargement` is belt-and-braces against a rounding disagreement
  // between the width we computed and the one libvips sees.
  const pipeline = sharp(source, DECODER_OPTIONS).resize({
    width: spec.width,
    withoutEnlargement: true,
  });

  const encoded =
    spec.format === "avif"
      ? pipeline.avif({ quality: AVIF_QUALITY })
      : spec.format === "webp"
        ? pipeline.webp({ quality: WEBP_QUALITY })
        : spec.format === "png"
          ? pipeline.png({ compressionLevel: 9 })
          : pipeline.jpeg({ quality: 82, mozjpeg: true });

  const { data, info } = await encoded.toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, format: spec.format, body: data };
}

/**
 * The placeholder shown while the real image loads.
 *
 * Null rather than throwing when encoding fails: a missing blurhash degrades to
 * a grey box, which is not worth failing an otherwise good upload over.
 */
async function computeBlurhash(source: Buffer): Promise<string | null> {
  try {
    // `ensureAlpha` because the encoder wants four channels per pixel and a
    // JPEG source has three; `raw` because it wants pixels, not a container.
    const { data, info } = await sharp(source, DECODER_OPTIONS)
      .resize(BLURHASH_SIZE, BLURHASH_SIZE, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return encodeBlurhash(
      new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
      info.width,
      info.height,
      BLURHASH_COMPONENTS_X,
      BLURHASH_COMPONENTS_Y,
    );
  } catch {
    return null;
  }
}

/** Used as the placeholder background and as the theme colour on a media detail page. */
async function computeDominantColor(source: Buffer): Promise<string | null> {
  try {
    const { dominant } = await sharp(source, DECODER_OPTIONS).stats();
    return `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  } catch {
    return null;
  }
}

function hex(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
}
