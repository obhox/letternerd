/**
 * Failures the SDK reports, and the one rule they all serve: a page must never
 * render as if the CMS had answered when it did not.
 *
 * The failure mode this exists to prevent is quiet and expensive. A revoked API
 * key makes every read 401; a client that swallowed that and returned `[]`
 * would render a blog index reading "No posts yet", and a crawler that arrived
 * during the outage would index that page and hold it for weeks. So every
 * failure other than a genuine 404 on a single document throws, and the
 * consuming site's error boundary — which serves a 500 and is not indexed —
 * handles it.
 */

/** Mirrors `CmsErrorCode` in `@cms/core`, plus the two only a client can see. */
export type CmsErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "internal"
  /** The request never reached the API: DNS, TLS, connection reset, abort. */
  | "network"
  /** A 2xx whose body was not the JSON the endpoint is documented to return. */
  | "malformed_response";

export interface CmsErrorOptions {
  status: number;
  code: CmsErrorCode;
  message: string;
  /** The extra fields the API puts alongside `error` and `message`. */
  details?: Record<string, unknown>;
  url?: string;
  cause?: unknown;
}

/**
 * `retryable` is the SDK's judgement, not the API's.
 *
 * It answers one question — would sending this exact request again plausibly
 * succeed? A 429 or a 502 says yes; a 401 says no, and retrying it only turns
 * one authentication failure into three. Callers use it to decide between a
 * backoff and a hard fail, so it is a property rather than something each
 * caller re-derives from a status code.
 */
export class CmsError extends Error {
  readonly status: number;
  readonly code: CmsErrorCode;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly url: string | undefined;

  constructor(options: CmsErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CmsError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details ?? {};
    this.url = options.url;
    this.retryable = isRetryable(options.status, options.code);
  }
}

function isRetryable(status: number, code: CmsErrorCode): boolean {
  if (code === "network") return true;
  // 408 Request Timeout, 425 Too Early, 429 Too Many Requests: all transient by
  // definition. Everything else in the 4xx range is a statement about the
  // request itself, and the request will not have changed by the second try.
  if (status === 408 || status === 425 || status === 429) return true;
  return status >= 500;
}

export function isCmsError(error: unknown): error is CmsError {
  return error instanceof CmsError;
}

/**
 * Maps an HTTP status onto the vocabulary the API uses, for the case where a
 * proxy — not the API — produced the response and there is no `error` field to
 * read. A 502 from a CDN is still an outage the caller must be told about.
 */
export function codeForStatus(status: number): CmsErrorCode {
  switch (status) {
    case 401:
      return "unauthenticated";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 412:
      return "precondition_failed";
    case 422:
      return "invalid_input";
    case 429:
      return "rate_limited";
    default:
      return "internal";
  }
}
