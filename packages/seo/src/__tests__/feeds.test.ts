import { describe, expect, it } from "vitest";
import { buildAtom, buildJsonFeed, buildRss, escapeXml, rfc822 } from "../index";
import { doc, draftish, site } from "./fixtures";

const hostile = {
  ...doc,
  title: `Policies & "controls" <script> 'quoted' > done`,
  bodyHtml: "<p>Full body. A literal ]]> lives here.</p>",
  excerpt: "Just the teaser.",
};

describe("escapeXml", () => {
  it("escapes all five predefined entities", () => {
    expect(escapeXml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &apos;");
  });
});

describe("buildRss", () => {
  it("carries the whole body, not the excerpt", () => {
    const xml = buildRss([doc], site);
    expect(xml).toContain(
      "<content:encoded><![CDATA[<p>An expense policy is the set of rules that decides what a company will pay for.</p>]]></content:encoded>",
    );
    expect(xml).toContain("<description>Start with the categories that matter.</description>");
  });

  it("produces well-formed XML from a hostile title", () => {
    const xml = buildRss([hostile], site);

    expect(xml).toContain(
      "<title>Policies &amp; &quot;controls&quot; &lt;script&gt; &apos;quoted&apos; &gt; done</title>",
    );
    // No stray markup, and no ampersand that is not the start of an entity.
    expect(xml).not.toContain("<script>");
    expect(xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/)).toBeNull();
  });

  it("cannot be ended early by a body containing the CDATA terminator", () => {
    const xml = buildRss([hostile], site);
    expect(xml).toContain("A literal ]]]]><![CDATA[> lives here.");
    expect(xml.trimEnd().endsWith("</rss>")).toBe(true);
  });

  it("links and identifies items by their canonical URL", () => {
    const xml = buildRss([doc], site);
    expect(xml).toContain("<link>https://spendtab.com/blog/expense-policies</link>");
    expect(xml).toContain(
      '<guid isPermaLink="true">https://spendtab.com/blog/expense-policies</guid>',
    );
    expect(xml).toContain("<atom:link href=\"https://spendtab.com/rss.xml\" rel=\"self\"");
    expect(xml).toContain("<pubDate>Tue, 04 Mar 2025 09:00:00 GMT</pubDate>");
  });

  it("dates the channel from the newest item and never from the clock", () => {
    expect(buildRss([doc, draftish], site)).toContain(
      "<lastBuildDate>Sun, 01 Jun 2025 12:30:00 GMT</lastBuildDate>",
    );
    expect(buildRss([], site)).not.toContain("<lastBuildDate>");
    expect(rfc822("nonsense")).toBe("");
  });
});

describe("buildAtom", () => {
  it("carries the identity, the dates and the full content", () => {
    const xml = buildAtom([doc], site);

    expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-GB">');
    expect(xml).toContain("<id>https://spendtab.com/</id>");
    expect(xml).toContain(
      '<link rel="self" type="application/atom+xml" href="https://spendtab.com/atom.xml" />',
    );
    expect(xml).toContain("<id>https://spendtab.com/blog/expense-policies</id>");
    expect(xml).toContain("<published>2025-03-04T09:00:00.000Z</published>");
    expect(xml).toContain("<updated>2025-06-01T12:30:00.000Z</updated>");
    expect(xml).toContain('<content type="html"><![CDATA[<p>An expense policy');
    expect(xml).toContain("<author><name>Jane Doe</name></author>");
  });

  it("escapes a hostile title in an attribute and in text", () => {
    const xml = buildAtom([{ ...hostile, tags: [{ name: 'A "tag"', slug: "a-tag" }] }], site);
    expect(xml).toContain('label="A &quot;tag&quot;"');
    expect(xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/)).toBeNull();
  });
});

describe("buildJsonFeed", () => {
  it("is JSON Feed 1.1 with absolute URLs and full content", () => {
    const feed = buildJsonFeed([doc], site);

    expect(feed.version).toBe("https://jsonfeed.org/version/1.1");
    expect(feed.title).toBe("The Spendtab Blog");
    expect(feed.home_page_url).toBe("https://spendtab.com/blog");
    expect(feed.feed_url).toBe("https://spendtab.com/feed.json");
    expect(feed.language).toBe("en-GB");
    expect(feed.items).toEqual([
      {
        id: "https://spendtab.com/blog/expense-policies",
        url: "https://spendtab.com/blog/expense-policies",
        title: "How to write an expense policy",
        content_html: doc.bodyHtml,
        summary: "Start with the categories that matter.",
        date_published: "2025-03-04T09:00:00.000Z",
        date_modified: "2025-06-01T12:30:00.000Z",
        authors: [{ name: "Jane Doe" }],
        tags: ["Policy", "Controls"],
        image: "https://spendtab.com/media/og.png",
      },
    ]);
  });

  it("omits what a bare document does not have", () => {
    const [item] = buildJsonFeed([draftish], site).items;
    expect(item).toEqual({
      id: "https://spendtab.com/blog/receipts",
      url: "https://spendtab.com/blog/receipts",
      title: "Receipts, briefly",
      content_html: "",
      date_published: "2025-01-02T00:00:00.000Z",
    });
  });
});
