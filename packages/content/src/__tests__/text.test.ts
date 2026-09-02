import { describe, expect, it } from "vitest";
import {
  analyseReadability,
  countWords,
  hastToText,
  readingTimeMinutes,
  renderDocument,
} from "../index";
import { articleInput, site } from "./fixtures";

describe("hastToText", () => {
  it("separates blocks, so two list items are never one sentence", () => {
    const text = hastToText({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "ul",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "li",
              properties: {},
              children: [{ type: "text", value: "One" }],
            },
            {
              type: "element",
              tagName: "li",
              properties: {},
              children: [{ type: "text", value: "Two" }],
            },
          ],
        },
      ],
    });

    expect(text).toBe("One\n\nTwo");
  });

  it("drops the tags it is told to skip, contents included", () => {
    const tree = {
      type: "root" as const,
      children: [
        {
          type: "element" as const,
          tagName: "pre",
          properties: {},
          children: [{ type: "text" as const, value: "const x = 1;" }],
        },
        {
          type: "element" as const,
          tagName: "p",
          properties: {},
          children: [{ type: "text" as const, value: "Prose." }],
        },
      ],
    };

    expect(hastToText(tree)).toContain("const x = 1;");
    expect(hastToText(tree, { skip: new Set(["pre"]) })).toBe("Prose.");
  });
});

describe("counting", () => {
  it("counts hyphenated and apostrophised words once", () => {
    expect(countWords("month-end doesn't count twice")).toBe(4);
    expect(countWords("")).toBe(0);
  });

  it("never reports a zero-minute read", () => {
    expect(readingTimeMinutes(0)).toBe(1);
    expect(readingTimeMinutes(225)).toBe(1);
    expect(readingTimeMinutes(1000)).toBe(4);
  });
});

describe("readability analysis", () => {
  it("scores plain prose higher than dense prose", () => {
    const plain = analyseReadability("The cat sat on the mat. It was a good mat.");
    const dense = analyseReadability(
      "Notwithstanding the aforementioned considerations, the organisational infrastructure necessitates comprehensive reconfiguration.",
    );

    expect(plain.fleschReadingEase).toBeGreaterThan(dense.fleschReadingEase);
  });

  it("finds the sentences that run long", () => {
    const long = `${Array.from({ length: 40 }, () => "word").join(" ")}.`;
    const analysis = analyseReadability(`Short one. ${long}`);

    expect(analysis.sentenceCount).toBe(2);
    expect(analysis.longSentences).toHaveLength(1);
  });

  it("returns a neutral result for an empty document", () => {
    expect(analyseReadability("")).toEqual({
      fleschReadingEase: 100,
      sentenceCount: 0,
      wordCount: 0,
      longSentences: [],
    });
  });
});

describe("the rendered text", () => {
  it("is the visible page, not the source", async () => {
    const result = await renderDocument(articleInput());

    expect(result.text).not.toContain(":::");
    expect(result.text).not.toContain("media://");
    expect(result.text).not.toContain("internalNote");
    expect(result.text).toContain("Teams invent categories faster than finance can reconcile");
    // The figure's caption is on the page, so it is in the text.
    expect(result.text).toContain("MRR, January to December.");
  });

  it("keeps every FAQ answer, which is what the FAQ lint checks against", async () => {
    const result = await renderDocument(articleInput());

    for (const block of result.qaBlocks) {
      expect(result.text).toContain(block.question);
    }
  });

  it("collapses runs of blank lines", async () => {
    const result = await renderDocument({
      markdown: "One.\n\n\n\nTwo.",
      slug: "spacing",
      site,
    });

    expect(result.text).toBe("One.\n\nTwo.");
  });
});
