import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../index";
import {
  AnalyticsError,
  GSC_MAX_ROW_LIMIT,
  buildQueryUrl,
  createSearchConsoleProvider,
  refreshAccessToken,
} from "../index";

const range = { start: "2026-01-01", end: "2026-01-31" };
const base = { siteUrl: "https://spendtab.com/", accessToken: "ya29.token" };

interface SentRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

/**
 * A GSC stand-in that pages exactly the way the real one does: it honours
 * `startRow`/`rowLimit` and returns a short page when it runs out.
 */
function pagingFetch(rows: unknown[]): { fetch: FetchLike; sent: SentRequest[] } {
  const sent: SentRequest[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    const startRow = Number(body["startRow"]);
    const rowLimit = Number(body["rowLimit"]);
    const page = rows.slice(startRow, startRow + rowLimit);
    return new Response(JSON.stringify({ rows: page }), { status: 200 });
  };
  return { fetch, sent };
}

function pageRow(path: string, extra: Record<string, number> = {}) {
  return {
    keys: [`https://spendtab.com${path}`],
    clicks: 1,
    impressions: 10,
    ctr: 0.1,
    position: 12.3,
    ...extra,
  };
}

function statusFetch(status: number, body = "{}"): FetchLike {
  return async () => new Response(body, { status });
}

describe("buildQueryUrl", () => {
  it("encodes the property as one path segment", () => {
    expect(buildQueryUrl("https://spendtab.com/")).toBe(
      "https://searchconsole.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fspendtab.com%2F/searchAnalytics/query",
    );
    expect(buildQueryUrl("sc-domain:spendtab.com")).toContain("sc-domain%3Aspendtab.com");
  });
});

describe("pagination", () => {
  it("asks for the API's maximum page size by default", async () => {
    const { fetch, sent } = pagingFetch([]);
    await createSearchConsoleProvider({ ...base, fetch }).listPagePerformance({ range });
    expect(sent[0]?.body["rowLimit"]).toBe(GSC_MAX_ROW_LIMIT);
    expect(sent[0]?.body["startRow"]).toBe(0);
    expect(sent[0]?.body["dimensions"]).toEqual(["page"]);
    expect(sent[0]?.headers["Authorization"]).toBe("Bearer ya29.token");
  });

  it("assembles several pages and stops on a short one", async () => {
    const rows = ["/a", "/b", "/c", "/d", "/e"].map((path) => pageRow(path));
    const { fetch, sent } = pagingFetch(rows);

    const result = await createSearchConsoleProvider({
      ...base,
      pageSize: 2,
      fetch,
    }).listPagePerformance({ range });

    expect(sent.map((request) => request.body["startRow"])).toEqual([0, 2, 4]);
    expect(result.map((row) => row.path)).toEqual(["/a", "/b", "/c", "/d", "/e"]);
  });

  it("stops on an empty page when the last full page landed exactly on the boundary", async () => {
    const rows = ["/a", "/b", "/c", "/d"].map((path) => pageRow(path));
    const { fetch, sent } = pagingFetch(rows);

    const result = await createSearchConsoleProvider({
      ...base,
      pageSize: 2,
      fetch,
    }).listPagePerformance({ range });

    expect(sent).toHaveLength(3);
    expect(result).toHaveLength(4);
  });

  it("stops once the caller's limit is satisfied", async () => {
    const rows = ["/a", "/b", "/c", "/d", "/e", "/f"].map((path) => pageRow(path));
    const { fetch, sent } = pagingFetch(rows);

    const result = await createSearchConsoleProvider({
      ...base,
      pageSize: 2,
      fetch,
    }).listPagePerformance({ range, limit: 3 });

    expect(result).toHaveLength(3);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body["rowLimit"]).toBe(1);
  });

  it("treats a body with no rows as a legitimate empty result", async () => {
    const provider = createSearchConsoleProvider({
      ...base,
      fetch: async () => new Response(JSON.stringify({ responseAggregationType: "byPage" }), { status: 200 }),
    });
    await expect(provider.listPagePerformance({ range })).resolves.toEqual([]);
  });
});

