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
    expect(absoluteUrl(site, "http://cdn.example.com/a.png")).toBe("http://cdn.example.com/a.png");
    expect(absoluteUrl(site, "HTTPS://cdn.example.com/a.png")).toBe("HTTPS://cdn.example.com/a.png");
    expect(absoluteUrl(site, "//cdn.example.com/a.png")).toBe("https://spendtab.com/cdn.example.com/a.png");
  });

  it("treats any scheme that is not the web's as a path, never as an absolute URL", () => {
    // A settings field is where these would arrive, and every caller writes
    // the result into an href, a <loc> or a JSON-LD url.
    expect(absoluteUrl(site, "javascript:alert(1)")).toBe("https://spendtab.com/javascript:alert(1)");
    expect(absoluteUrl(site, "data:text/html,<script>")).toBe(
      "https://spendtab.com/data:text/html,<script>",
    );
    expect(absoluteUrl(site, "mailto:hello@example.com")).toBe(
      "https://spendtab.com/mailto:hello@example.com",
    );
    // A scheme prefix without `//` is not a web URL either.
    expect(absoluteUrl(site, "https:evil.example/a")).toBe("https://spendtab.com/https:evil.example/a");
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

describe("canonicalUrlFor with a hostile override", () => {
  it("never emits a non-web scheme verbatim", async () => {
    const { canonicalUrlFor } = await import("../url");
    const site = { baseUrl: "https://blog.example", blogBasePath: "/blog" } as never;
    const url = canonicalUrlFor(site, { slug: "hello", canonicalUrlOverride: "javascript:alert(1)" });
    expect(url).toBe(canonicalUrlFor(site, { slug: "hello", canonicalUrlOverride: null }));
    expect(url).not.toContain("javascript:");
    expect(canonicalUrlFor(site, { slug: "hello", canonicalUrlOverride: "https://other.example/p/" })).toBe(
      "https://other.example/p/",
    );
  });
});
