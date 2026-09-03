import { describe, expect, it } from "vitest";
import { DEFAULT_DESTINATION, safeRedirect } from "../redirect";

/**
 * `safeRedirect` is the only thing standing between the sign-in page and an
 * open redirect, so this is the most exhaustive file in the suite. Each
 * rejection below is a payload class rather than a variation on one — they
 * defeat different checks, and a refactor that keeps three of them and loses
 * the fourth is exactly the failure this file exists to catch.
 *
 * The contract is total: anything that is not a same-origin path becomes
 * `DEFAULT_DESTINATION`, and nothing throws, so a caller can use the result
 * unconditionally.
 */
describe("safeRedirect", () => {
  describe("refuses anything that could leave the origin", () => {
    it.each([
      // A protocol-relative URL: a full cross-origin destination that begins
      // with a slash, so any check that only looks at target[0] waves it past.
      ["protocol-relative host", "//evil.example/dashboard"],
      // Browsers collapse the extra slash. A prefix test written against
      // exactly two characters would not.
      ["triple slash", "///evil.example"],
      // Browsers normalise a backslash to a slash before resolving, so this is
      // the protocol-relative attack spelled to survive a slash-only check.
      ["backslash protocol-relative", "/\\evil.example/dashboard"],
      ["backslash then slash", "/\\/evil.example"],
      ["absolute https URL", "https://evil.example/dashboard"],
      ["absolute http URL", "http://evil.example"],
      // Even a plausible-looking host is a URL rather than a path, and
      // accepting it means trusting a string comparison against a hostname.
      ["absolute URL on a plausible host", "https://studio.example.com/acme/posts"],
      ["javascript scheme", "javascript:alert(document.domain)"],
      // Scheme casing must not matter. It does not, because there is no scheme
      // list to get the casing wrong in — this is caught by "must start with /".
      ["mixed-case javascript scheme", "JaVaScRiPt:alert(1)"],
      ["data scheme", "data:text/html,<script>alert(1)</script>"],
      // Some routers happily treat a bare host as a host. Requiring a leading
      // slash means one never reaches a router.
      ["bare host", "evil.example/dashboard"],
      // Not a valid absolute URL, but browsers repair it into one, so the
      // string that is validated is not the string that is navigated to.
      ["single-slash scheme", "http:/evil.example"],
      // Control characters are stripped by the browser *after* validation:
      // `/dashboard\n//evil.example` validates as a path and navigates to a
      // host. Any of them is smuggling; none is a legitimate destination.
      ["embedded newline", "/dashboard\n//evil.example"],
      ["embedded carriage return", "/dashboard\r//evil.example"],
      ["embedded tab", "/\t/evil.example"],
      ["embedded NUL", "/dashboard\u0000//evil.example"],
      ["embedded DEL", "/dashboard\u007f/x"],
    ])("returns the default destination for %s", (_label, payload) => {
      expect(safeRedirect(payload)).toBe(DEFAULT_DESTINATION);
    });

    /**
     * A repeated `?redirect=` arrives as an array. Reading `candidate[0]`
     * would let an attacker append their own parameter to a link the victim
     * reads and checks, so an array is refused outright — including when every
     * entry in it is individually harmless, because there is no legitimate
     * reason to send two.
     */
    it("returns the default destination for a duplicated query parameter", () => {
      expect(safeRedirect(["/acme/posts", "//evil.example"])).toBe(DEFAULT_DESTINATION);
      expect(safeRedirect(["//evil.example", "/acme/posts"])).toBe(DEFAULT_DESTINATION);
      expect(safeRedirect(["/acme/posts", "/acme/media"])).toBe(DEFAULT_DESTINATION);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["an empty string", ""],
      ["whitespace only", "   \t  "],
    ])("returns the default destination for %s", (_label, payload) => {
      expect(safeRedirect(payload)).toBe(DEFAULT_DESTINATION);
    });
  });

  describe("passes a legitimate destination through unchanged", () => {
    it.each([
      ["the root", "/"],
      ["a plain path", "/acme/posts"],
      ["a nested path", "/acme/posts/01hqz/settings"],
      // The listing screens carry their filters in the query string, so
      // dropping it would land a returning user on an unfiltered list.
      ["a query string", "/acme/posts?status=draft&type=post"],
      ["a repeated query key", "/acme/posts?tag=a&tag=b"],
      ["a fragment", "/acme/posts/01hqz#seo"],
      ["a query string and a fragment", "/acme/posts?status=draft#seo"],
      // Percent-encoding must survive verbatim: decoding or re-encoding it
      // would change which document the path addresses.
      ["percent-encoded characters", "/acme/posts/a%20b%2Fc"],
    ])("preserves %s", (_label, payload) => {
      expect(safeRedirect(payload)).toBe(payload);
    });

    it("trims surrounding whitespace rather than rejecting the value", () => {
      expect(safeRedirect("  /acme/posts  ")).toBe("/acme/posts");
      // Whitespace at the edge is a stray character from a copied link, not
      // smuggling in the middle of a path.
      expect(safeRedirect("\t/acme/posts\n")).toBe("/acme/posts");
    });
  });
});
