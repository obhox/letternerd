import { describe, expect, it } from "vitest";
import type { SitemapEntry } from "../index.js";
import {
  SITEMAP_CHUNK_SIZE,
  buildSitemap,
  buildSitemapIndex,
  chunkSitemapEntries,
  documentSitemapEntries,
} from "../index.js";
import { doc, draftish, site } from "./fixtures.js";

describe("buildSitemap", () => {
  it("writes every URL on the consuming origin", () => {
    const xml = buildSitemap(
      [
        { path: "/", changeFrequency: "daily", priority: 1 },
        { path: "/blog/expense-policies", dateModified: "2025-06-01T12:30:00.000Z" },
      ],
      site,
    );

    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <url>",
        "    <loc>https://spendtab.com</loc>",
        "    <changefreq>daily</changefreq>",
        "    <priority>1.0</priority>",
        "  </url>",
        "  <url>",
        "    <loc>https://spendtab.com/blog/expense-policies</loc>",
        "    <lastmod>2025-06-01T12:30:00.000Z</lastmod>",
        "  </url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
    expect(xml).not.toContain("cms.");
  });

  it("XML-escapes the location", () => {
    const xml = buildSitemap([{ path: "/search?q=a&b=1<2" }], site);
    expect(xml).toContain("<loc>https://spendtab.com/search?q=a&amp;b=1&lt;2</loc>");
    expect(xml.match(/&(?!amp;|lt;|gt;|quot;|apos;)/)).toBeNull();
  });

  it("drops a noindex entry", () => {
    const xml = buildSitemap([{ path: "/blog/a" }, { path: "/blog/b", noindex: true }], site);
    expect(xml).toContain("/blog/a");
    expect(xml).not.toContain("/blog/b");
  });

  it("takes lastmod from dateModified, falling back to the publication date", () => {
    const entries = documentSitemapEntries([doc, draftish], site);
    expect(entries).toEqual([
      { path: "/blog/expense-policies", dateModified: "2025-06-01T12:30:00.000Z" },
      { path: "/blog/receipts", dateModified: "2025-01-02T00:00:00.000Z" },
    ]);
  });

  it("excludes noindex and syndicated documents", () => {
    const entries = documentSitemapEntries(
      [
        { ...doc, noindex: true },
        { ...draftish, canonicalUrlOverride: "https://partner.example/receipts" },
      ],
      site,
    );
    expect(entries).toEqual([]);
  });
});

describe("chunkSitemapEntries", () => {
  const entry = (index: number): SitemapEntry => ({ path: `/blog/post-${index}` });

  it("does not split at exactly the limit", () => {
    const entries = Array.from({ length: SITEMAP_CHUNK_SIZE }, (_, index) => entry(index));
    const chunks = chunkSitemapEntries(entries);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(45_000);
  });

  it("splits one past it", () => {
    const entries = Array.from({ length: SITEMAP_CHUNK_SIZE + 1 }, (_, index) => entry(index));
    const chunks = chunkSitemapEntries(entries);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(45_000);
    expect(chunks[1]).toHaveLength(1);
    expect(chunks[1]?.[0]).toEqual({ path: "/blog/post-45000" });
  });

  it("returns nothing for nothing, and refuses a nonsense size", () => {
    expect(chunkSitemapEntries([])).toEqual([]);
    expect(() => chunkSitemapEntries([entry(0)], 0)).toThrow(RangeError);
  });
});

describe("buildSitemapIndex", () => {
  it("points at chunk files on the consuming origin", () => {
    expect(
      buildSitemapIndex(
        ["/sitemaps/posts-1.xml", { path: "/sitemaps/posts-2.xml", dateModified: "2025-06-01" }],
        site,
      ),
    ).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "  <sitemap>",
        "    <loc>https://spendtab.com/sitemaps/posts-1.xml</loc>",
        "  </sitemap>",
        "  <sitemap>",
        "    <loc>https://spendtab.com/sitemaps/posts-2.xml</loc>",
        "    <lastmod>2025-06-01T00:00:00.000Z</lastmod>",
        "  </sitemap>",
        "</sitemapindex>",
        "",
      ].join("\n"),
    );
  });
});
