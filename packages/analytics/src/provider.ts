import type { DateRange, PagePerformance, QueryPerformance, TimeseriesPoint } from "./types";

/**
 * The seam between "where the numbers come from" and "what we say about them".
 *
 * Three signal sources feed this package and they are deliberately kept apart:
 * audience (Falorb, the user's own self-hosted analytics — the CMS must not
 * ship a second beacon, because two beacons produce two numbers that never
 * quite agree and an editor with no way to tell which is wrong), search
 * (Google Search Console) and AI crawler hits (first-party, already in the
 * CMS's own tables). A provider declares which of those it can answer for
 * rather than pretending to answer for all of them.
 *
 * `getPageTimeseries` and `listQueries` are optional because a provider that
 * genuinely cannot serve them must be able to say so at the type level. The
 * alternative — a required method that returns `[]` — is the same lie as
 * reporting `0` for an unmeasured metric.
 */

/**
 * The subset of `fetch` this package uses, so every HTTP client can be handed
 * a stub in tests. No module here reaches for the global directly at call
 * time; it is captured once at construction and defaulted from `globalThis`.
 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AnalyticsProvider {
  readonly name: string;
  readonly capabilities: { audience: boolean; search: boolean };

  listPagePerformance(args: {
    range: DateRange;
    paths?: string[];
    limit?: number;
  }): Promise<PagePerformance[]>;

  getPageTimeseries?(args: {
    path: string;
    range: DateRange;
    metric: "views" | "clicks" | "impressions" | "position";
  }): Promise<TimeseriesPoint[]>;

  listQueries?(args: { range: DateRange; path?: string; limit?: number }): Promise<QueryPerformance[]>;
}

/**
 * Why a failure is an exception here and not an empty array.
 *
 * The whole package exists to tell an editor what is and is not working. An
 * expired OAuth token that surfaces as "0 impressions" is worse than an outage,
 * because it is indistinguishable from a real finding: the editor rewrites a
 * post that was ranking fine. So every client in this package throws, loudly
 * and typed, and callers decide whether to retry or to show a "reconnect
 * Search Console" banner.
 *
 * `retryable` is the whole point of the type. A 429 or a 503 will succeed on
 * its own later and should be backed off. A 401 or 403 will never succeed
 * without a human reauthorising, and retrying it just burns quota and hides
 * the banner the user needs to see.
 */
export class AnalyticsError extends Error {
  readonly provider: string;
  readonly retryable: boolean;
  readonly kind: AnalyticsErrorKind;
  readonly status?: number;

  constructor(args: {
    provider: string;
    kind: AnalyticsErrorKind;
    retryable: boolean;
    message: string;
    status?: number;
    cause?: unknown;
  }) {
    super(args.message, args.cause === undefined ? undefined : { cause: args.cause });
    this.name = "AnalyticsError";
    this.provider = args.provider;
    this.kind = args.kind;
    this.retryable = args.retryable;
    if (args.status !== undefined) this.status = args.status;
  }
}

export type AnalyticsErrorKind =
  /** Credentials are gone or insufficient. A human must reconnect; retrying cannot help. */
  | "auth"
  /** Provider asked us to slow down. Back off and retry. */
  | "rate_limit"
  /** Provider is broken right now. Back off and retry. */
  | "server"
  /** The request never completed — DNS, TLS, socket. Retry. */
  | "network"
  /** A 2xx whose body we could not understand. Retrying the same call gets the same body. */
  | "malformed"
  /** We built a request the provider rejected. A bug here, not a transient fault. */
  | "request";

export function isAnalyticsError(error: unknown): error is AnalyticsError {
  return error instanceof AnalyticsError;
}

/** The metric fields of `PagePerformance`, i.e. everything but the join key. */
const METRIC_KEYS = ["views", "visitors", "impressions", "clicks", "ctr", "position"] as const;

/**
 * Combines two rows for the same path without inventing anything.
 *
 * A field is written only when one of the two sides actually measured it, so
 * "neither provider reports views" stays `undefined` rather than becoming `0`.
 * A real `0` from the first provider wins over a later value, because `??`
 * treats zero as the measurement it is.
 *
 * Precedence is provider order: the first provider passed to `mergeProviders`
 * that supplies a field owns it. That is arbitrary but it is *stated* and
 * deterministic, which matters more — an editor comparing two screens must not
 * see a different clicks number depending on which upstream replied first.
 */
export function mergePagePerformance(base: PagePerformance, incoming: PagePerformance): PagePerformance {
  const merged: PagePerformance = { path: base.path };
  for (const key of METRIC_KEYS) {
    const value = base[key] ?? incoming[key];
    if (value !== undefined) merged[key] = value;
  }
  return merged;
}

/**
 * Merges rows from several providers into one row per path.
 *
 * Order is first-seen: the first provider's paths in its own order, then any
 * path only later providers knew about. A page with search data but no
 * audience data still appears — the union, not the intersection, because a
 * page nobody visited but that collects 4,000 impressions is exactly the
 * finding this package is for.
 */
