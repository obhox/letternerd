import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../index";
import {
  AnalyticsError,
  buildBreakdownRequest,
  createFalorbProvider,
  normalizePath,
  parseBreakdownResponse,
} from "../index";

const config = { baseUrl: "https://analytics.example.com", apiKey: "sk-test", project: "spendtab" };
const range = { start: "2026-01-01", end: "2026-01-31" };

function jsonFetch(body: unknown, status = 200): FetchLike {
  return async () =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("buildBreakdownRequest", () => {
  it("targets the breakdown endpoint with the project, dimension and range", () => {
    const request = buildBreakdownRequest(config, { range });
    expect(request.url).toBe("https://analytics.example.com/api/v1/breakdown");
    expect(request.method).toBe("POST");
    expect(request.headers["Authorization"]).toBe("Bearer sk-test");

    expect(JSON.parse(request.body)).toMatchObject({
      project: "spendtab",
      dimension: "path",
      start: "2026-01-01",
      end: "2026-01-31",
    });
  });

  it("does not care how the base URL was typed", () => {
    const request = buildBreakdownRequest({ ...config, baseUrl: "https://analytics.example.com//" }, { range });
    expect(request.url).toBe("https://analytics.example.com/api/v1/breakdown");
  });

  it("omits the path filter entirely when no paths were asked for", () => {
    expect(JSON.parse(buildBreakdownRequest(config, { range }).body)).not.toHaveProperty("filters");
  });

  it("sends the path filter and the limit when given", () => {
    const body = JSON.parse(buildBreakdownRequest(config, { range, paths: ["/a"], limit: 10 }).body);
    expect(body).toMatchObject({ limit: 10, filters: { path: ["/a"] } });
  });
});

describe("parseBreakdownResponse envelopes", () => {
  const row = [{ path: "/blog/a", views: 12, visitors: 9 }];
  const expected = [{ path: "/blog/a", views: 12, visitors: 9 }];

  it("accepts a bare array", () => {
    expect(parseBreakdownResponse(row)).toEqual(expected);
  });

  it("accepts a {data} envelope", () => {
    expect(parseBreakdownResponse({ data: row })).toEqual(expected);
  });

  it("accepts a {results} envelope", () => {
    expect(parseBreakdownResponse({ results: row })).toEqual(expected);
  });

  it("returns nothing for a body it cannot recognise", () => {
    expect(parseBreakdownResponse({ nope: 1 })).toEqual([]);
    expect(parseBreakdownResponse(null)).toEqual([]);
    expect(parseBreakdownResponse("oops")).toEqual([]);
  });
});

describe("parseBreakdownResponse field aliases", () => {
  it("accepts page/url as the path field", () => {
    expect(parseBreakdownResponse([{ page: "/blog/a", views: 1 }])[0]?.path).toBe("/blog/a");
    expect(
      parseBreakdownResponse([{ url: "https://spendtab.com/blog/a", views: 1 }])[0]?.path,
    ).toBe("/blog/a");
  });

  it("accepts pageviews/page_views as views", () => {
    expect(parseBreakdownResponse([{ path: "/a", pageviews: 7 }])[0]?.views).toBe(7);
    expect(parseBreakdownResponse([{ path: "/a", page_views: 8 }])[0]?.views).toBe(8);
  });

  it("accepts unique_visitors/uniques as visitors", () => {
    expect(parseBreakdownResponse([{ path: "/a", unique_visitors: 3 }])[0]?.visitors).toBe(3);
    expect(parseBreakdownResponse([{ path: "/a", uniques: 4 }])[0]?.visitors).toBe(4);
  });

  it("parses counts that arrive as strings", () => {
    expect(parseBreakdownResponse([{ path: "/a", views: "120", visitors: "88" }])[0]).toEqual({
      path: "/a",
      views: 120,
      visitors: 88,
    });
  });

  it("leaves an unsupplied metric undefined rather than zero", () => {
    const parsed = parseBreakdownResponse([{ path: "/a", views: 5 }])[0];
    expect(parsed?.visitors).toBeUndefined();
    expect(Object.hasOwn(parsed ?? {}, "visitors")).toBe(false);
  });

  it("keeps a genuine zero", () => {
    expect(parseBreakdownResponse([{ path: "/a", views: 0 }])[0]?.views).toBe(0);
  });

  it("drops rows with no usable path instead of filing them under an empty string", () => {
    expect(parseBreakdownResponse([{ views: 5 }, { path: "   ", views: 5 }, "junk", null])).toEqual([]);
  });

  it("drops an unparseable count rather than guessing", () => {
    expect(parseBreakdownResponse([{ path: "/a", views: "many" }])[0]?.views).toBeUndefined();
  });
});

describe("normalizePath", () => {
  it("reduces an absolute URL to its path", () => {
    expect(normalizePath("https://spendtab.com/blog/a")).toBe("/blog/a");
    expect(normalizePath("//spendtab.com/blog/a")).toBe("/blog/a");
  });

  it("strips query strings and fragments so one page is one row", () => {
    expect(normalizePath("https://spendtab.com/blog/a?utm_source=newsletter")).toBe("/blog/a");
    expect(normalizePath("/blog/a?ref=x#section")).toBe("/blog/a");
  });

  it("strips trailing and duplicate slashes", () => {
    expect(normalizePath("/blog/a/")).toBe("/blog/a");
    expect(normalizePath("/blog//a//")).toBe("/blog/a");
    expect(normalizePath("blog/a")).toBe("/blog/a");
  });

  it("reads a leading double slash as a host, the way a browser would", () => {
    // `//spendtab.com/blog/a` is protocol-relative, so the first segment is the
    // host and not part of the path. Treating it as a path would file the
    // hostname as a directory and the row would join against nothing.
    expect(normalizePath("//spendtab.com/blog/a/")).toBe("/blog/a");
  });

  it("keeps the root as a single slash", () => {
    expect(normalizePath("https://spendtab.com/")).toBe("/");
    expect(normalizePath("/")).toBe("/");
  });

  it("refuses to invent a path", () => {
    expect(normalizePath("")).toBeUndefined();
    expect(normalizePath("   ")).toBeUndefined();
    expect(normalizePath(undefined)).toBeUndefined();
    expect(normalizePath("http://[bad")).toBeUndefined();
  });
});

describe("createFalorbProvider", () => {
  it("declares audience only", () => {
    const provider = createFalorbProvider({ ...config, fetch: jsonFetch({ data: [] }) });
    expect(provider.capabilities).toEqual({ audience: true, search: false });
    expect(provider.getPageTimeseries).toBeUndefined();
    expect(provider.listQueries).toBeUndefined();
  });

  it("maps a breakdown into page performance", async () => {
    const provider = createFalorbProvider({
      ...config,
      fetch: jsonFetch({ data: [{ url: "https://spendtab.com/blog/a/", pageviews: 120, visitors: 90 }] }),
    });
    expect(await provider.listPagePerformance({ range })).toEqual([
      { path: "/blog/a", views: 120, visitors: 90 },
    ]);
  });

  it("re-filters locally when the server ignored our path filter", async () => {
    const provider = createFalorbProvider({
      ...config,
      fetch: jsonFetch({ results: [{ path: "/blog/a" }, { path: "/blog/b" }] }),
    });
    const rows = await provider.listPagePerformance({ range, paths: ["/blog/b/"] });
    expect(rows.map((row) => row.path)).toEqual(["/blog/b"]);
  });

  it("throws a non-retryable auth error on 401, never an empty list", async () => {
    const provider = createFalorbProvider({ ...config, fetch: jsonFetch({ error: "nope" }, 401) });
    const error = await provider.listPagePerformance({ range }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AnalyticsError);
    expect((error as AnalyticsError).kind).toBe("auth");
    expect((error as AnalyticsError).retryable).toBe(false);
  });

  it("marks a 429 and a 503 retryable", async () => {
    for (const [status, kind] of [
      [429, "rate_limit"],
      [503, "server"],
    ] as const) {
      const provider = createFalorbProvider({ ...config, fetch: jsonFetch({}, status) });
      const error = (await provider
        .listPagePerformance({ range })
        .catch((caught: unknown) => caught)) as AnalyticsError;
      expect(error.kind).toBe(kind);
      expect(error.retryable).toBe(true);
      expect(error.provider).toBe("falorb");
    }
  });

  it("treats an unreachable host as retryable", async () => {
    const provider = createFalorbProvider({
      ...config,
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    const error = (await provider
      .listPagePerformance({ range })
      .catch((caught: unknown) => caught)) as AnalyticsError;
    expect(error.kind).toBe("network");
    expect(error.retryable).toBe(true);
  });

  it("rejects a 2xx that is not JSON rather than reporting no traffic", async () => {
    const provider = createFalorbProvider({
      ...config,
      fetch: async () => new Response("<html>maintenance</html>", { status: 200 }),
    });
    const error = (await provider
      .listPagePerformance({ range })
      .catch((caught: unknown) => caught)) as AnalyticsError;
    expect(error.kind).toBe("malformed");
  });
});
