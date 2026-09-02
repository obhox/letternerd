import { describe, expect, it, vi } from "vitest";
import type { AnalyticsProvider, PagePerformance } from "../index";
import { AnalyticsError, mergePagePerformance, mergeProviders } from "../index";

function stubProvider(
  name: string,
  capabilities: { audience: boolean; search: boolean },
  rows: PagePerformance[],
  extras: Partial<AnalyticsProvider> = {},
): AnalyticsProvider {
  return {
    name,
    capabilities,
    listPagePerformance: async () => rows,
    ...extras,
  };
}

const range = { start: "2026-01-01", end: "2026-01-31" };

const audience = stubProvider("falorb", { audience: true, search: false }, [
  { path: "/blog/a", views: 120, visitors: 90 },
  { path: "/blog/b", views: 4, visitors: 4 },
]);

const search = stubProvider("gsc", { audience: false, search: true }, [
  { path: "/blog/a", impressions: 4000, clicks: 40, ctr: 0.01, position: 6.4 },
  { path: "/blog/c", impressions: 900, clicks: 0, ctr: 0, position: 14.2 },
]);

describe("mergePagePerformance", () => {
  it("keeps a real zero rather than falling through to the other side", () => {
    const merged = mergePagePerformance(
      { path: "/x", clicks: 0 },
      { path: "/x", clicks: 500, impressions: 900 },
    );
    expect(merged.clicks).toBe(0);
    expect(merged.impressions).toBe(900);
  });

  it("leaves a field absent when neither side measured it", () => {
    const merged = mergePagePerformance({ path: "/x", views: 3 }, { path: "/x", visitors: 2 });
    expect(merged).toEqual({ path: "/x", views: 3, visitors: 2 });
    expect(Object.hasOwn(merged, "impressions")).toBe(false);
    expect(merged.impressions).toBeUndefined();
  });
});

describe("mergeProviders", () => {
  it("advertises the union of its providers' capabilities", () => {
    const merged = mergeProviders([audience, search]);
    expect(merged.capabilities).toEqual({ audience: true, search: true });
    expect(merged.name).toBe("falorb+gsc");
  });

  it("joins audience and search rows on the path", async () => {
    const merged = mergeProviders([audience, search]);
    const rows = await merged.listPagePerformance({ range });

    expect(rows[0]).toEqual({
      path: "/blog/a",
      views: 120,
      visitors: 90,
      impressions: 4000,
      clicks: 40,
      ctr: 0.01,
      position: 6.4,
    });
  });

  it("takes the union of paths, not the intersection, in first-seen order", async () => {
    const merged = mergeProviders([audience, search]);
    const rows = await merged.listPagePerformance({ range });
    expect(rows.map((row) => row.path)).toEqual(["/blog/a", "/blog/b", "/blog/c"]);
  });

  it("never invents a metric no provider supplied", async () => {
    const merged = mergeProviders([audience, search]);
    const rows = await merged.listPagePerformance({ range });

    const searchOnly = rows.find((row) => row.path === "/blog/c");
    expect(searchOnly?.views).toBeUndefined();
    expect(searchOnly?.visitors).toBeUndefined();
    expect(Object.hasOwn(searchOnly ?? {}, "views")).toBe(false);

    const audienceOnly = rows.find((row) => row.path === "/blog/b");
    expect(audienceOnly?.impressions).toBeUndefined();
    expect(audienceOnly?.ctr).toBeUndefined();
  });

  it("keeps a measured zero distinct from an unmeasured field", async () => {
    const merged = mergeProviders([audience, search]);
    const rows = await merged.listPagePerformance({ range });
    const searchOnly = rows.find((row) => row.path === "/blog/c");

    // Zero clicks is a finding. Unknown views is not.
    expect(searchOnly?.clicks).toBe(0);
    expect(searchOnly?.ctr).toBe(0);
    expect(searchOnly?.views).toBeUndefined();
  });

  it("gives earlier providers precedence for a field both supply", async () => {
    const first = stubProvider("first", { audience: true, search: false }, [{ path: "/x", views: 10 }]);
    const second = stubProvider("second", { audience: true, search: false }, [{ path: "/x", views: 99 }]);
    const rows = await mergeProviders([first, second]).listPagePerformance({ range });
    expect(rows[0]?.views).toBe(10);
  });

  it("trims the merged union to the requested limit", async () => {
    const merged = mergeProviders([audience, search]);
    const rows = await merged.listPagePerformance({ range, limit: 2 });
    expect(rows.map((row) => row.path)).toEqual(["/blog/a", "/blog/b"]);
  });

  it("passes the limit down so upstreams do not fetch everything", async () => {
    const spy = vi.fn(async () => [] as PagePerformance[]);
    const provider = stubProvider("spy", { audience: true, search: false }, [], {
      listPagePerformance: spy,
    });
    await mergeProviders([provider]).listPagePerformance({ range, limit: 5, paths: ["/a"] });
    expect(spy).toHaveBeenCalledWith({ range, limit: 5, paths: ["/a"] });
  });

  it("routes a timeseries to the provider that owns that signal", async () => {
    const audienceSeries = vi.fn(async () => [{ date: "2026-01-01", value: 5 }]);
    const searchSeries = vi.fn(async () => [{ date: "2026-01-01", value: 7 }]);

    const merged = mergeProviders([
      stubProvider("falorb", { audience: true, search: false }, [], {
        getPageTimeseries: audienceSeries,
      }),
      stubProvider("gsc", { audience: false, search: true }, [], { getPageTimeseries: searchSeries }),
    ]);

    await merged.getPageTimeseries?.({ path: "/a", range, metric: "views" });
    expect(audienceSeries).toHaveBeenCalledOnce();
    expect(searchSeries).not.toHaveBeenCalled();

    await merged.getPageTimeseries?.({ path: "/a", range, metric: "impressions" });
    expect(searchSeries).toHaveBeenCalledOnce();
  });

  it("refuses a timeseries no provider can answer, rather than returning nothing", async () => {
    const merged = mergeProviders([audience]);
    await expect(
      merged.getPageTimeseries?.({ path: "/a", range, metric: "clicks" }),
    ).rejects.toBeInstanceOf(AnalyticsError);
  });

  it("delegates queries to the search provider", async () => {
    const listQueries = vi.fn(async () => []);
    const merged = mergeProviders([
      audience,
      stubProvider("gsc", { audience: false, search: true }, [], { listQueries }),
    ]);
    await merged.listQueries?.({ range });
    expect(listQueries).toHaveBeenCalledOnce();
  });

  it("propagates a provider failure instead of silently returning a partial view", async () => {
    const broken = stubProvider("broken", { audience: false, search: true }, [], {
      listPagePerformance: async () => {
        throw new AnalyticsError({
          provider: "broken",
          kind: "auth",
          retryable: false,
          message: "token expired",
        });
      },
    });

    await expect(mergeProviders([audience, broken]).listPagePerformance({ range })).rejects.toThrow(
      /token expired/,
    );
  });

  it("rejects an empty provider list", () => {
    expect(() => mergeProviders([])).toThrow(AnalyticsError);
  });
});