export function mergePageRows(rowGroups: PagePerformance[][]): PagePerformance[] {
  const merged = new Map<string, PagePerformance>();
  for (const rows of rowGroups) {
    for (const row of rows) {
      const existing = merged.get(row.path);
      merged.set(row.path, existing ? mergePagePerformance(existing, row) : mergePagePerformance(row, row));
    }
  }
  return [...merged.values()];
}

/**
 * Fans a call out to several providers and joins the answers by path.
 *
 * This is what lets an audience provider and a search provider compose into
 * the single table the Insights screen renders. It is a provider itself, so a
 * caller never learns how many sources are behind it.
 *
 * Failures propagate rather than being swallowed. A merged view missing one
 * source silently is the "0 impressions" trap again, one level up: the numbers
 * look complete and are not.
 */
export function mergeProviders(providers: AnalyticsProvider[]): AnalyticsProvider {
  if (providers.length === 0) {
    throw new AnalyticsError({
      provider: "merge",
      kind: "request",
      retryable: false,
      message: "mergeProviders needs at least one provider.",
    });
  }

  const capabilities = {
    audience: providers.some((provider) => provider.capabilities.audience),
    search: providers.some((provider) => provider.capabilities.search),
  };

  const name = providers.map((provider) => provider.name).join("+");

  /**
   * A timeseries cannot be merged — two sources' daily numbers for the same
   * metric are two different measurements, and averaging or summing them would
   * be fabrication. So one provider answers, chosen by which signal the metric
   * belongs to.
   */
  const timeseriesProviderFor = (metric: "views" | "clicks" | "impressions" | "position") => {
    const needsSearch = metric !== "views";
    return providers.find(
      (provider) =>
        provider.getPageTimeseries !== undefined &&
        (needsSearch ? provider.capabilities.search : provider.capabilities.audience),
    );
  };

  const queryProvider = providers.find(
    (provider) => provider.listQueries !== undefined && provider.capabilities.search,
  );

  const merged: AnalyticsProvider = {
    name,
    capabilities,

    async listPagePerformance(args) {
      const groups = await Promise.all(providers.map((provider) => provider.listPagePerformance(args)));
      const rows = mergePageRows(groups);
      // `limit` was already passed down so each upstream fetched at most that
      // many rows; the union can still exceed it, so trim once at the end.
      return args.limit === undefined ? rows : rows.slice(0, args.limit);
    },

    async getPageTimeseries(args) {
      const provider = timeseriesProviderFor(args.metric);
      if (!provider?.getPageTimeseries) {
        throw new AnalyticsError({
          provider: name,
          kind: "request",
          retryable: false,
          message: `No provider behind "${name}" can supply a ${args.metric} timeseries.`,
        });
      }
      return provider.getPageTimeseries(args);
    },

    async listQueries(args) {
      if (!queryProvider?.listQueries) {
        throw new AnalyticsError({
          provider: name,
          kind: "request",
          retryable: false,
          message: `No provider behind "${name}" can list search queries.`,
        });
      }
      return queryProvider.listQueries(args);
    },
  };

  return merged;
}

/**
 * One place that decides whether an HTTP failure is worth retrying.
 *
 * Both clients in this package route their non-2xx responses through here.
 * Duplicating the classification per provider is how a 429 ends up
 * non-retryable in one client and a 401 ends up retried forever in another.
 */
export function httpError(args: {
  provider: string;
  status: number;
  detail?: string;
}): AnalyticsError {
  const { provider, status, detail } = args;
  const suffix = detail ? ` — ${detail.slice(0, 500)}` : "";

  if (status === 401 || status === 403) {
    return new AnalyticsError({
      provider,
      status,
      kind: "auth",
      retryable: false,
      message: `${provider} rejected our credentials (HTTP ${status}). Reconnect the integration; retrying will not help.${suffix}`,
    });
  }
  if (status === 429) {
    return new AnalyticsError({
      provider,
      status,
      kind: "rate_limit",
      retryable: true,
      message: `${provider} rate-limited this request (HTTP 429). Back off and retry.${suffix}`,
    });
  }
  if (status >= 500) {
    return new AnalyticsError({
      provider,
      status,
      kind: "server",
      retryable: true,
      message: `${provider} failed server-side (HTTP ${status}). Back off and retry.${suffix}`,
    });
  }
  return new AnalyticsError({
    provider,
    status,
    kind: "request",
    retryable: false,
    message: `${provider} rejected the request (HTTP ${status}). This is a bug in how we built it.${suffix}`,
  });
}

/** A transport-level failure: the request never got an answer, so it is worth retrying. */
export function networkError(provider: string, cause: unknown): AnalyticsError {
  return new AnalyticsError({
    provider,
    kind: "network",
    retryable: true,
    message: `${provider} was unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
    cause,
  });
}
