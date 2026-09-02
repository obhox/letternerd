import { describe, expect, it } from "vitest";
import {
  blogPostingLd,
  breadcrumbLd,
  collectionPageLd,
  faqLd,
  howToLd,
  jsonLdScript,
  organizationLd,
  personLd,
  speakableLd,
  truncateHeadline,
  websiteLd,
} from "../index.js";
import { author, doc, draftish, site } from "./fixtures.js";

const url = "https://spendtab.com/blog/expense-policies";

describe("blogPostingLd", () => {
  it("matches the golden node", () => {
    expect(blogPostingLd(doc, site)).toEqual({
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      "@id": `${url}#article`,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      url,
      headline: "How to write an expense policy",
      description: "A short guide to writing a policy people actually follow.",
      image: [
        { "@type": "ImageObject", url: "https://spendtab.com/media/og.png", width: 1200, height: 630 },
        {
          "@type": "ImageObject",
          url: "https://spendtab.com/media/cover.jpg",
          width: 1600,
          height: 900,
          caption: "A policy document",
        },
      ],
      datePublished: "2025-03-04T09:00:00.000Z",
      dateModified: "2025-06-01T12:30:00.000Z",
      author: {
        "@type": "Person",
        "@id": "https://spendtab.com/authors/jane-doe#person",
        name: "Jane Doe",
        url: "https://spendtab.com/authors/jane-doe",
        jobTitle: "Head of Finance Operations",
        description: "Writes about spend controls and month-end close.",
        image: "https://spendtab.com/media/jane.jpg",
        sameAs: ["https://www.linkedin.com/in/janedoe"],
        knowsAbout: ["Spend management", "Procurement"],
      },
      publisher: {
        "@type": "Organization",
        "@id": "https://spendtab.com/#organization",
        name: "Spendtab Ltd",
        url: "https://spendtab.com",
        logo: { "@type": "ImageObject", url: "https://spendtab.com/logo.png" },
        sameAs: ["https://x.com/spendtab", "https://www.linkedin.com/company/spendtab"],
      },
      inLanguage: "en-GB",
      articleSection: "Finance Ops",
      keywords: ["Policy", "Controls"],
      wordCount: 1240,
      timeRequired: "PT6M",
      about: [
        {
          "@type": "Thing",
          "@id": "https://www.wikidata.org/wiki/Q5421100",
          name: "Expense policy",
        },
      ],
      mentions: [
        {
          "@type": "Thing",
          name: "Procurement",
          sameAs: ["https://en.wikipedia.org/wiki/Procurement"],
        },
      ],
    });
  });

  it("never emits a bare-string author", () => {
    const node = blogPostingLd(doc, site);
    expect(typeof node["author"]).toBe("object");
    expect(node["author"]).toMatchObject({ "@type": "Person", jobTitle: expect.any(String) });
  });

  it("truncates a long headline and keeps the original as alternativeHeadline", () => {
    const long =
      "How to write an expense policy that finance, procurement and every budget holder in the " +
      "company will actually read and then follow";
    const node = blogPostingLd({ ...doc, title: long }, site);

    expect(String(node["headline"]).length).toBeLessThanOrEqual(110);
    expect(node["headline"]).toBe(
      "How to write an expense policy that finance, procurement and every budget holder in the company will actually",
    );
    expect(node["alternativeHeadline"]).toBe(long);
  });

  it("falls back to the publication date when nothing has been edited", () => {
    const node = blogPostingLd(draftish, site);
    expect(node["dateModified"]).toBe("2025-01-02T00:00:00.000Z");
    expect(node["about"]).toBeUndefined();
    expect(node["alternativeHeadline"]).toBeUndefined();
  });

  it("treats every entity as primary when none is marked", () => {
    const node = blogPostingLd(
      { ...doc, entities: [{ name: "Procurement" }, { name: "Budgets" }] },
      site,
    );
    expect(node["about"]).toHaveLength(2);
    expect(node["mentions"]).toBeUndefined();
  });

  it("emits an author array only when there is more than one", () => {
    const node = blogPostingLd({ ...doc, authors: [author, { name: "Sam Lee", slug: "sam-lee" }] }, site);
    expect(Array.isArray(node["author"])).toBe(true);
    expect(node["author"]).toHaveLength(2);
  });
});

describe("truncateHeadline", () => {
  it("cuts at a word boundary when there is a sensible one", () => {
    expect(truncateHeadline("a".repeat(50))).toBe("a".repeat(50));
    expect(truncateHeadline(`${"word ".repeat(30)}end`).length).toBeLessThanOrEqual(110);
    expect(truncateHeadline("a".repeat(200))).toHaveLength(110);
  });
});

describe("organizationLd / personLd / websiteLd", () => {
  it("identify themselves on the consuming origin", () => {
    expect(organizationLd(site)).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": "https://spendtab.com/#organization",
      name: "Spendtab Ltd",
      url: "https://spendtab.com",
      logo: { "@type": "ImageObject", url: "https://spendtab.com/logo.png" },
      sameAs: ["https://x.com/spendtab", "https://www.linkedin.com/company/spendtab"],
    });

    expect(websiteLd(site)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": "https://spendtab.com/#website",
      name: "Spendtab",
      url: "https://spendtab.com",
      description: "Spend management, explained.",
      inLanguage: "en-GB",
      publisher: { "@id": "https://spendtab.com/#organization" },
    });
  });

  it("lets an author's own URL become their identity", () => {
    const node = personLd({ ...author, url: "https://janedoe.example" }, site);
    expect(node["@id"]).toBe("https://janedoe.example#person");
    expect(node["url"]).toBe("https://janedoe.example");
  });
});

