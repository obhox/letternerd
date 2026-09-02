import { describe, expect, it } from "vitest";

import { DEFAULT_SIZES, buildPictureSources, buildSrcset } from "../index.js";

const publicUrl = (key: string) => `https://cdn.test/${key}`;

// Deliberately out of order: the builders must sort, not trust their input.
const variants = [
  { key: "a/640.webp", width: 640, format: "webp" },
  { key: "a/320.avif", width: 320, format: "avif" },
  { key: "a/700.jpeg", width: 700, format: "jpeg" },
  { key: "a/640.avif", width: 640, format: "avif" },
  { key: "a/320.webp", width: 320, format: "webp" },
];

describe("buildSrcset", () => {
  it("emits ascending 'url widthw' pairs for one format", () => {
    expect(buildSrcset(variants, "avif", publicUrl)).toBe(
      "https://cdn.test/a/320.avif 320w, https://cdn.test/a/640.avif 640w",
    );
  });

  it("is empty when no variant has the format", () => {
    expect(buildSrcset(variants, "png", publicUrl)).toBe("");
  });

  it("keeps one candidate per width", () => {
    const duplicated = [...variants, { key: "a/320.dupe.avif", width: 320, format: "avif" }];
    expect(buildSrcset(duplicated, "avif", publicUrl).split(", ")).toHaveLength(2);
  });
});

describe("buildPictureSources", () => {
  it("orders avif, then webp, then the raster fallback", () => {
    const sources = buildPictureSources(variants, publicUrl);

    expect(sources.map((s) => s.type)).toEqual(["image/avif", "image/webp", "image/jpeg"]);
    expect(sources[0]!.srcset).toBe(
      "https://cdn.test/a/320.avif 320w, https://cdn.test/a/640.avif 640w",
    );
    expect(sources[2]!.srcset).toBe("https://cdn.test/a/700.jpeg 700w");
  });

  it("omits formats with no variants", () => {
    const avifOnly = variants.filter((v) => v.format === "avif");
    expect(buildPictureSources(avifOnly, publicUrl).map((s) => s.type)).toEqual(["image/avif"]);
  });

  it("puts png in the fallback slot when alpha forced it", () => {
    const withAlpha = [
      { key: "a/320.avif", width: 320, format: "avif" },
      { key: "a/400.png", width: 400, format: "png" },
    ];
    expect(buildPictureSources(withAlpha, publicUrl).map((s) => s.type)).toEqual([
      "image/avif",
      "image/png",
    ]);
  });
});

describe("DEFAULT_SIZES", () => {
  it("caps the article column so a wide viewport does not fetch the 1920", () => {
    expect(DEFAULT_SIZES).toBe("(max-width: 720px) 100vw, 720px");
  });
});
