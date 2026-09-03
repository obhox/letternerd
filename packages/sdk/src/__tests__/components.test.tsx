import { describe, expect, it } from "vitest";
import { blogPostingLd } from "@cms/seo";
import { CmsImage, JsonLd, PostBody } from "../next";
import { toSeoDocument } from "../adapt";
import { post, site } from "./fixtures";

/**
 * Asserted on the elements themselves rather than on rendered HTML: these are
 * server components with no behaviour, and what matters is exactly the props
 * they hand to the DOM — the escaped JSON-LD, the untouched body HTML, and the
 * format order of the `<source>` list.
 */

interface Element {
  type: unknown;
  props: Record<string, unknown>;
}

describe("<JsonLd>", () => {
  it("escapes a closing tag so a title cannot end the script element", () => {
    const element = JsonLd({
      data: { "@type": "BlogPosting", headline: "</script><img onerror=alert(1)>" },
    }) as unknown as Element;

    const html = (element.props.dangerouslySetInnerHTML as { __html: string }).__html;

    expect(element.type).toBe("script");
    expect(element.props.type).toBe("application/ld+json");
    expect(html).not.toContain("</script");
    expect(html).toContain("\\u003c");
    // Still valid JSON that parses back to the original string.
    expect((JSON.parse(html) as { headline: string }).headline).toBe(
      "</script><img onerror=alert(1)>",
    );
  });

  it("serialises several nodes as one array, dropping the nulls", () => {
    const element = JsonLd({
      data: [blogPostingLd(toSeoDocument(post()), site), null, undefined],
    }) as unknown as Element;

    const parsed = JSON.parse(
      (element.props.dangerouslySetInnerHTML as { __html: string }).__html,
    ) as { "@type": string };

    expect(parsed["@type"]).toBe("BlogPosting");
  });
});

describe("<PostBody>", () => {
  it("renders the CMS's sanitised HTML unchanged, classes and all", () => {
    const element = PostBody({ post: post() }) as unknown as Element;
    const html = (element.props.dangerouslySetInnerHTML as { __html: string }).__html;

    // The `cms-*` classes are what the article styles are written against, and
    // a client-side re-sanitise is exactly what would strip them.
    expect(html).toContain('class="cms-tldr"');
    expect(html).toBe(post().bodyHtml);
    expect(element.props.className).toBe("cms-body");
  });

  it("renders an empty body rather than throwing on a post with no HTML", () => {
    const element = PostBody({ post: { bodyHtml: null } }) as unknown as Element;

    expect((element.props.dangerouslySetInnerHTML as { __html: string }).__html).toBe("");
  });
});

describe("<CmsImage>", () => {
  const media = {
    url: "https://cdn.example.com/cover.jpg",
    alt: "A ledger",
    width: 1600,
    height: 900,
    variants: [
      { key: "a/640.webp", width: 640, format: "webp", url: "https://cdn.example.com/640.webp" },
      { key: "a/1280.webp", width: 1280, format: "webp", url: "https://cdn.example.com/1280.webp" },
      { key: "a/640.avif", width: 640, format: "avif", url: "https://cdn.example.com/640.avif" },
    ],
  };

  it("offers AVIF before WebP, because a browser takes the first it understands", () => {
    const element = CmsImage({ media }) as unknown as Element;
    const [sources, img] = element.props.children as [Element[], Element];

    expect(sources.map((source) => source.props.type)).toEqual(["image/avif", "image/webp"]);
    expect(sources[1]?.props.srcSet).toBe(
      "https://cdn.example.com/640.webp 640w, https://cdn.example.com/1280.webp 1280w",
    );
    expect(img.props.src).toBe(media.url);
    expect(img.props.alt).toBe("A ledger");
  });

  it("lazy-loads by default and eagerly fetches the one image above the fold", () => {
    const lazy = (CmsImage({ media }) as unknown as Element).props.children as [unknown, Element];
    const eager = (CmsImage({ media, priority: true }) as unknown as Element).props
      .children as [unknown, Element];

    expect(lazy[1].props.loading).toBe("lazy");
    expect(eager[1].props.loading).toBe("eager");
    expect(eager[1].props.fetchPriority).toBe("high");
  });

  it("falls back to an empty alt rather than omitting the attribute", () => {
    const element = CmsImage({
      media: { url: "https://cdn.example.com/x.jpg" },
    }) as unknown as Element;
    const [, img] = element.props.children as [unknown, Element];

    expect(img.props.alt).toBe("");
  });
});
