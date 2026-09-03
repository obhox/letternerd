import { describe, expect, it, vi } from "vitest";
import type { AnyCapability } from "@cms/core";

/**
 * The route table is compiled once, at module load, from whatever the
 * capability registry contains — so the resolution rules cannot be exercised
 * against the real registry, which happens to contain no static/parameter
 * collision today. A synthetic registry is substituted here precisely so the
 * *rules* are tested rather than the current accident of which routes exist.
 *
 * `match-route.registry.test.ts` covers the other half: that the real registry
 * still resolves through those rules.
 *
 * `:id` is registered before `search` deliberately. Registry order alone would
 * make the parameter win, so a test that passes here is testing the sort and
 * not the map's iteration order.
 */
vi.mock("@cms/capabilities", () => {
  const fake = (name: string, method: string, path: string) =>
    [name, { name, route: { method, path } } as unknown as AnyCapability] as const;

  return {
    registry: new Map<string, AnyCapability>([
      fake("get_document", "GET", "/documents/:id"),
      fake("search_documents", "GET", "/documents/search"),
      fake("list_documents", "GET", "/documents"),
      fake("delete_document", "DELETE", "/documents/:id"),
      fake("set_document_tags", "PUT", "/documents/:id/tags"),
      fake("publish_document", "POST", "/documents/:id/publish"),
    ]),
  };
});

const { matchRoute } = await import("../rest");

describe("matchRoute", () => {
  /**
   * The one that would break silently. `/documents/search` and
   * `/documents/:id` are both two-segment GETs, so without the literal-segment
   * sort the winner is whichever the registry happens to yield first — and the
   * symptom is not an error but a search request quietly resolving to "fetch
   * the document whose id is 'search'".
   */
  it("prefers a static segment over a parameter that also matches", () => {
    expect(matchRoute("GET", ["documents", "search"])?.capability.name).toBe("search_documents");
  });

  it("still matches the parameter route for a value that is not the static segment", () => {
    const matched = matchRoute("GET", ["documents", "01hqz"]);
    expect(matched?.capability.name).toBe("get_document");
    expect(matched?.params).toEqual({ id: "01hqz" });
  });

  it("dispatches on the method, so the same path reaches a different capability", () => {
    expect(matchRoute("GET", ["documents", "01hqz"])?.capability.name).toBe("get_document");
    expect(matchRoute("DELETE", ["documents", "01hqz"])?.capability.name).toBe("delete_document");
  });

  it("returns null when the path exists but the method does not", () => {
    // A PUT to /documents is not a route. Falling through to the GET would
    // turn a client's mistake into a successful read of somebody's listing.
    expect(matchRoute("PUT", ["documents"])).toBeNull();
    expect(matchRoute("PATCH", ["documents", "01hqz"])).toBeNull();
  });

  it("returns null when the segment count differs", () => {
    // Neither a prefix nor a suffix of a real route may match it: `/documents`
    // must not answer for `/documents/x/y`, and `/documents/:id/publish` must
    // not answer for `/documents/:id`.
    expect(matchRoute("GET", ["documents", "01hqz", "extra"])).toBeNull();
    expect(matchRoute("POST", ["documents", "01hqz"])).toBeNull();
    expect(matchRoute("GET", [])).toBeNull();
  });

  it("decodes a percent-encoded path parameter", () => {
    // Slugs and ids arrive encoded. Handing the raw `%2F` to a capability that
    // looks the value up verbatim finds nothing, which surfaces as a 404 on a
    // document that plainly exists.
    const matched = matchRoute("GET", ["documents", "a%2Fb%20c"]);
    expect(matched?.params).toEqual({ id: "a/b c" });
  });

  it("collects every parameter of a multi-segment route", () => {
    const matched = matchRoute("PUT", ["documents", "01hqz", "tags"]);
    expect(matched?.capability.name).toBe("set_document_tags");
    expect(matched?.params).toEqual({ id: "01hqz" });
  });

  it("gives a fully static route an empty parameter set rather than omitting it", () => {
    const matched = matchRoute("GET", ["documents"]);
    expect(matched?.capability.name).toBe("list_documents");
    expect(matched?.params).toEqual({});
  });

  it("returns null for a path no capability claims", () => {
    expect(matchRoute("GET", ["not-a-thing"])).toBeNull();
  });
});
