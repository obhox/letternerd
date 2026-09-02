import {
  AnalyticsError,
  httpError,
  networkError,
  type AnalyticsProvider,
  type FetchLike,
} from "./provider";
import { normalizePath } from "./path";
import type { DateRange, PagePerformance, QueryPerformance, TimeseriesPoint } from "./types";

/**
 * Google Search Console — impressions, clicks, CTR and average position.
 *
 * This is the highest-value signal the CMS can show an editor and the one
 * missing everywhere: it is the only source that says what people searched for
 * before they did or did not click. Falorb can tell you a page got 40 visits;
 * only GSC can tell you it got 4,000 impressions at position 6 and 40 clicks,
 * which is a title problem and an afternoon's work.
 *
 * ## Failure is never an empty array
 *
 * Every failure here throws an `AnalyticsError` carrying `retryable`. It would
 * be far more convenient to return `[]` on error and let the screen render.
 * That convenience is a trap: "0 impressions" is a legitimate, actionable
 * reading, so an expired token that renders as zero tells an editor their
 * healthy, ranking post is invisible to Google. They rewrite it. They may
 * damage it. Nothing in the UI ever said "we could not ask". An expired token
 * must reach the surface as `kind: "auth", retryable: false` so the screen can
 * say "reconnect Search Console" instead of showing numbers.
 *
 * ## This module does not refresh tokens
 *
 * It takes an `accessToken` and uses it. Refreshing is a scheduled,
 * side-effecting, credential-writing job with its own storage and locking
 * concerns; folding it in here would mean every read path could silently write
 * a secret, and a burst of parallel reads would race to refresh the same
 * token. `refreshAccessToken` is exported separately for whoever owns that
 * schedule.
 */

const PROVIDER_NAME = "google-search-console";

const API_ORIGIN = "https://searchconsole.googleapis.com";

/** GSC's hard cap on rows per request. Asking for more is a 400, not a bigger page. */
export const GSC_MAX_ROW_LIMIT = 25000;

/**
 * A stop so a misbehaving server cannot spin us forever.
 *
 * The loop's real exit is a short page. If an endpoint ever returned a full
 * page indefinitely — a proxy replaying a cached response, say — we would page
 * until the process died. One million rows is far past any real property.
 */
const MAX_PAGES = 40;

