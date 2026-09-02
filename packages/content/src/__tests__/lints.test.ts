import { describe, expect, it } from "vitest";
import {
  BLOCKING_RULES,
  hasBlockingFindings,
  renderDocument,
  type LintFinding,
} from "../index";
import { articleInput, resolveMedia, site } from "./fixtures";

const render = (markdown: string, over: Parameters<typeof renderDocument>[0] | object = {}) =>
  renderDocument({ markdown, slug: "post", site, ...over });

const rules = (findings: readonly LintFinding[]) => findings.map((finding) => finding.rule);

describe("the publish gate", () => {
  it("has one definition of blocked, shared by every caller", () => {
    expect([...BLOCKING_RULES].sort()).toEqual([
      "faq-answer-in-body",
      "image-alt-required",
      "unresolved-media-ref",
    ]);
  });

  it("treats warnings from a blocking rule as advisory", () => {
    expect(hasBlockingFindings([{ rule: "image-alt-required", severity: "warning", message: "" }]))
      .toBe(false);
    expect(hasBlockingFindings([{ rule: "image-alt-required", severity: "error", message: "" }]))
      .toBe(true);
    expect(hasBlockingFindings([{ rule: "readability", severity: "error", message: "" }])).toBe(
      false,
    );
  });

  it("passes a well-formed document", async () => {
    const result = await renderDocument(articleInput());

    expect(hasBlockingFindings(result.lints)).toBe(false);
  });
});

describe("image-alt-required", () => {
  it("blocks an image with no alt text", async () => {
    const result = await render("![](https://example.com/chart.png)");

    const finding = result.lints.find((lint) => lint.rule === "image-alt-required");
    expect(finding?.severity).toBe("error");
    expect(finding?.line).toBe(1);
    expect(hasBlockingFindings(result.lints)).toBe(true);
  });

  it("accepts alt text carried by the asset itself", async () => {
    const result = await render("![](media://asset-chart)", { resolveMedia });

    expect(rules(result.lints)).not.toContain("image-alt-required");
    expect(result.html).toContain('alt="Monthly recurring revenue climbing through the year"');
  });

  it("blocks when neither the document nor the asset supplies one", async () => {
    const result = await render("![](media://asset-logo)", { resolveMedia });

    expect(rules(result.lints)).toContain("image-alt-required");
    expect(hasBlockingFindings(result.lints)).toBe(true);
  });
});

describe("unresolved-media-ref", () => {
  it("lints rather than throwing, and blocks the publish", async () => {
    const result = await render("![A chart](media://missing-asset)", {
      resolveMedia: () => undefined,
    });

    const finding = result.lints.find((lint) => lint.rule === "unresolved-media-ref");
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("media://missing-asset");
    expect(hasBlockingFindings(result.lints)).toBe(true);
  });

  it("lints when no resolver was injected at all", async () => {
    const result = await render("![A chart](media://asset-chart)");

    expect(rules(result.lints)).toContain("unresolved-media-ref");
    // The dangling protocol never reaches the rendered `src`.
    expect(result.html).not.toContain('src="media://');
  });
});

describe("faq-answer-in-body", () => {
  it("blocks a question whose answer is not visible on the page", async () => {
    // The answer is written as raw HTML, which never survives to the page —
    // exactly the case where the JSON-LD would promise text no reader sees.
    const result = await render(
      [":::faq", "### Do you offer refunds?", "", "<p>Yes, within 30 days.</p>", ":::"].join("\n"),
    );

    const finding = result.lints.find((lint) => lint.rule === "faq-answer-in-body");
    expect(finding?.severity).toBe("error");
    expect(hasBlockingFindings(result.lints)).toBe(true);
  });

  it("blocks a question with no answer at all", async () => {
    const result = await render(
      [":::faq", "### Do you offer refunds?", "", "### And exchanges?", "", "Yes.", ":::"].join(
        "\n",
      ),
    );

    const finding = result.lints.find((lint) => lint.rule === "faq-answer-in-body");
    expect(finding?.message).toContain("Do you offer refunds?");
    expect(hasBlockingFindings(result.lints)).toBe(true);
  });

  it("passes when the answer is ordinary visible prose", async () => {
    const result = await renderDocument(articleInput());

    expect(rules(result.lints)).not.toContain("faq-answer-in-body");
  });
});

