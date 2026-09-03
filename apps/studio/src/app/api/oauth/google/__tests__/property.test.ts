import { describe, expect, it } from "vitest";
import { pickProperty } from "../property";

/**
 * Which Search Console property a site's numbers come from.
 *
 * Every "returns null" test below is the important kind. The failure this
 * function exists to prevent is not an error — it is confidently connecting the
 * wrong property and filling the insights screen with another site's rankings,
 * which nothing downstream can detect. Refusing to choose is always recoverable;
 * choosing wrongly is not.
 */

const verified = (siteUrl: string) => ({ siteUrl, permissionLevel: "siteOwner" });

describe("pickProperty", () => {
  it("prefers an exact URL-prefix match", () => {
    expect(
      pickProperty(
        [verified("https://other.example/"), verified("https://example.com/")],
        "https://example.com",
      ),
    ).toBe("https://example.com/");
  });

  it("tolerates the trailing slash Google adds", () => {
    expect(pickProperty([verified("https://example.com/")], "https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("prefers a domain property over a same-host prefix variant", () => {
    // A domain property survives an http→https move and a www change; a prefix
    // property does not, so it is the better long-lived choice.
    expect(
      pickProperty(
        [verified("http://example.com/"), verified("sc-domain:example.com")],
        "https://example.com",
      ),
    ).toBe("sc-domain:example.com");
  });

  it("matches a domain property across a www prefix", () => {
    expect(pickProperty([verified("sc-domain:example.com")], "https://www.example.com")).toBe(
      "sc-domain:example.com",
    );
  });

  it("accepts a single same-host prefix property differing only by scheme", () => {
    expect(pickProperty([verified("http://example.com/")], "https://example.com")).toBe(
      "http://example.com/",
    );
  });

  it("refuses to choose between two same-host candidates", () => {
    // http:// and https:// hold genuinely different data. Picking by list order
    // would be the silent wrong-site failure in miniature.
    expect(
      pickProperty(
        [verified("http://example.com/"), verified("https://www.example.com/")],
        "https://example.com",
      ),
    ).toBeNull();
  });

  it("never falls back to the only property when it is a different site", () => {
    expect(pickProperty([verified("https://somebody-else.example/")], "https://example.com")).toBe(
      null,
    );
  });

  it("never falls back to the first of many", () => {
    expect(
      pickProperty(
        [
          verified("https://client-a.example/"),
          verified("https://client-b.example/"),
          verified("sc-domain:client-c.example"),
        ],
        "https://example.com",
      ),
    ).toBeNull();
  });

  it("ignores a property the account cannot actually query", () => {
    // Visible in the list, 403 on every read. Connecting it produces a
    // credential whose failure message ("reconnect") can never be the fix.
    expect(
      pickProperty(
        [{ siteUrl: "https://example.com/", permissionLevel: "siteUnverifiedUser" }],
        "https://example.com",
      ),
    ).toBeNull();
  });

  it("survives a malformed entry list and a malformed base URL", () => {
    expect(pickProperty([{}, { siteUrl: 42 }, { siteUrl: "" }], "https://example.com")).toBeNull();
    expect(pickProperty([verified("https://example.com/")], "not a url")).toBeNull();
    expect(pickProperty([], "https://example.com")).toBeNull();
  });

  it("is case-insensitive about the host", () => {
    expect(pickProperty([verified("https://Example.com/")], "https://example.com")).toBe(
      "https://Example.com/",
    );
  });
});
