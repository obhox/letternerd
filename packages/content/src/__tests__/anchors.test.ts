import { describe, expect, it } from "vitest";
import {
  HEADING_MATCH_THRESHOLD,
  levenshtein,
  reconcileHeadings,
  renderDocument,
  similarity,
  type HeadingEntry,
} from "../index";
import { site } from "./fixtures";

const entry = (over: Partial<HeadingEntry> & Pick<HeadingEntry, "text" | "id">): HeadingEntry => ({
  depth: 2,
  aliases: [],
  ...over,
});

describe("similarity", () => {
  it("measures edit distance", () => {
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });

  it("ignores case and punctuation", () => {
    expect(similarity("Pricing FAQ", "pricing faq!")).toBe(1);
  });

  it("scores a word inserted into a heading above the threshold", () => {
    expect(similarity("Getting started", "Getting started with billing")).toBeGreaterThanOrEqual(
      HEADING_MATCH_THRESHOLD,
    );
  });

  it("scores two unrelated headings below the threshold", () => {
    expect(similarity("Refund policy", "Shipping estimates")).toBeLessThan(
      HEADING_MATCH_THRESHOLD,
    );
    expect(similarity("How refunds work", "How shipping is priced")).toBeLessThan(
      HEADING_MATCH_THRESHOLD,
    );
  });
});

describe("reconcileHeadings", () => {
  it("mints computed slugs on a first render", () => {
    const result = reconcileHeadings([{ depth: 2, text: "Overview", slug: "overview" }]);
    expect(result).toEqual([{ depth: 2, text: "Overview", id: "overview", aliases: [] }]);
  });

  it("keeps the published id and demotes the new slug to an alias", () => {
    const result = reconcileHeadings(
      [{ depth: 2, text: "How refunds work in practice", slug: "how-refunds-work-in-practice" }],
      [entry({ text: "How refunds work", id: "how-refunds-work" })],
    );

    expect(result[0]?.id).toBe("how-refunds-work");
    expect(result[0]?.aliases).toEqual(["how-refunds-work-in-practice"]);
  });

  it("refuses to match a heading that was replaced rather than edited", () => {
    const result = reconcileHeadings(
      [{ depth: 2, text: "Shipping estimates", slug: "shipping-estimates" }],
      [entry({ text: "Refund policy", id: "refund-policy" })],
    );

    expect(result[0]?.id).toBe("shipping-estimates");
    expect(result[0]?.aliases).toEqual([]);
  });

  it("carries older aliases forward so every past citation still resolves", () => {
    const result = reconcileHeadings(
      [{ depth: 2, text: "How refunds work now", slug: "how-refunds-work-now" }],
      [entry({ text: "How refunds work", id: "how-refunds-work", aliases: ["refunds"] })],
    );

    expect(result[0]?.id).toBe("how-refunds-work");
    expect(result[0]?.aliases).toEqual(["refunds", "how-refunds-work-now"]);
  });

  it("matches unchanged text however far it has moved", () => {
    const result = reconcileHeadings(
      [
        { depth: 2, text: "New intro", slug: "new-intro" },
        { depth: 2, text: "A", slug: "a" },
        { depth: 2, text: "B", slug: "b" },
        { depth: 2, text: "C", slug: "c" },
        { depth: 2, text: "D", slug: "d" },
        { depth: 2, text: "Refund policy", slug: "refund-policy" },
      ],
      [entry({ text: "Refund policy", id: "refunds" })],
    );

    expect(result[5]?.id).toBe("refunds");
  });

  it("never emits the same id twice", () => {
    const result = reconcileHeadings(
      [
        { depth: 2, text: "Pricing", slug: "pricing" },
        { depth: 2, text: "Pricing", slug: "pricing-1" },
      ],
      [entry({ text: "Pricing", id: "pricing" }), entry({ text: "Pricing", id: "pricing" })],
    );

    expect(new Set(result.map((heading) => heading.id)).size).toBe(2);
  });
});

describe("anchor stability end to end", () => {
  const first = [
    "## Getting started",
    "",
    "Intro prose.",
    "",
    "## How refunds work",
    "",
    "Refunds take five days.",
  ].join("\n");

  // The heading *above* the target is renamed. Nothing about "How refunds work"
  // changed, so nothing about its anchor may change either.
  const second = [
    "## Getting started with billing",
    "",
    "Intro prose.",
    "",
    "## How refunds work",
    "",
    "Refunds take five days.",
  ].join("\n");

  it("leaves a following heading's id untouched when a preceding one is renamed", async () => {
    const before = await renderDocument({ markdown: first, slug: "refunds", site });
    expect(before.headings.map((heading) => heading.id)).toEqual([
      "getting-started",
      "how-refunds-work",
    ]);

    const after = await renderDocument({
      markdown: second,
      slug: "refunds",
      site,
      existingHeadings: before.headings,
    });

    const target = after.headings[1];
    expect(target?.text).toBe("How refunds work");
    expect(target?.id).toBe("how-refunds-work");
    expect(target?.aliases).toEqual([]);
    expect(after.html).toContain('id="how-refunds-work"');
  });

  it("keeps the renamed heading's own id and records the new slug as an alias", async () => {
    const before = await renderDocument({ markdown: first, slug: "refunds", site });
    const after = await renderDocument({
      markdown: second,
      slug: "refunds",
      site,
      existingHeadings: before.headings,
    });

    const renamed = after.headings[0];
    expect(renamed?.id).toBe("getting-started");
    expect(renamed?.aliases).toEqual(["getting-started-with-billing"]);
    expect(after.html).toContain(
      '<span id="getting-started-with-billing" class="cms-anchor-alias" aria-hidden="true"></span>',
    );
    // The live id is what the heading answers to and what the copy-link points at.
    expect(after.html).toContain('id="getting-started"');
    expect(after.html).toContain('href="#getting-started"');
  });

  it("accumulates aliases across successive renames", async () => {
    const one = await renderDocument({ markdown: first, slug: "refunds", site });
    const two = await renderDocument({
      markdown: second,
      slug: "refunds",
      site,
      existingHeadings: one.headings,
    });
    const three = await renderDocument({
      markdown: second.replace("## Getting started with billing", "## Getting started with cards"),
      slug: "refunds",
      site,
      existingHeadings: two.headings,
    });

    expect(three.headings[0]?.id).toBe("getting-started");
    expect(three.headings[0]?.aliases).toEqual([
      "getting-started-with-billing",
      "getting-started-with-cards",
    ]);
  });

  it("freezes FAQ question anchors the same way", async () => {
    const faq = (question: string) =>
      [":::faq", `### ${question}`, "", "It takes five days.", ":::"].join("\n");

    const before = await renderDocument({
      markdown: faq("How long do refunds take?"),
      slug: "refunds",
      site,
    });
    const anchorId = before.qaBlocks[0]?.anchorId;
    expect(anchorId).toBe("how-long-do-refunds-take");

    const after = await renderDocument({
      markdown: faq("How long does a refund take?"),
      slug: "refunds",
      site,
      existingHeadings: before.headings,
    });

    expect(after.qaBlocks[0]?.anchorId).toBe(anchorId);
    expect(after.headings[0]?.aliases).toEqual(["how-long-does-a-refund-take"]);
  });
});