describe("breadcrumbLd", () => {
  it("absolutises every step and numbers from one", () => {
    expect(
      breadcrumbLd(
        [
          { name: "Home", path: "/" },
          { name: "Blog", path: "/blog" },
          { name: doc.title, path: "/blog/expense-policies" },
        ],
        site,
      ),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://spendtab.com" },
        { "@type": "ListItem", position: 2, name: "Blog", item: "https://spendtab.com/blog" },
        { "@type": "ListItem", position: 3, name: doc.title, item: url },
      ],
    });
  });
});

describe("faqLd", () => {
  it("anchors each question at the heading it came from", () => {
    expect(faqLd(doc)).toEqual({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: [
        {
          "@type": "Question",
          "@id": "#how-do-i-write-an-expense-policy",
          name: "How do I write an expense policy?",
          acceptedAnswer: {
            "@type": "Answer",
            text:
              "Start from the three or four categories that account for most of your spend, and write a limit for each.",
          },
        },
      ],
    });
  });

  it("emits nothing rather than an empty FAQPage", () => {
    expect(faqLd(draftish)).toBeNull();
    expect(faqLd({ ...doc, qa: [] })).toBeNull();
    expect(faqLd({ ...doc, qa: [{ question: "  ", answerText: "", anchorId: "x" }] })).toBeNull();
  });
});

describe("howToLd", () => {
  it("numbers its steps", () => {
    expect(howToLd(doc)).toEqual({
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "Write an expense policy",
      description: "Four steps from a blank page to a policy people follow.",
      step: [
        {
          "@type": "HowToStep",
          position: 1,
          name: "List your categories",
          text: "Pull last quarter's spend and group it.",
        },
        {
          "@type": "HowToStep",
          position: 2,
          name: "Set a limit per category",
          text: "Pick a number you will actually enforce.",
        },
      ],
    });
  });

  it("emits nothing when the document is not a how-to", () => {
    expect(howToLd(draftish)).toBeNull();
  });
});

describe("speakableLd", () => {
  it("advertises only the sections that exist", () => {
    expect(speakableLd(doc)).toEqual({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: doc.title,
      speakable: {
        "@type": "SpeakableSpecification",
        cssSelector: [".cms-tldr", ".cms-takeaways"],
      },
    });

    const tldrOnly = speakableLd({ ...doc, keyTakeaways: [] });
    expect(tldrOnly?.["speakable"]).toEqual({
      "@type": "SpeakableSpecification",
      cssSelector: [".cms-tldr"],
    });

    expect(speakableLd(draftish)).toBeNull();
  });
});

describe("collectionPageLd", () => {
  it("lists its members by URL without restating them", () => {
    expect(
      collectionPageLd([doc, draftish], site, { name: "Blog", path: "/blog", description: "Everything." }),
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": "https://spendtab.com/blog#collection",
      url: "https://spendtab.com/blog",
      name: "Blog",
      description: "Everything.",
      inLanguage: "en-GB",
      isPartOf: { "@id": "https://spendtab.com/#website" },
      mainEntity: {
        "@type": "ItemList",
        numberOfItems: 2,
        itemListElement: [
          { "@type": "ListItem", position: 1, url, name: doc.title },
          {
            "@type": "ListItem",
            position: 2,
            url: "https://spendtab.com/blog/receipts",
            name: "Receipts, briefly",
          },
        ],
      },
    });
  });
});

describe("jsonLdScript", () => {
  it("cannot break out of the script tag", () => {
    const hostile = {
      ...doc,
      title: 'Policies </script><img src=x onerror="alert(1)"> & "quotes"',
    };
    const body = jsonLdScript(blogPostingLd(hostile, site));

    expect(body).not.toContain("</script");
    expect(body).not.toContain("<");
    expect(body).not.toContain(">");
    expect(body).not.toContain("&");
    expect(body).toContain("\\u003c");
  });

  it("still parses back to exactly what went in", () => {
    const hostile = { headline: "a < b & c > d", note: "</script>" };
    expect(JSON.parse(jsonLdScript(hostile))).toEqual(hostile);
  });

  it("escapes the line separators that are legal JSON and fatal JavaScript", () => {
    const body = jsonLdScript({ headline: "a b c" });
    expect(body).toContain("\\u2028");
    expect(body).toContain("\\u2029");
    expect(JSON.parse(body)).toEqual({ headline: "a b c" });
  });

  it("serialises several nodes as one array and drops the absent ones", () => {
    const parsed = JSON.parse(jsonLdScript(organizationLd(site), faqLd(draftish), websiteLd(site)));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[1]["@type"]).toBe("WebSite");
  });

  it("serialises a single node as an object, not a one-element array", () => {
    expect(JSON.parse(jsonLdScript(websiteLd(site)))["@type"]).toBe("WebSite");
  });
});
