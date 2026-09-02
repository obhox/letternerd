import { describe, expect, it } from "vitest";
import type { ValidationIssue } from "../index.js";
import {
  blogPostingLd,
  faqLd,
  hasBlockingIssues,
  howToLd,
  speakableLd,
  validateStructuredData,
} from "../index.js";
import { bodyText, doc, site } from "./fixtures.js";

const errors = (issues: ValidationIssue[]) => issues.filter((issue) => issue.severity === "error");
const at = (issues: ValidationIssue[], property: string) =>
  issues.filter((issue) => issue.property === property);

describe("BlogPosting", () => {
  it("passes the builder's own output", () => {
    const issues = validateStructuredData("BlogPosting", blogPostingLd(doc, site));
    expect(errors(issues)).toEqual([]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("blocks a document with no image", () => {
    const node = blogPostingLd({ ...doc, ogImage: null, coverImage: null }, site);
    const issues = validateStructuredData("BlogPosting", node);

    expect(at(issues, "image")).toHaveLength(1);
    expect(at(issues, "image")[0]).toMatchObject({
      type: "BlogPosting",
      severity: "error",
      message: expect.stringContaining("1200px"),
    });
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("warns, but does not block, on a 130-character headline", () => {
    const headline = `${"a".repeat(129)}!`;
    const issues = validateStructuredData("BlogPosting", {
      ...blogPostingLd(doc, site),
      headline,
    });

    expect(at(issues, "headline")).toHaveLength(1);
    expect(at(issues, "headline")[0]).toMatchObject({ severity: "warning" });
    expect(at(issues, "headline")[0]?.message).toContain("130 characters");
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("blocks a bare-string author", () => {
    const issues = validateStructuredData("BlogPosting", {
      ...blogPostingLd(doc, site),
      author: "Jane Doe",
    });

    expect(at(issues, "author")).toHaveLength(1);
    expect(at(issues, "author")[0]).toMatchObject({
      severity: "error",
      message: expect.stringContaining("Person node with @type"),
    });
  });

  it("blocks a date that is not ISO-8601", () => {
    const issues = validateStructuredData("BlogPosting", {
      ...blogPostingLd(doc, site),
      datePublished: "March 4, 2025",
    });

    expect(at(issues, "datePublished")[0]).toMatchObject({ severity: "error" });
    expect(at(issues, "datePublished")[0]?.message).toContain("ISO-8601");
  });

  it("accepts a bare date and rejects an impossible one", () => {
    const base = blogPostingLd(doc, site);
    expect(
      errors(validateStructuredData("BlogPosting", { ...base, datePublished: "2025-03-04" })),
    ).toEqual([]);
    expect(
      at(validateStructuredData("BlogPosting", { ...base, datePublished: "2025-13-45" }), "datePublished"),
    ).toHaveLength(1);
  });

  it("warns when an author has nothing to corroborate them", () => {
    const issues = validateStructuredData(
      "BlogPosting",
      blogPostingLd({ ...doc, author: { name: "Sam Lee", slug: "sam-lee" } }, site),
    );
    expect(at(issues, "author.sameAs")[0]).toMatchObject({ severity: "warning" });
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});

describe("FAQPage", () => {
  it("passes when every answer is on the page", () => {
    const issues = validateStructuredData("FAQPage", faqLd(doc), { bodyText });
    expect(errors(issues)).toEqual([]);
  });

  it("tolerates re-flowed whitespace and casing", () => {
    const reflowed = bodyText.replace(
      "Start from the three or four categories that account for most of your spend, and\nwrite a limit for each.",
      "Start from the three or four categories\n   that account for MOST of your spend, and write a limit for each.",
    );
    expect(errors(validateStructuredData("FAQPage", faqLd(doc), { bodyText: reflowed }))).toEqual([]);
  });

  it("blocks an answer that appears only in the markup", () => {
    const invented = {
      ...doc,
      qa: [
        {
          question: "How do I write an expense policy?",
          answerText: "Book a demo with our sales team and they will write one for you.",
          anchorId: "how-do-i-write-an-expense-policy",
        },
      ],
    };
    const issues = validateStructuredData("FAQPage", faqLd(invented), { bodyText });

    expect(at(issues, "mainEntity[0].acceptedAnswer.text")).toHaveLength(1);
    expect(at(issues, "mainEntity[0].acceptedAnswer.text")[0]).toMatchObject({
      severity: "error",
      message: expect.stringContaining("visible page body"),
    });
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("does not check the body when none was supplied", () => {
    expect(errors(validateStructuredData("FAQPage", faqLd(doc)))).toEqual([]);
  });

  it("blocks an empty FAQPage", () => {
    const issues = validateStructuredData("FAQPage", { "@type": "FAQPage", mainEntity: [] });
    expect(at(issues, "mainEntity")[0]).toMatchObject({ severity: "error" });
  });

  it("blocks an empty question or answer", () => {
    const issues = validateStructuredData("FAQPage", {
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "  ", acceptedAnswer: { text: "" } }],
    });
    expect(at(issues, "mainEntity[0].name")).toHaveLength(1);
    expect(at(issues, "mainEntity[0].acceptedAnswer.text")).toHaveLength(1);
  });
});

describe("HowTo", () => {
  it("passes a two-step how-to", () => {
    expect(errors(validateStructuredData("HowTo", howToLd(doc)))).toEqual([]);
  });

  it("blocks a how-to with one step", () => {
    const single = howToLd({
      ...doc,
      howTo: { name: "Write a policy", steps: [{ name: "Do it", text: "All of it." }] },
    });
    const issues = validateStructuredData("HowTo", single);

    expect(at(issues, "step")).toHaveLength(1);
    expect(at(issues, "step")[0]).toMatchObject({
      severity: "error",
      message: "HowTo requires at least 2 steps, got 1.",
    });
  });

  it("blocks an unnamed step and warns about an empty one", () => {
    const issues = validateStructuredData("HowTo", {
      "@type": "HowTo",
      name: "Write a policy",
      step: [
        { "@type": "HowToStep", name: "List categories", text: "" },
        { "@type": "HowToStep", text: "Pick a number." },
      ],
    });

    expect(at(issues, "step[1].name")[0]).toMatchObject({ severity: "error" });
    expect(at(issues, "step[0].text")[0]).toMatchObject({ severity: "warning" });
  });
});

describe("Speakable", () => {
  it("passes the builder's output and blocks an empty selector list", () => {
    expect(errors(validateStructuredData("Speakable", speakableLd(doc)))).toEqual([]);

    const issues = validateStructuredData("Speakable", {
      "@type": "SpeakableSpecification",
      cssSelector: [],
    });
    expect(at(issues, "speakable.cssSelector")[0]).toMatchObject({ severity: "error" });
  });
});

describe("validateStructuredData", () => {
  it("reports a payload that is not an object", () => {
    expect(validateStructuredData("BlogPosting", "nope")).toEqual([
      { type: "BlogPosting", severity: "error", message: "Structured data payload is not an object." },
    ]);
  });

  it("says so, without blocking, when it has no opinion about a type", () => {
    const issues = validateStructuredData("Recipe", { "@type": "Recipe" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: "warning" });
    expect(hasBlockingIssues(issues)).toBe(false);
  });
});
