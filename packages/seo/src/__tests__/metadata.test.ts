import { describe, expect, it } from "vitest";
import { openGraphLocale, pageMetadataFields } from "../index.js";
import { doc, draftish, site } from "./fixtures.js";

describe("pageMetadataFields", () => {
  it("matches the golden object", () => {
    expect(pageMetadataFields(doc, site)).toEqual({
      title: "How to write an expense policy",
      description: "A short guide to writing a policy people actually follow.",
      canonical: "https://spendtab.com/blog/expense-policies",
      robots: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
      alternates: {
        canonical: "https://spendtab.com/blog/expense-policies",
        types: [
          { type: "text/markdown", url: "https://spendtab.com/blog/expense-policies.md" },
        ],
      },
      openGraph: {
        type: "article",
        url: "https://spendtab.com/blog/expense-policies",
        siteName: "Spendtab",
        title: "How to write an expense policy · Spendtab",
        description: "A short guide to writing a policy people actually follow.",
        locale: "en_GB",
        images: [
          { url: "https://spendtab.com/media/og.png", width: 1200, height: 630 },
          {
            url: "https://spendtab.com/media/cover.jpg",
            width: 1600,
            height: 900,
            alt: "A policy document",
          },
        ],
        publishedTime: "2025-03-04T09:00:00.000Z",
        modifiedTime: "2025-06-01T12:30:00.000Z",
        authors: ["Jane Doe"],
        section: "Finance Ops",
        tags: ["Policy", "Controls"],
      },
      twitter: {
        card: "summary_large_image",
        title: "How to write an expense policy · Spendtab",
        description: "A short guide to writing a policy people actually follow.",
        images: ["https://spendtab.com/media/og.png", "https://spendtab.com/media/cover.jpg"],
        site: "@spendtab",
        creator: "@spendtab",
      },
    });
  });

  it("keeps the markdown alternate on this site even when the canonical is not", () => {
    const syndicated = { ...doc, canonicalUrlOverride: "https://partner.example/posts/expenses/" };
    const fields = pageMetadataFields(syndicated, site);

    expect(fields.canonical).toBe("https://partner.example/posts/expenses/");
    expect(fields.alternates.types[0]?.url).toBe(
      "https://spendtab.com/blog/expense-policies.md",
    );
  });

  it("noindexes without nofollowing", () => {
    const fields = pageMetadataFields({ ...doc, noindex: true }, site);
    expect(fields.robots.index).toBe(false);
    expect(fields.robots.follow).toBe(true);
    expect(fields.robots["max-snippet"]).toBe(-1);
  });

  it("falls back to a site-wide card and downgrades to a summary without one", () => {
    expect(pageMetadataFields(draftish, site).twitter.card).toBe("summary");
    const withFallback = pageMetadataFields(draftish, site, { fallbackImageUrl: "/og.png" });
    expect(withFallback.twitter.card).toBe("summary_large_image");
    expect(withFallback.openGraph.images).toEqual([{ url: "https://spendtab.com/og.png" }]);
  });

  it("normalises the Twitter handle however it was typed", () => {
    expect(pageMetadataFields(doc, { ...site, twitterHandle: "@@spendtab" }).twitter.site).toBe(
      "@spendtab",
    );
    expect(pageMetadataFields(doc, { ...site, twitterHandle: null }).twitter.site).toBeUndefined();
  });

  it("suppresses the site suffix when asked", () => {
    const fields = pageMetadataFields(doc, site, { titleSuffix: false, type: "website" });
    expect(fields.openGraph.title).toBe("How to write an expense policy");
    expect(fields.openGraph.type).toBe("website");
  });

  it("converts the locale to the form Open Graph reads", () => {
    expect(openGraphLocale("en-GB")).toBe("en_GB");
    expect(openGraphLocale("pt-BR")).toBe("pt_BR");
  });
});
