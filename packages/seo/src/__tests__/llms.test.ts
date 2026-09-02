import { describe, expect, it } from "vitest";
import { buildLlmsFullTxt, buildLlmsTxt, streamLlmsFullTxt } from "../index";
import { doc, draftish, site } from "./fixtures";

describe("buildLlmsTxt", () => {
  it("matches the golden file", () => {
    expect(buildLlmsTxt([doc, draftish], site)).toBe(
      [
        "# Spendtab",
        "",
        "> Spendtab is spend management for finance teams.",
        "",
        "## Blog",
        "",
        "### Finance Ops",
        "",
        "- [How to write an expense policy](https://spendtab.com/blog/expense-policies): A short guide to writing a policy people actually follow.",
        "",
        "### Other",
        "",
        "- [Receipts, briefly](https://spendtab.com/blog/receipts)",
        "",
      ].join("\n"),
    );
  });

  it("keeps the caller's ordering inside each group", () => {
    const second = { ...doc, slug: "second", title: "Second" };
    const txt = buildLlmsTxt([doc, second], site);
    expect(txt.indexOf("expense-policies")).toBeLessThan(txt.indexOf("/blog/second"));
    expect(txt.match(/^### /gm)).toHaveLength(1);
  });

  it("uses the consuming origin for every link", () => {
    const txt = buildLlmsTxt([doc], site);
    expect(txt).not.toContain("cms.");
    expect(txt.match(/\]\((https?:\/\/[^)]+)\)/)?.[1]).toBe(
      "https://spendtab.com/blog/expense-policies",
    );
  });
});

describe("buildLlmsFullTxt", () => {
  it("gives each document frontmatter and its markdown", () => {
    const txt = buildLlmsFullTxt([doc], site);

    expect(txt.startsWith("# Spendtab\n\n> Spendtab is spend management for finance teams.\n\n")).toBe(
      true,
    );
    expect(txt).toContain('title: "How to write an expense policy"');
    expect(txt).toContain('url: "https://spendtab.com/blog/expense-policies"');
    expect(txt).toContain('date: "2025-03-04T09:00:00.000Z"');
    expect(txt).toContain('authors: ["Jane Doe"]');
    expect(txt).toContain('tags: ["Policy", "Controls"]');
    expect(txt).toContain("## How do I write an expense policy?");
  });

  it("separates documents with the frontmatter fence", () => {
    const txt = buildLlmsFullTxt([doc, draftish], site);
    expect(txt.match(/^---$/gm)).toHaveLength(4);
    expect(txt.indexOf("expense-policies")).toBeLessThan(txt.indexOf("receipts"));
  });

  it("quotes a title that would otherwise break the frontmatter", () => {
    const txt = buildLlmsFullTxt([{ ...doc, title: 'Policies: "quoted" & odd' }], site);
    expect(txt).toContain('title: "Policies: \\"quoted\\" & odd"');
  });
});

describe("streamLlmsFullTxt", () => {
  it("yields exactly the bytes of the non-streaming version", async () => {
    const docs = [doc, draftish, { ...doc, slug: "third", title: "Third" }];

    const chunks: string[] = [];
    for await (const chunk of streamLlmsFullTxt(docs, site)) chunks.push(chunk);

    expect(chunks.join("")).toBe(buildLlmsFullTxt(docs, site));
    // One chunk for the header, one per document — the point of streaming.
    expect(chunks).toHaveLength(docs.length + 1);
  });

  it("streams the header even when there is nothing published yet", async () => {
    const chunks: string[] = [];
    for await (const chunk of streamLlmsFullTxt([], site)) chunks.push(chunk);
    expect(chunks.join("")).toBe(buildLlmsFullTxt([], site));
  });
});
