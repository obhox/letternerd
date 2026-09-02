import type { Root } from "hast";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { contentSanitizeSchema, renderDocument } from "../index";
import { articleInput, site } from "./fixtures";

const render = (markdown: string) => renderDocument({ markdown, slug: "post", site });

/** Sanitise a hand-built tree, so the schema is tested rather than the parser. */
async function sanitize(tree: Root): Promise<string> {
  const processor = unified().use(rehypeSanitize, contentSanitizeSchema).use(rehypeStringify);
  return String(processor.stringify(await processor.run(tree)));
}

describe("the sanitize schema", () => {
  it("removes scripts, event handlers and javascript: URLs", async () => {
    const html = await sanitize({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "div",
          properties: { className: ["cms-tldr"] },
          children: [
            {
              type: "element",
              tagName: "script",
              properties: {},
              children: [{ type: "text", value: "alert(1)" }],
            },
            {
              type: "element",
              tagName: "img",
              properties: { src: "x.png", alt: "x", onError: "alert(1)" },
              children: [],
            },
            {
              type: "element",
              tagName: "a",
              properties: { href: "javascript:alert(1)" },
              children: [{ type: "text", value: "click" }],
            },
          ],
        },
      ],
    });

    expect(html).not.toContain("script");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("javascript:");
    // `<script>` is dropped whole; the link survives with its href removed.
    expect(html).not.toContain("alert(1)");
    expect(html).toContain(">click</a>");
    expect(html).toContain('<img src="x.png" alt="x">');
  });

  it("keeps every class name this pipeline depends on", async () => {
    const classes = [
      "cms-tldr",
      "cms-takeaways",
      "cms-faq",
      "cms-faq__question",
      "cms-howto",
      "cms-howto__steps",
      "cms-figure",
      "cms-embed",
      "cms-anchor-alias",
    ];

    const html = await sanitize({
      type: "root",
      children: classes.map((name) => ({
        type: "element" as const,
        tagName: name.includes("takeaways") ? "ul" : name.includes("faq") ? "section" : "div",
        properties: { className: [name] },
        children: [],
      })),
    });

    for (const name of classes) expect(html).toContain(`class="${name}"`);
  });

  it("leaves ids exactly as written, because they are published URLs", async () => {
    const html = await sanitize({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: { id: "how-refunds-work" },
          children: [{ type: "text", value: "How refunds work" }],
        },
      ],
    });

    expect(html).toContain('id="how-refunds-work"');
    expect(html).not.toContain("user-content-");
  });

  it("keeps the data attributes the facade and the FAQ markers need", async () => {
    const html = await sanitize({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "div",
          properties: {
            "data-provider": "youtube",
            "data-embed-id": "abc",
            "data-cms-qa": "0",
            "data-step": "1",
            "data-unexpected": "no",
          },
          children: [],
        },
      ],
    });

    expect(html).toContain('data-provider="youtube"');
    expect(html).toContain('data-embed-id="abc"');
    expect(html).toContain('data-cms-qa="0"');
    expect(html).toContain('data-step="1"');
    expect(html).not.toContain("data-unexpected");
  });
});

describe("the rendered document", () => {
  it("never emits a script or an event handler from the source", async () => {
    const result = await render(
      [
        ":::tldr",
        "Safe summary.",
        ":::",
        "",
        "<script>alert(1)</script>",
        "",
        '<img src="x" onerror="alert(1)">',
        "",
        "[link](javascript:alert(1))",
      ].join("\n"),
    );

    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("onerror");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).toContain('<div class="cms-tldr">');
  });

  it("keeps Shiki's inline styles so highlighted code stays highlighted", async () => {
    const result = await render("```ts\nconst x = 1;\n```");

    expect(result.html).toContain("<pre");
    expect(result.html).toContain("style=");
    expect(result.html).toContain("--shiki-dark");
  });

  it("renders a code fence in an unknown language rather than failing", async () => {
    const result = await render("```notalanguage\nfoo bar\n```");

    expect(result.html).toContain("foo bar");
  });

  it("preserves the directive classes end to end", async () => {
    const { html } = await renderDocument(articleInput());

    expect(html).toContain('<div class="cms-tldr">');
    expect(html).toContain('<ul class="cms-takeaways">');
    expect(html).toContain('<section class="cms-faq">');
    expect(html).toContain('<section class="cms-howto">');
    expect(html).toContain('<figure class="cms-figure">');
    expect(html).toContain('<div class="cms-embed"');
  });
});
