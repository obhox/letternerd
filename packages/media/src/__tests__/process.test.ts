import { decode as decodeBlurhash } from "blurhash";
import sharp, { type Sharp as SharpInstance } from "sharp";
import { describe, expect, it } from "vitest";

import {
  IMMUTABLE_CACHE_CONTROL,
  MAX_INPUT_PIXELS,
  type ProcessedUpload,
  type StorageService,
  VARIANT_WIDTHS,
  checksumOf,
  processUpload,
} from "../index";

interface StoredObject {
  body: Buffer;
  contentType: string;
  cacheControl: string | undefined;
}

/** In-memory driver: the pipeline is the unit under test, not S3. */
function fakeStorage(): StorageService & { objects: Map<string, StoredObject> } {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    async put(key, bytes, contentType, cacheControl) {
      objects.set(key, { body: bytes, contentType, cacheControl });
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) throw new Error(`missing ${key}`);
      return object.body;
    },
    async delete(keys) {
      for (const key of keys) objects.delete(key);
    },
    publicUrl(key) {
      return `https://cdn.test/${key}`;
    },
  };
}

function solidImage(
  width: number,
  height: number,
  options: { alpha?: boolean } = {},
): SharpInstance {
  return sharp({
    create: {
      width,
      height,
      channels: options.alpha ? 4 : 3,
      background: options.alpha
        ? { r: 200, g: 60, b: 40, alpha: 0.5 }
        : { r: 200, g: 60, b: 40 },
    },
  });
}

const jpeg = (width: number, height: number) => solidImage(width, height).jpeg().toBuffer();

async function run(
  buffer: Buffer,
  over: Partial<Parameters<typeof processUpload>[0]> = {},
): Promise<{ result: ProcessedUpload; storage: ReturnType<typeof fakeStorage> }> {
  const storage = over.storage ? (over.storage as ReturnType<typeof fakeStorage>) : fakeStorage();
  const result = await processUpload({
    buffer,
    siteId: "site1",
    assetId: "asset1",
    storage,
    ...over,
  });
  return { result, storage };
}

describe("checksumOf", () => {
  it("is stable and content-addressed, so callers can dedupe before processing", () => {
    const a = Buffer.from("hello");
    expect(checksumOf(a)).toBe(checksumOf(Buffer.from("hello")));
    expect(checksumOf(a)).toHaveLength(64);
    expect(checksumOf(a)).not.toBe(checksumOf(Buffer.from("hellp")));
  });
});

