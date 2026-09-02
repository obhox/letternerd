import { describe, expect, it } from "vitest";
import type { SeoSite } from "../index";
import {
  absoluteUrl,
  canonicalUrlFor,
  documentUrl,
  isSyndicated,
  joinPath,
  normalizeBaseUrl,
} from "../index";
import { doc, site } from "./fixtures";

describe("joinPath", () => {
  it("produces one leading slash and no trailing slash", () => {
    expect(joinPath("/blog", "my-post")).toBe("/blog/my-post");
    expect(joinPath("blog/", "/my-post/")).toBe("/blog/my-post");
    expect(joinPath("//blog//", "//my-post//")).toBe("/blog/my-post");
  });

  it("collapses to the root when there is nothing to join", () => {
    expect(joinPath()).toBe("/");
    expect(joinPath("/")).toBe("/");
    expect(joinPath("", null, undefined, "//")).toBe("/");
  });
});

describe("absoluteUrl", () => {
  const trailing: SeoSite = { ...site, baseUrl: "https://spendtab.com/" };

  it("does not care how the base URL was typed", () => {
    expect(absoluteUrl(site, "/blog")).toBe("https://spendtab.com/blog");
    expect(absoluteUrl(trailing, "/blog")).toBe("https://spendtab.com/blog");
    expect(absoluteUrl(trailing, "blog")).toBe("https://spendtab.com/blog");
    expect(normalizeBaseUrl("https://spendtab.com///")).toBe("https://spendtab.com");
  });

  it("returns the bare origin for the root path", () => {
    expect(absoluteUrl(site, "/")).toBe("https://spendtab.com");
    expect(absoluteUrl(trailing, "/")).toBe("https://spendtab.com");
  });

  it("leaves an already-absolute URL alone", () => {
    expect(absoluteUrl(site, "https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(absoluteUrl(site, "//cdn.example.com/a.png")).toBe("https://spendtab.com/cdn.example.com/a.png");
  });
});

describe("canonicalUrlFor", () => {
  it("builds from the consuming site's origin, never the CMS's", () => {
    expect(canonicalUrlFor(site, doc)).toBe("https://spendtab.com/blog/expense-policies");
    expect(documentUrl(site, doc)).toBe("https://spendtab.com/blog/expense-policies");
  });

  it("honours a syndication override verbatim, trailing slash included", () => {
    const syndicated = { ...doc, canonicalUrlOverride: "https://partner.example/posts/expenses/" };
    expect(canonicalUrlFor(site, syndicated)).toBe("https://partner.example/posts/expenses/");
    expect(isSyndicated(site, syndicated)).toBe(true);
    // The document still has a home here; only its canonical points away.
    expect(documentUrl(site, syndicated)).toBe("https://spendtab.com/blog/expense-policies");
  });

  it("resolves a root-relative override against this site", () => {
    const moved = { ...doc, canonicalUrlOverride: "/guides/expense-policies" };
    expect(canonicalUrlFor(site, moved)).toBe("https://spendtab.com/guides/expense-policies");
    expect(isSyndicated(site, moved)).toBe(false);
  });

  it("ignores an empty override", () => {
    expect(canonicalUrlFor(site, { ...doc, canonicalUrlOverride: "  " })).toBe(
      "https://spendtab.com/blog/expense-policies",
    );
  });
});
