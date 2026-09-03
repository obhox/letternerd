import { CmsError, codeForStatus, type CmsErrorCode } from "./errors";
import { assertSecureOrigin } from "./transport-guard";

/**
 * The transport. One place that knows about headers, caching and status codes.
 *
 * Two properties matter more than anything else here, and both are about what
 * happens on a consuming site rather than in a test:
 *
 * 1. Caching is *declared*, never inferred. Every request states its
 *    revalidation interval and its cache tags, so a Next app gets ISR and the
 *    revalidation webhook can invalidate one post rather than the whole site.
 * 2. Nothing is silently swallowed. A failed request throws a `CmsError`; the
 *    only caller allowed to convert one into an absence is `getPost`, and only
 *    for a real 404.
 */

/**
 * The cache directives Next reads off a `fetch` init.
 *
 * Declared structurally instead of imported from `next`. The core entry has to
 * run in a worker, a CLI and a test with no framework present, and an
 * `import { } from "next"` would make that impossible — while an extra property
 * on a `RequestInit` is, to every other `fetch` implementation, an object
 * property it does not read. That is the whole of the feature detection: the
 * field is always sent, and the runtime that understands it is the one that
 * acts on it.
 */
export interface NextFetchInit extends RequestInit {
  next?: { revalidate?: number | false; tags?: string[] };
}

export type FetchLike = (input: string, init?: NextFetchInit) => Promise<Response>;

export interface HttpClientOptions {
  baseUrl: string;
  key: string;
  /** Seconds. `false` means "cache indefinitely until a tag is revalidated". */
  revalidate?: number | false;
  /** Applied to every read, in addition to the per-request tags. */
  tags?: string[];
  fetch?: FetchLike;
  /** Sent as `User-Agent`, so the CMS's own logs can attribute traffic. */
  userAgent?: string;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  tags?: string[];
  revalidate?: number | false;
  signal?: AbortSignal;
  /** Skips the shared ETag cache and asks for fresh bytes. Used by preview. */
  noStore?: boolean;
}

interface CacheEntry {
  etag: string;
  payload: unknown;
}

const DEFAULT_REVALIDATE = 60;

export class HttpClient {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly fetchImpl: FetchLike;
  private readonly defaultRevalidate: number | false;
  private readonly defaultTags: string[];
  private readonly userAgent: string;

  /**
   * ETag memory, keyed by request URL.
   *
   * The API ETags every read and the point of that is a 304 rather than a
   * payload — but a 304 carries no body, so something has to remember the last
   * one. Next's own data cache does this for a Next app; this map is what makes
   * the same saving available to a plain-`fetch` caller, and what makes the
   * behaviour testable in either. It is per-client and bounded by the number of
   * distinct URLs a site actually reads, which is small.
   */
  private readonly etags = new Map<string, CacheEntry>();

  constructor(options: HttpClientOptions) {
    if (!options.baseUrl) throw new TypeError("createCmsClient: `baseUrl` is required.");
    if (!options.key) throw new TypeError("createCmsClient: `key` is required.");
    // The key goes on every request this client makes, so the scheme is checked
    // once here rather than per call — and before anything is stored.
    assertSecureOrigin(options.baseUrl, "createCmsClient: `baseUrl`");

    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.key = options.key;
    this.defaultRevalidate = options.revalidate ?? DEFAULT_REVALIDATE;
    this.defaultTags = options.tags ?? [];
    this.userAgent = options.userAgent ?? "obhox-cms-sdk";
    // Bound at construction, not at call time, so a caller can pass a wrapped
    // fetch (retries, tracing, a test double) and know it is the only one used.
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  url(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(`${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
    for (const [name, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(name, String(value));
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const method = options.method ?? "GET";
    const url = this.url(path, options.query);
    const cached = options.noStore ? undefined : this.etags.get(url);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.key}`,
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (cached) headers["If-None-Match"] = cached.etag;

    const revalidate = options.revalidate ?? this.defaultRevalidate;
    const tags = [...this.defaultTags, ...(options.tags ?? [])];

    const init: NextFetchInit = {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
      // A mutation must never be cached, and `no-store` says so to every layer
      // — Next's data cache, a CDN in front of it, and the platform fetch.
      ...(method === "GET" && !options.noStore
        ? { next: { revalidate, tags } }
        : { cache: "no-store" as RequestCache }),
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (cause) {
      // DNS failure, TLS failure, connection reset, abort. There is no status
      // and no body; the caller needs to know the CMS was not reached at all.
      throw new CmsError({
        status: 0,
        code: "network",
        message: `Could not reach the CMS at ${url}.`,
        url,
        cause,
      });
    }

    if (response.status === 304) {
      if (cached) return cached.payload as T;
      /**
       * A 304 with nothing to serve it from. It happens when two clients share
       * an upstream cache and only one of them sent the `If-None-Match` this
       * response is answering. Retrying once without the conditional header is
       * correct and terminates, because the second request cannot be
       * conditional.
       */
      return this.request<T>(path, { ...options, noStore: true });
    }

    if (!response.ok) throw await this.errorFrom(response, url);

    let payload: T;
    try {
      payload = (await response.json()) as T;
    } catch (cause) {
      throw new CmsError({
        status: response.status,
        code: "malformed_response",
        message: `The CMS returned a non-JSON body for ${url}.`,
        url,
        cause,
      });
    }

    const etag = response.headers.get("etag");
    if (etag && method === "GET") this.etags.set(url, { etag, payload });

    return payload;
  }

  /**
   * Fire-and-forget. Resolves whatever happens, including when the network
   * does not exist.
   *
   * Used only for telemetry. Recording that a bot fetched a page is worth
   * nothing next to serving that bot the page, so a failure here is dropped
   * rather than propagated — but it is dropped in exactly one function, so
   * "swallows errors" is a property of this method rather than a habit.
   */
  async send(path: string, options: RequestOptions = {}): Promise<boolean> {
    try {
      await this.request(path, { ...options, noStore: true });
      return true;
    } catch {
      return false;
    }
  }

  private async errorFrom(response: Response, url: string): Promise<CmsError> {
    let code = codeForStatus(response.status);
    let message = `The CMS returned ${response.status} for ${url}.`;
    let details: Record<string, unknown> = {};

    try {
      const body = (await response.json()) as Record<string, unknown>;
      const { error, message: apiMessage, ...rest } = body;
      if (typeof error === "string") code = error as CmsErrorCode;
      if (typeof apiMessage === "string") message = apiMessage;
      details = rest;
    } catch {
      // A proxy, a gateway or a WAF answered, not the API. The status is all
      // there is, and it is enough to classify the failure.
    }

    return new CmsError({ status: response.status, code, message, details, url });
  }
}
