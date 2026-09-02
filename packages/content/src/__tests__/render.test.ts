import { describe, expect, it } from "vitest";
import { PIPELINE_VERSION, contentHash, renderDocument } from "../index";
import { ARTICLE, articleInput, site } from "./fixtures";

describe("renderDocument", () => {
  it("produces byte-identical output on repeated runs", async () => {
    const first = await renderDocument(articleInput());
    const second = await renderDocument(articleInput());

    expect(second.html).toBe(first.html);
    expect(second.text).toBe(first.text);
    expect(second.mdPublic).toBe(first.mdPublic);
    expect(second.headings).toEqual(first.headings);
    expect(second.qaBlocks).toEqual(first.qaBlocks);
    expect(second.lints).toEqual(first.lints);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it("matches the recorded output", async () => {
    const result = await renderDocument(articleInput());

    expect(result.html).toMatchSnapshot("html");
    expect(result.text).toMatchSnapshot("text");
    expect(result.mdPublic).toMatchSnapshot("mdPublic");
    expect(result.headings).toMatchSnapshot("headings");
  });

  it("hashes the source together with the pipeline version", async () => {
    const result = await renderDocument(articleInput());

    expect(result.contentHash).toBe(contentHash(ARTICLE));
    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash(ARTICLE)).not.toBe(contentHash(`${ARTICLE} `));
    expect(PIPELINE_VERSION).toBeGreaterThan(0);
  });

  it("counts words and reading time from the visible text", async () => {
    const result = await renderDocument(articleInput());

    expect(result.wordCount).toBeGreaterThan(150);
    expect(result.readingTimeMinutes).toBeGreaterThanOrEqual(1);
  });

  it("never emits raw HTML from the source", async () => {
    const result = await renderDocument({
      markdown: "Before\n\n<div data-evil>raw</div>\n\nAfter",
      slug: "raw",
      site,
    });

    expect(result.html).not.toContain("data-evil");
    expect(result.html).toContain("Before");
    expect(result.html).toContain("After");
  });

  it("renders an empty document without throwing", async () => {
    const result = await renderDocument({ markdown: "", slug: "empty", site });

    expect(result.html).toBe("");
    expect(result.text).toBe("");
    expect(result.headings).toEqual([]);
    expect(result.qaBlocks).toEqual([]);
    expect(result.tldr).toBeNull();
    expect(result.wordCount).toBe(0);
    expect(result.readingTimeMinutes).toBe(1);
  });

  describe("mdPublic", () => {
    it("is clean markdown: no directives and no media refs", async () => {
      const result = await renderDocument(articleInput());

      expect(result.mdPublic).not.toContain("media://");
      expect(result.mdPublic).not.toContain(":::");
      expect(result.mdPublic).not.toContain("::step");
      expect(result.mdPublic).not.toContain("::embed");
    });

    it("flattens each directive into an ordinary section", async () => {
      const { mdPublic } = await renderDocument(articleInput());

      expect(mdPublic).toContain("## TL;DR");
      expect(mdPublic).toContain("## Key takeaways");
      expect(mdPublic).toContain("## FAQ");
      expect(mdPublic).toContain("### Can I rename a category later?");
      expect(mdPublic).toContain("## Set up your first category");
      expect(mdPublic).toMatch(/1\. Open Settings, then Categories\./);
    });

    it("absolutises every relative URL against the document's own address", async () => {
      const { mdPublic } = await renderDocument(articleInput());

      expect(mdPublic).toContain("https://spendtab.com/pricing");
      expect(mdPublic).toContain("https://spendtab.com/blog/chart-of-accounts");
      expect(mdPublic).toContain("https://cdn.spendtab.com/asset-chart/1600.webp");
    });

    it("prepends the curated frontmatter and drops the source's own", async () => {
      const { mdPublic } = await renderDocument(articleInput());

      expect(mdPublic.startsWith("---\n")).toBe(true);
      expect(mdPublic).toMatch(/canonical: .?https:\/\/spendtab\.com\/blog\/expense-categories/);
      expect(mdPublic).not.toContain("internalNote");
    });

    it("omits frontmatter entirely when none is supplied", async () => {
      const { mdPublic } = await renderDocument({
        markdown: "## Heading\n\nBody.",
        slug: "plain",
        site,
      });

      expect(mdPublic.startsWith("---")).toBe(false);
      expect(mdPublic).toBe("## Heading\n\nBody.");
    });
  });
});