describe("heading-hierarchy", () => {
  it("flags an H1 in the body, because the title is the page's only H1", async () => {
    const result = await render("# A second title\n\nProse.");

    const finding = result.lints.find((lint) => lint.rule === "heading-hierarchy");
    expect(finding?.severity).toBe("warning");
    expect(finding?.message).toContain("H1");
  });

  it("flags a skipped level", async () => {
    const result = await render("## Section\n\nProse.\n\n#### Too deep\n\nMore prose.");

    expect(
      result.lints.some((lint) => lint.message.includes("jumps from H2 to H4")),
    ).toBe(true);
  });

  it("ignores headings inside a directive, which this pipeline generates", async () => {
    const result = await render(
      [":::faq", "### A question?", "", "An answer.", ":::"].join("\n"),
    );

    expect(rules(result.lints)).not.toContain("heading-hierarchy");
  });
});

describe("metadata lengths", () => {
  it("says nothing when there is no frontmatter to judge", async () => {
    const result = await render("## Section\n\nProse.");

    expect(rules(result.lints)).not.toContain("title-length");
    expect(rules(result.lints)).not.toContain("meta-description-length");
  });

  it("flags a short title and a short description", async () => {
    const result = await render("Prose.", {
      publicFrontmatter: { title: "Short", description: "Also short." },
    });

    expect(rules(result.lints)).toContain("title-length");
    expect(rules(result.lints)).toContain("meta-description-length");
  });

  it("flags an over-long description", async () => {
    const result = await render("Prose.", {
      publicFrontmatter: {
        title: "A title of a perfectly reasonable length for search",
        description: "x".repeat(200),
      },
    });

    expect(rules(result.lints)).toContain("meta-description-length");
    expect(rules(result.lints)).not.toContain("title-length");
  });

  it("accepts lengths inside both budgets", async () => {
    const result = await renderDocument(articleInput());

    expect(rules(result.lints)).not.toContain("title-length");
    expect(rules(result.lints)).not.toContain("meta-description-length");
  });
});

describe("thin-content", () => {
  it("warns on a stub", async () => {
    const result = await render("Two words.");

    const finding = result.lints.find((lint) => lint.rule === "thin-content");
    expect(finding?.severity).toBe("warning");
    expect(hasBlockingFindings(result.lints)).toBe(false);
  });
});

describe("readability", () => {
  it("warns when sentences run long", async () => {
    const sentence = `${Array.from({ length: 45 }, () => "consequently").join(" ")}.`;
    const result = await render([sentence, sentence].join(" "));

    expect(rules(result.lints)).toContain("readability");
  });

  it("ignores code blocks, which score as unreadable by construction", async () => {
    const prose = "Set the code once. It never changes. Finance can then reconcile the month.";
    const withCode = [prose, "", "```ts", "const a=1;const b=2;const c=a+b;", "```"].join("\n");

    const plain = await render(prose);
    const coded = await render(withCode);

    expect(rules(plain.lints).filter((rule) => rule === "readability")).toEqual(
      rules(coded.lints).filter((rule) => rule === "readability"),
    );
  });
});

describe("finding order", () => {
  it("is deterministic, so a diff of two lint runs means something", async () => {
    const markdown = [
      "# Body H1",
      "",
      "![](https://example.com/a.png)",
      "",
      "#### Skipped",
      "",
      "![](https://example.com/b.png)",
    ].join("\n");

    const first = await render(markdown);
    const second = await render(markdown);

    expect(first.lints).toEqual(second.lints);
    const lines = first.lints
      .map((lint) => lint.line)
      .filter((line): line is number => line !== undefined);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
  });
});
