/**
 * The error vocabulary every transport translates from.
 *
 * Capabilities throw these; the REST layer maps them to status codes, MCP maps
 * them to tool errors, and the studio maps them to toasts. Handlers never know
 * which transport invoked them, so they must never throw a Response or an
 * MCP error directly.
 */

export type CmsErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_input"
  | "conflict"
  | "precondition_failed"
  | "rate_limited"
  | "internal";

export class CmsError extends Error {
  readonly code: CmsErrorCode;
  /** Machine-readable specifics — field paths, lint findings, conflicting ids. */
  readonly details: Record<string, unknown>;

  constructor(code: CmsErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "CmsError";
    this.code = code;
    this.details = details;
  }
}

export const unauthenticated = (m = "Authentication required.") =>
  new CmsError("unauthenticated", m);

export const forbidden = (m = "You do not have permission to do that.") =>
  new CmsError("forbidden", m);

/**
 * Deliberately also used for cross-tenant access.
 *
 * Asking for a resource that belongs to another site must be indistinguishable
 * from asking for one that does not exist — a 403 would confirm the id is real,
 * which is a tenant-enumeration oracle. The isolation test in CI asserts 404
 * specifically, never 403.
 */
export const notFound = (what = "Not found.") => new CmsError("not_found", what);

export const invalidInput = (m: string, details: Record<string, unknown> = {}) =>
  new CmsError("invalid_input", m, details);

export const conflict = (m: string, details: Record<string, unknown> = {}) =>
  new CmsError("conflict", m, details);

/** Used by the publish gate when blocking lints fail. */
export const preconditionFailed = (m: string, details: Record<string, unknown> = {}) =>
  new CmsError("precondition_failed", m, details);

export const rateLimited = (m = "Too many requests.") => new CmsError("rate_limited", m);

/** HTTP status for each code, so the REST layer needs no switch of its own. */
export const HTTP_STATUS: Record<CmsErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  invalid_input: 422,
  conflict: 409,
  precondition_failed: 412,
  rate_limited: 429,
  internal: 500,
};

export function isCmsError(e: unknown): e is CmsError {
  return e instanceof CmsError;
}