export interface SearchConsoleConfig {
  /**
   * The property exactly as GSC names it: `https://spendtab.com/` for a URL
   * prefix property, `sc-domain:spendtab.com` for a domain property. It is
   * path-encoded into the request URL, never concatenated.
   */
  siteUrl: string;
  accessToken: string;
  /**
   * Rows per request. Defaults to — and is clamped to — `GSC_MAX_ROW_LIMIT`,
   * because fewer, larger pages is the right default against an API with a
   * daily quota. Exposed so tests can exercise the paging loop without
   * fabricating 25,000 rows, and so a caller on a slow link can ask for
   * smaller responses.
   */
  pageSize?: number;
  /** Injected for tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
}

/** One row as GSC returns it. Every field is optional because we do not control this shape. */
interface GscRow {
  keys?: unknown;
  clicks?: unknown;
  impressions?: unknown;
  ctr?: unknown;
  position?: unknown;
}

export interface SearchAnalyticsQueryBody {
  startDate: string;
  endDate: string;
  dimensions: string[];
  rowLimit: number;
  startRow: number;
}

/** `https://spendtab.com/` contains slashes; it must be a single path segment. */
export function buildQueryUrl(siteUrl: string): string {
  return `${API_ORIGIN}/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function keyAt(row: GscRow, index: number): string | undefined {
  if (!Array.isArray(row.keys)) return undefined;
  const value: unknown = row.keys[index];
  return typeof value === "string" ? value : undefined;
}

/**
 * Runs one `searchAnalytics/query` and pages through the whole result.
 *
 * GSC does not report a total or a next-page token. The only end-of-data
 * signal is a page shorter than the one requested, so that is the loop's exit:
 * ask for `rowLimit`, advance `startRow` by however many came back, stop when
 * a page is short. Requesting exactly `rowLimit` rows and stopping there would
 * silently truncate every property with more pages than that — and truncation
 * here is not a display bug, it removes documents from the corpus the insight
 * rules take medians over, moving every threshold.
 */
async function fetchAllRows(
  config: SearchConsoleConfig,
  body: Omit<SearchAnalyticsQueryBody, "rowLimit" | "startRow">,
  maxRows?: number,
): Promise<GscRow[]> {
  const doFetch: FetchLike = config.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const url = buildQueryUrl(config.siteUrl);

  const pageSize = Math.min(
    GSC_MAX_ROW_LIMIT,
    Math.max(1, Math.trunc(config.pageSize ?? GSC_MAX_ROW_LIMIT)),
  );

  const collected: GscRow[] = [];
  let startRow = 0;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const remaining = maxRows === undefined ? pageSize : maxRows - collected.length;
    if (remaining <= 0) break;
    const rowLimit = Math.min(pageSize, remaining);

    const payload: SearchAnalyticsQueryBody = { ...body, rowLimit, startRow };

    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
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

    const parsed: unknown = await response.json().catch(() => undefined);
    if (typeof parsed !== "object" || parsed === null) {
      throw new AnalyticsError({
        provider: PROVIDER_NAME,
        kind: "malformed",
        retryable: false,
        message: "Search Console returned a 2xx whose body was not a JSON object.",
      });
    }

    const rows: unknown = (parsed as { rows?: unknown }).rows;
    // An absent `rows` is GSC's way of saying "no data for these dimensions",
    // which is a legitimate empty result — unlike an error, which threw above.
    if (!Array.isArray(rows) || rows.length === 0) break;

    collected.push(...(rows as GscRow[]));

    if (rows.length < rowLimit) break;
    startRow += rows.length;
  }

  return collected;
}

/**
 * Maps a GSC row onto our shape.
 *
 * `ctr` stays the 0–1 fraction GSC reports; converting to a percentage here
 * would mean every consumer has to know which convention this one provider
 * used. `position` is passed through untouched: **never round it.** An average
 * position of 10.4 is the bottom of page one and 11.2 is the top of page two,
 * and the entire "near miss" insight is built on telling those apart. Rounded
 * to integers they are both "11" and the finding disappears.
 */
function metricsOf(row: GscRow): Omit<PagePerformance, "path"> {
  const out: Omit<PagePerformance, "path"> = {};
  const clicks = toNumber(row.clicks);
  const impressions = toNumber(row.impressions);
  const ctr = toNumber(row.ctr);
  const position = toNumber(row.position);
  if (clicks !== undefined) out.clicks = clicks;
  if (impressions !== undefined) out.impressions = impressions;
  if (ctr !== undefined) out.ctr = ctr;
  if (position !== undefined) out.position = position;
  return out;
}

export function createSearchConsoleProvider(config: SearchConsoleConfig): AnalyticsProvider {
  /**
   * Paths are filtered here rather than with `dimensionFilterGroups`.
   *
   * GSC's filter groups AND their filters together, so "any of these twelve
   * paths" is not expressible in one request, and `siteUrl` may be
   * `sc-domain:example.com` — a form from which no absolute page URL can be
   * reconstructed, and a `page equals` filter needs the absolute URL. Guessing
   * the origin to build one would silently match nothing. Filtering on our side
   * costs bandwidth and is always right.
   */
  const filterToPaths = (rows: PagePerformance[], paths?: string[]): PagePerformance[] => {
    if (!paths || paths.length === 0) return rows;
    const wanted = new Set(
      paths.map((path) => normalizePath(path)).filter((path): path is string => path !== undefined),
    );
    return rows.filter((row) => wanted.has(row.path));
  };

  return {
    name: PROVIDER_NAME,
    capabilities: { audience: false, search: true },

    async listPagePerformance(args) {
      // When a path filter is in play the row cap cannot be pushed down: GSC
      // would hand back `limit` rows of *any* pages and we might keep none of
      // them. Fetch, filter, then trim.
      const maxRows = args.paths && args.paths.length > 0 ? undefined : args.limit;

      const rows = await fetchAllRows(
        config,
        { startDate: args.range.start, endDate: args.range.end, dimensions: ["page"] },
        maxRows,
      );

      const mapped: PagePerformance[] = [];
      for (const row of rows) {
        const path = normalizePath(keyAt(row, 0));
        if (!path) continue;
        mapped.push({ path, ...metricsOf(row) });
      }

      const filtered = filterToPaths(mapped, args.paths);
      return args.limit === undefined ? filtered : filtered.slice(0, args.limit);
    },

    async listQueries(args) {
      // `["query","page"]` when a page is named, so the page can be matched on
      // our side; `["query"]` otherwise, which is both cheaper and the
      // site-wide totals the caller actually asked for.
      const dimensions = args.path ? ["query", "page"] : ["query"];
      const wanted = args.path ? normalizePath(args.path) : undefined;

      const rows = await fetchAllRows(
        config,
        { startDate: args.range.start, endDate: args.range.end, dimensions },
        wanted ? undefined : args.limit,
      );

      const mapped: QueryPerformance[] = [];
      for (const row of rows) {
        const query = keyAt(row, 0);
        if (query === undefined) continue;

        const path = args.path ? normalizePath(keyAt(row, 1)) : undefined;
        if (wanted && path !== wanted) continue;

        const metrics = metricsOf(row);
        // A query row is only meaningful with its four numbers; a partial row
        // would force every consumer to re-introduce the `0`-vs-unknown
        // problem `QueryPerformance` exists to avoid.
        if (
          metrics.impressions === undefined ||
          metrics.clicks === undefined ||
          metrics.ctr === undefined ||
          metrics.position === undefined
        ) {
          continue;
        }

        const entry: QueryPerformance = {
          query,
          impressions: metrics.impressions,
          clicks: metrics.clicks,
          ctr: metrics.ctr,
          position: metrics.position,
        };
        if (path) entry.path = path;
        mapped.push(entry);
      }

      return args.limit === undefined ? mapped : mapped.slice(0, args.limit);
    },

    async getPageTimeseries(args) {
      if (args.metric === "views") {
        throw new AnalyticsError({
          provider: PROVIDER_NAME,
          kind: "request",
          retryable: false,
          message:
            "Search Console has no pageview metric; views come from the audience provider. Asking here would return search clicks under an audience label.",
        });
      }

      const wanted = normalizePath(args.path);
      if (!wanted) {
        throw new AnalyticsError({
          provider: PROVIDER_NAME,
          kind: "request",
          retryable: false,
          message: `Not a usable path: ${JSON.stringify(args.path)}`,
        });
      }

      const rows = await fetchAllRows(config, {
        startDate: args.range.start,
        endDate: args.range.end,
        dimensions: ["date", "page"],
      });

      const points: TimeseriesPoint[] = [];
      for (const row of rows) {
        const date = keyAt(row, 0);
        if (date === undefined) continue;
        if (normalizePath(keyAt(row, 1)) !== wanted) continue;

        const value = toNumber(row[args.metric]);
        if (value === undefined) continue;
        points.push({ date, value });
      }

      // GSC returns date-dimensioned rows in order, but the sort makes that an
      // assumption we do not depend on: a chart drawn from unsorted points is
      // a zigzag no one can read.
      return points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Token refresh — a separate concern, scheduled by the caller.        */
/* ------------------------------------------------------------------ */

export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface RefreshAccessTokenArgs {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fetch?: FetchLike;
}

export interface RefreshedAccessToken {
  accessToken: string;
  /** Seconds from now, as Google reports it. The caller owns the clock. */
  expiresInSeconds: number;
  scope?: string;
  tokenType?: string;
}

/**
 * Exchanges a refresh token for a fresh access token.
 *
 * Deliberately not wired into the provider: whoever holds the credentials
 * decides when to run this, where to store the result and how to keep two
 * concurrent refreshes from clobbering each other. This function does one
 * request and returns one value; it writes nothing.
 *
 * A revoked or expired refresh token comes back as HTTP 400 `invalid_grant`,
 * which is an auth failure wearing a client-error status code. It is
 * classified as `kind: "auth"` so callers treat it as "the user must reconnect"
 * rather than as a bug in the request — retrying it forever would never work
 * and would never surface the reconnect prompt.
 */
export async function refreshAccessToken(args: RefreshAccessTokenArgs): Promise<RefreshedAccessToken> {
  const doFetch: FetchLike = args.fetch ?? ((input, init) => globalThis.fetch(input, init));

  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    refresh_token: args.refreshToken,
    grant_type: "refresh_token",
  }).toString();

  let response: Response;
  try {
    response = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });
  } catch (cause) {
    throw networkError(PROVIDER_NAME, cause);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 400 && detail.includes("invalid_grant")) {
      throw new AnalyticsError({
        provider: PROVIDER_NAME,
        status: 400,
        kind: "auth",
        retryable: false,
        message:
          "Google refused the refresh token (invalid_grant). It was revoked or expired; the user must reconnect Search Console.",
      });
    }
    throw httpError({ provider: PROVIDER_NAME, status: response.status, detail });
  }

  const payload: unknown = await response.json().catch(() => undefined);
  const token =
    typeof payload === "object" && payload !== null
      ? (payload as Record<string, unknown>)
      : undefined;

  const accessToken = token?.["access_token"];
  const expiresIn = toNumber(token?.["expires_in"]);
  if (typeof accessToken !== "string" || accessToken.length === 0 || expiresIn === undefined) {
    throw new AnalyticsError({
      provider: PROVIDER_NAME,
      kind: "malformed",
      retryable: false,
      message: "Google's token endpoint returned a 2xx without a usable access_token/expires_in.",
    });
  }

  const result: RefreshedAccessToken = { accessToken, expiresInSeconds: expiresIn };
  const scope = token?.["scope"];
  const tokenType = token?.["token_type"];
  if (typeof scope === "string") result.scope = scope;
  if (typeof tokenType === "string") result.tokenType = tokenType;
  return result;
}