describe("processUpload", () => {
  it("never upscales: a 400px source yields the 320 rung plus its own width", async () => {
    const { result } = await run(await jpeg(400, 300));

    const widths = [...new Set(result.variants.map((v) => v.width))].sort((a, b) => a - b);
    expect(widths).toEqual([320, 400]);
    expect(result.variants.every((v) => v.width <= 400)).toBe(true);
    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  }, 30_000);

  it("produces avif, webp and a raster fallback", async () => {
    const { result, storage } = await run(await jpeg(700, 500));

    const formats = new Set(result.variants.map((v) => v.format));
    expect(formats).toEqual(new Set(["avif", "webp", "jpeg"]));

    // Ladder rungs at or under the source width, both modern formats each.
    const ladder = VARIANT_WIDTHS.filter((w) => w <= 700);
    for (const width of ladder) {
      for (const format of ["avif", "webp"]) {
        expect(result.variants.some((v) => v.width === width && v.format === format)).toBe(true);
      }
    }

    // One fallback, pinned to the source width because it is under 1280.
    const fallback = result.variants.filter((v) => v.format === "jpeg");
    expect(fallback).toHaveLength(1);
    expect(fallback[0]!.width).toBe(700);

    // Everything named in the result is actually in storage, immutably cached.
    for (const key of [result.original.key, ...result.variants.map((v) => v.key)]) {
      const object = storage.objects.get(key);
      expect(object, key).toBeDefined();
      expect(object!.cacheControl).toBe(IMMUTABLE_CACHE_CONTROL);
      expect(object!.body.byteLength).toBeGreaterThan(0);
    }

    expect(storage.objects.get(result.original.key)!.contentType).toBe("image/jpeg");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.original.key).toBe("sites/site1/media/asset1/original.jpg");
  }, 30_000);

  it("uses a png fallback when the source has alpha", async () => {
    const { result } = await run(await solidImage(400, 400, { alpha: true }).png().toBuffer());

    const fallbackFormats = result.variants
      .filter((v) => v.format !== "avif" && v.format !== "webp")
      .map((v) => v.format);
    expect(fallbackFormats).toEqual(["png"]);
  }, 30_000);

  it("strips EXIF from the stored original", async () => {
    const source = await solidImage(600, 400)
      .withMetadata({
        exif: { IFD0: { Copyright: "Somebody", Software: "a phone" } },
        orientation: 1,
      })
      .jpeg()
      .toBuffer();

    expect((await sharp(source).metadata()).exif).toBeDefined();

    const { result, storage } = await run(source);
    const stored = storage.objects.get(result.original.key)!.body;
    const metadata = await sharp(stored).metadata();

    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();

    // Variants must be clean too — they are the objects actually served.
    for (const variant of result.variants) {
      const variantMeta = await sharp(storage.objects.get(variant.key)!.body).metadata();
      expect(variantMeta.exif, variant.key).toBeUndefined();
    }
  }, 30_000);

  it("applies the orientation tag rather than preserving it", async () => {
    // Orientation 6 means "rotate 90 degrees", so the displayed image is the
    // transpose of the stored 600x400 pixels.
    const source = await solidImage(600, 400)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const { result, storage } = await run(source);

    expect(result.width).toBe(400);
    expect(result.height).toBe(600);

    const stored = await sharp(storage.objects.get(result.original.key)!.body).metadata();
    expect(stored.width).toBe(400);
    expect(stored.height).toBe(600);
    expect(stored.orientation).toBeUndefined();
  }, 30_000);

  it("rejects anything that is not a raster image", async () => {
    const notAnImage = Buffer.from("<?php echo 'pwned'; ?>\n".repeat(64));
    await expect(run(notAnImage)).rejects.toThrow(/could not be decoded as an image/i);

    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await expect(run(svg)).rejects.toThrow(/raster image/i);
  });

  it("enforces maxBytes", async () => {
    const source = await jpeg(400, 300);

    await expect(run(source, { maxBytes: 10 })).rejects.toThrow(/exceeds the 10 byte limit/);
    await expect(run(source, { maxBytes: source.byteLength })).resolves.toBeDefined();
  }, 30_000);

  it("rejects a decompression bomb on its pixel count before decoding it", async () => {
    // 7100 x 7100 is 50.41 megapixels — just over the ceiling — and as a solid
    // colour it is under 300 KB, so it sails through the byte limit. That gap
    // is the point: byte size says nothing about what a decoder allocates.
    const bomb = await jpeg(7100, 7100);
    expect(7100 * 7100).toBeGreaterThan(MAX_INPUT_PIXELS);
    expect(bomb.byteLength).toBeLessThan(1024 * 1024);

    const storage = fakeStorage();
    await expect(run(bomb, { storage })).rejects.toThrow(/exceeds the 50000000 pixel limit/);
    expect(storage.objects.size).toBe(0);
  }, 30_000);

  it("lets a caller lower the pixel ceiling but never raise it", async () => {
    const source = await jpeg(400, 300);

    await expect(run(source, { maxPixels: 1000 })).rejects.toThrow(
      /400x300 \(120000 pixels\), which exceeds the 1000 pixel limit/,
    );
    await expect(run(source, { maxPixels: 400 * 300 })).resolves.toBeDefined();

    // The constant is the ceiling, whatever the caller asks for.
    expect(MAX_INPUT_PIXELS).toBe(50_000_000);
    const bomb = await jpeg(7100, 7100);
    await expect(run(bomb, { maxPixels: Number.MAX_SAFE_INTEGER })).rejects.toThrow(
      /exceeds the 50000000 pixel limit/,
    );
  }, 30_000);

  it("returns a blurhash that decodes and a dominant colour", async () => {
    const { result } = await run(await jpeg(400, 300));

    expect(result.blurhash).toBeTruthy();
    expect(typeof result.blurhash).toBe("string");
    expect(result.blurhash!.length).toBeGreaterThan(6);

    const pixels = decodeBlurhash(result.blurhash!, 32, 32);
    expect(pixels).toHaveLength(32 * 32 * 4);

    expect(result.dominantColor).toMatch(/^#[0-9a-f]{6}$/);
  }, 30_000);

  it("checksums the uploaded bytes, not the re-encoded original", async () => {
    const source = await jpeg(400, 300);
    const { result, storage } = await run(source);

    expect(result.checksumSha256).toBe(checksumOf(source));
    expect(result.bytes).toBe(storage.objects.get(result.original.key)!.body.byteLength);
  }, 30_000);
});