describe("metric mapping", () => {
  it("keeps ctr as a fraction and never rounds position", async () => {
    const { fetch } = pagingFetch([
      pageRow("/a", { ctr: 0.0123456, position: 10.437, impressions: 4021, clicks: 49 }),
    ]);
    const [row] = await createSearchConsoleProvider({ ...base, fetch }).listPagePerformance({ range });

    expect(row?.ctr).toBe(0.0123456);
    expect(row?.position).toBe(10.437);
    expect(row?.impressions).toBe(4021);
    expect(row?.clicks).toBe(49);
  });

  it("distinguishes 11.2 from 10.4 — page two from page one", async () => {
    const { fetch } = pagingFetch([pageRow("/a", { position: 11.2 }), pageRow("/b", { position: 10.4 })]);
    const rows = await createSearchConsoleProvider({ ...base, fetch }).listPagePerformance({ range });
    expect(rows.map((row) => row.position)).toEqual([11.2, 10.4]);
  });

  it("converts absolute page URLs to the join key", async () => {
    const { fetch } = pagingFetch([
      { keys: ["https://spendtab.com/blog/a/?utm=1"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
    ]);
    const rows = await createSearchConsoleProvider({ ...base, fetch }).listPagePerformance({ range });
    expect(rows[0]?.path).toBe("/blog/a");
  });

  it("filters to the requested paths without pushing the limit down", async () => {
    const { fetch, sent } = pagingFetch([pageRow("/a"), pageRow("/b"), pageRow("/c")]);
    const rows = await createSearchConsoleProvider({ ...base, pageSize: 10, fetch }).listPagePerformance({
      range,
      paths: ["/b"],
      limit: 1,
    });
    expect(rows.map((row) => row.path)).toEqual(["/b"]);
    expect(sent[0]?.body["rowLimit"]).toBe(10);
  });
});

describe("failures never look like an absence of traffic", () => {
  it("maps 401 to a non-retryable auth error", async () => {
    const provider = createSearchConsoleProvider({ ...base, fetch: statusFetch(401) });
    const error = (await provider
      .listPagePerformance({ range })
      .catch((caught: unknown) => caught)) as AnalyticsError;

    expect(error).toBeInstanceOf(AnalyticsError);
    expect(error.kind).toBe("auth");
    expect(error.retryable).toBe(false);
    expect(error.status).toBe(401);
    expect(error.provider).toBe("google-search-console");
  });

  it("maps 403 to a non-retryable auth error too", async () => {
    const provider = createSearchConsoleProvider({ ...base, fetch: statusFetch(403) });
    const error = (await provider
      .listPagePerformance({ range })
      .catch((caught: unknown) => caught)) as AnalyticsError;
    expect(error.kind).toBe("auth");
    expect(error.retryable).toBe(false);
  });

  it("maps 429 and 5xx to retryable errors", async () => {
    for (const [status, kind] of [
      [429, "rate_limit"],
      [500, "server"],
      [503, "server"],
    ] as const) {
      const provider = createSearchConsoleProvider({ ...base, fetch: statusFetch(status) });
      const error = (await provider
        .listPagePerformance({ range })
        .catch((caught: unknown) => caught)) as AnalyticsError;
      expect(error.kind).toBe(kind);
      expect(error.retryable).toBe(true);
    }
  });

  it("rejects rather than resolving to an empty array on any failure", async () => {
    for (const status of [401, 403, 429, 500]) {
      const provider = createSearchConsoleProvider({ ...base, fetch: statusFetch(status) });
      await expect(provider.listPagePerformance({ range })).rejects.toBeInstanceOf(AnalyticsError);
      await expect(provider.listQueries?.({ range })).rejects.toBeInstanceOf(AnalyticsError);
    }
  });

  it("treats a transport failure as retryable", async () => {
    const provider = createSearchConsoleProvider({
      ...base,
      fetch: vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    });
    const error = (await provider
      .listPagePerformance({ range })
      .catch((caught: unknown) => caught)) as AnalyticsError;
    expect(error.kind).toBe("network");
    expect(error.retryable).toBe(true);
  });
});

describe("listQueries", () => {
  it("asks for the query dimension alone when no page is named", async () => {
    const { fetch, sent } = pagingFetch([
      { keys: ["expense policy"], clicks: 12, impressions: 900, ctr: 0.0133, position: 7.8 },
    ]);
    const rows = await createSearchConsoleProvider({ ...base, fetch }).listQueries?.({ range });

    expect(sent[0]?.body["dimensions"]).toEqual(["query"]);
    expect(rows).toEqual([
      { query: "expense policy", clicks: 12, impressions: 900, ctr: 0.0133, position: 7.8 },
    ]);
  });

  it("adds the page dimension and filters locally when a page is named", async () => {
    const { fetch, sent } = pagingFetch([
      { keys: ["a", "https://spendtab.com/blog/a"], clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
      { keys: ["b", "https://spendtab.com/blog/b"], clicks: 9, impressions: 9, ctr: 1, position: 1 },
    ]);

    const rows = await createSearchConsoleProvider({ ...base, fetch }).listQueries?.({
      range,
      path: "/blog/a/",
    });

    expect(sent[0]?.body["dimensions"]).toEqual(["query", "page"]);
    expect(rows).toEqual([
      { query: "a", path: "/blog/a", clicks: 1, impressions: 2, ctr: 0.5, position: 3 },
    ]);
  });

  it("drops a partial row rather than defaulting its missing metrics to zero", async () => {
    const { fetch } = pagingFetch([{ keys: ["a"], clicks: 1, impressions: 2 }]);
    await expect(createSearchConsoleProvider({ ...base, fetch }).listQueries?.({ range })).resolves.toEqual(
      [],
    );
  });
});

describe("getPageTimeseries", () => {
  it("returns one ascending point per date for the requested page", async () => {
    const { fetch, sent } = pagingFetch([
      { keys: ["2026-01-03", "https://spendtab.com/blog/a"], clicks: 7, impressions: 70 },
      { keys: ["2026-01-01", "https://spendtab.com/blog/a"], clicks: 3, impressions: 30 },
      { keys: ["2026-01-02", "https://spendtab.com/blog/other"], clicks: 99, impressions: 990 },
    ]);

    const points = await createSearchConsoleProvider({ ...base, fetch }).getPageTimeseries?.({
      path: "/blog/a",
      range,
      metric: "clicks",
    });

    expect(sent[0]?.body["dimensions"]).toEqual(["date", "page"]);
    expect(points).toEqual([
      { date: "2026-01-01", value: 3 },
      { date: "2026-01-03", value: 7 },
    ]);
  });

  it("refuses to answer for views instead of passing off clicks as pageviews", async () => {
    const { fetch } = pagingFetch([]);
    const provider = createSearchConsoleProvider({ ...base, fetch });
    await expect(
      provider.getPageTimeseries?.({ path: "/a", range, metric: "views" }),
    ).rejects.toBeInstanceOf(AnalyticsError);
  });
});

describe("refreshAccessToken", () => {
  const creds = { clientId: "id", clientSecret: "secret", refreshToken: "1//refresh" };

  it("posts a form-encoded refresh grant and returns the new token", async () => {
    let sentBody = "";
    const token = await refreshAccessToken({
      ...creds,
      fetch: async (url, init) => {
        expect(url).toBe("https://oauth2.googleapis.com/token");
        sentBody = String(init?.body);
        return new Response(JSON.stringify({ access_token: "ya29.new", expires_in: 3599 }), {
          status: 200,
        });
      },
    });

    expect(new URLSearchParams(sentBody).get("grant_type")).toBe("refresh_token");
    expect(new URLSearchParams(sentBody).get("refresh_token")).toBe("1//refresh");
    expect(token).toEqual({ accessToken: "ya29.new", expiresInSeconds: 3599 });
  });

  it("classifies invalid_grant as needing reauthorisation, not as a retryable bug", async () => {
    const error = (await refreshAccessToken({
      ...creds,
      fetch: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    }).catch((caught: unknown) => caught)) as AnalyticsError;

    expect(error.kind).toBe("auth");
    expect(error.retryable).toBe(false);
  });

  it("treats a Google outage as retryable", async () => {
    const error = (await refreshAccessToken({ ...creds, fetch: statusFetch(503) }).catch(
      (caught: unknown) => caught,
    )) as AnalyticsError;
    expect(error.retryable).toBe(true);
  });

  it("rejects a 2xx without a usable token", async () => {
    const error = (await refreshAccessToken({
      ...creds,
      fetch: async () => new Response(JSON.stringify({ expires_in: 3599 }), { status: 200 }),
    }).catch((caught: unknown) => caught)) as AnalyticsError;
    expect(error.kind).toBe("malformed");
  });
});
