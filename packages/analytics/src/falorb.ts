import {
  AnalyticsError,
  httpError,
  networkError,
  type AnalyticsProvider,
  type FetchLike,
} from "./provider";
import { normalizePath } from "./path";
import type { DateRange, PagePerformance } from "./types";

/**
 * Audience numbers from Falorb.
 *
 * **The wire format below is inferred, not documented.** Falorb is the user's
 * own self-hosted analytics product and this package was written without
 * access to a live instance or its API reference. If the real API disagrees,
 * exactly two functions need changing and nothing else in this package does:
 *
 *   - `buildBreakdownRequest` — the URL, headers and request body.
 *   - `parseBreakdownResponse` — the envelope and the row field names.
 *
 * Both are exported and unit-tested in isolation for that reason. The provider
 * built on top of them only wires `fetch` between the two, so correcting the
 * shape is a change to two pure functions and their tests.
 *
 * What is assumed:
 *
 *   POST {baseUrl}/api/v1/breakdown
 *   Authorization: Bearer {apiKey}
 *   Content-Type: application/json
 *   {"project":"…","dimension":"path","start":"2026-01-01","end":"2026-01-31",
 *    "metrics":["views","visitors"],"limit":250,"filters":{"path":["/a","/b"]}}
 *
 *   → {"data":[{"path":"/a","views":1200,"visitors":900}, …]}
 *
 * The parser is deliberately looser than that: it accepts `{data}`,
 * `{results}`, `{rows}` or a bare array, and `path`/`page`/`url` and
 * `views`/`pageviews`/`visitors` (plus snake and camel spellings) as row
 * fields. Tolerating aliases costs a few lines; guessing wrong and shipping a
 * dashboard of empty rows costs a support ticket and an editor's trust.
 *
 * Note what this provider does *not* do: it does not track anything. The CMS
 * deliberately ships no beacon of its own, because a second beacon on the page
 * produces a second pageview number that never quite agrees with Falorb's, and
 * an editor with two numbers has none.
 */

const PROVIDER_NAME = "falorb";

export interface FalorbConfig {
  /** Origin of the Falorb instance, e.g. `https://analytics.example.com`. Trailing slash optional. */
  baseUrl: string;
  apiKey: string;
  /** Falorb's per-site identifier (its "project"). */
  project: string;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
}

/** A request described as data, so it can be asserted on without a network. */
export interface FalorbRequest {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface FalorbBreakdownArgs {
  range: DateRange;
  paths?: string[];
  limit?: number;
}

/** Falorb's default page size when the caller does not ask for one. */
export const FALORB_DEFAULT_LIMIT = 250;

/**
 * Builds the breakdown call. **Adjust this function if the wire format differs.**
 *
 * Pure: it returns the request rather than performing it, which is what makes
 * "did we send the right dates?" a unit test instead of an integration test.
 */
export function buildBreakdownRequest(
  config: Pick<FalorbConfig, "baseUrl" | "apiKey" | "project">,
  args: FalorbBreakdownArgs,
): FalorbRequest {
  const origin = config.baseUrl.trim().replace(/\/+$/, "");

  const body: Record<string, unknown> = {
    project: config.project,
    dimension: "path",
    start: args.range.start,
    end: args.range.end,
    metrics: ["views", "visitors"],
    limit: args.limit ?? FALORB_DEFAULT_LIMIT,
  };

  // Sent as a hint only. The response is filtered again on our side, because a
  // server that ignores an unknown filter key returns *everything* — and a
  // silently unfiltered result set would skew every median the insight rules
  // compute from it.
  if (args.paths && args.paths.length > 0) {
    body["filters"] = { path: args.paths };
  }

  return {
    url: `${origin}/api/v1/breakdown`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  };
}

/** Envelope shapes seen in the wild for this style of API. */
function unwrapRows(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  if (typeof payload !== "object" || payload === null) return undefined;

  const envelope = payload as Record<string, unknown>;
  for (const key of ["data", "results", "rows"]) {
    const candidate = envelope[key];
    if (Array.isArray(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Counts arrive as numbers from a JSON API and as strings from an API that
 * went through a query builder that stringifies bigints. Both are real
 * measurements; anything else is not.
 *
 * `undefined` — not `0` — is returned for a missing or unparseable field. See
 * the comment on `PagePerformance`: a zero we invented is indistinguishable
 * from a page nobody read.
 */
function toCount(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function firstCount(row: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const parsed = toCount(row[key]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

const PATH_KEYS = ["path", "page", "url", "pathname"] as const;
const VIEW_KEYS = ["views", "pageviews", "page_views", "pageViews"] as const;
const VISITOR_KEYS = ["visitors", "unique_visitors", "uniqueVisitors", "uniques"] as const;

/**
 * Maps a breakdown body to our shape. **Adjust this function if the wire
 * format differs.**
 *
 * Rows without a usable path are dropped rather than defaulted. A row filed
 * under `""` joins against no document, and worse, it still counts towards the
 * medians the insight rules compute — one junk row is a nudge, a hundred is a
 * wrong recommendation for every page on the site.
 */
export function parseBreakdownResponse(payload: unknown): PagePerformance[] {
  const rows = unwrapRows(payload);
  if (!rows) return [];

  const out: PagePerformance[] = [];
  for (const raw of rows) {
    if (typeof raw !== "object" || raw === null) continue;
    const row = raw as Record<string, unknown>;

    const rawPath = PATH_KEYS.map((key) => row[key]).find((value) => typeof value === "string");
    const path = normalizePath(typeof rawPath === "string" ? rawPath : undefined);
    if (!path) continue;

    const entry: PagePerformance = { path };
    const views = firstCount(row, VIEW_KEYS);
    const visitors = firstCount(row, VISITOR_KEYS);
    if (views !== undefined) entry.views = views;
    if (visitors !== undefined) entry.visitors = visitors;

    out.push(entry);
  }
  return out;
}

/**
 * Falorb as an `AnalyticsProvider`.
 *
 * `getPageTimeseries` and `listQueries` are intentionally absent. Falorb has
 * no search data at all, and its trend endpoint's shape is as unverified as
 * the breakdown one — declaring a method we would have to guess twice over is
 * worse than declaring the capability we can actually honour. `mergeProviders`
 * routes around the gap.
 */
export function createFalorbProvider(config: FalorbConfig): AnalyticsProvider {
  const doFetch: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));

  return {
    name: PROVIDER_NAME,
    capabilities: { audience: true, search: false },

    async listPagePerformance(args) {
      const request = buildBreakdownRequest(config, args);

      let response: Response;
      try {
        response = await doFetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body,
        });
      } catch (cause) {
        throw networkError(PROVIDER_NAME, cause);
      }

      if (!response.ok) {
        throw httpError({
          provider: PROVIDER_NAME,
          status: response.status,
          detail: await response.text().catch(() => ""),
        });
      }

      const payload: unknown = await response.json().catch(() => undefined);
      if (payload === undefined) {
        throw new AnalyticsError({
          provider: PROVIDER_NAME,
          kind: "malformed",
          retryable: false,
          message: "Falorb returned a 2xx that was not JSON.",
        });
      }

      let rows = parseBreakdownResponse(payload);

      // Re-filter locally: see `buildBreakdownRequest` on why the server-side
      // filter is treated as a hint.
      if (args.paths && args.paths.length > 0) {
        const wanted = new Set(
          args.paths
            .map((path) => normalizePath(path))
            .filter((path): path is string => path !== undefined),
        );
        rows = rows.filter((row) => wanted.has(row.path));
      }

      return args.limit === undefined ? rows : rows.slice(0, args.limit);
    },
  };
}
