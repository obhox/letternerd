import { actorFromApiKey } from "@cms/auth";
import { originAllowed, verifyApiKey, type VerifiedKey } from "@cms/db/api-keys";
import { invokeAudited } from "@cms/capabilities";
import { env } from "@/env";
import { db, storage, now, limits } from "@/server/services";
import { coerceQuery, errorResponse, etagFor, matchRoute } from "@/server/rest";
import {
  RULES,
  clientIp,
  isRateLimited,
  rateLimit,
  rateLimitHeaders,
  rateLimitedResponse,
  type RateLimitRule,
} from "@/server/rate-limit";

/**
 * The public content API.
 *
 * One handler for every capability. It authenticates a key, matches the
 * request to a capability, and invokes it — there is no per-endpoint code, and
 * therefore no endpoint that can quietly diverge from what MCP or the studio
 * does with the same operation.
 *
 * Sessions are rejected here outright. A cookie-authenticated content API is a
 * CSRF surface and a cross-tenant-read surface at the same time, so the two
 * credential namespaces are kept disjoint: keys work on /api/v1 and nowhere
 * else, sessions work everywhere else and not here.
 */

export const dynamic = "force-dynamic";

const ALLOWED_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, If-None-Match";

/**
 * Every response says it varies by credential and origin.
 *
 * The body of a read is per-tenant, and for a read or admin key it includes
 * unpublished drafts. A response that a shared cache — a CDN, a corporate
 * proxy, an edge layer in front of the container — was allowed to store and
 * serve to the next caller of the same URL would hand one tenant's drafts to
 * another. `private, no-store` says it may not be stored anywhere but the
 * client that asked; the ETag still lets that client skip a download.
 */
function baseHeaders(): Record<string, string> {
  return { "Cache-Control": "private, no-store", Vary: "Authorization, Origin" };
}

function corsHeaders(key: VerifiedKey, origin: string | null): Record<string, string> {
  if (!origin || !originAllowed(key, origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Expose-Headers": "ETag, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After",
    "Access-Control-Max-Age": "600",
  };
}

async function authenticate(
  request: Request,
): Promise<{ ok: true; key: VerifiedKey } | { ok: false; response: Response }> {
  const header = request.headers.get("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!presented) {
    return {
      ok: false,
      response: Response.json(
        { error: "unauthenticated", message: "Provide an API key as `Authorization: Bearer …`." },
        { status: 401, headers: { "WWW-Authenticate": "Bearer", ...baseHeaders() } },
      ),
    };
  }

  /**
   * Failed lookups are budgeted per source address before the second one is
   * even attempted. A 256-bit key cannot be guessed, but every attempt costs a
   * database round trip against a ten-connection pool, and an unmetered stream
   * of garbage tokens is a denial of service that needs no vulnerability.
   */
  const ip = clientIp(request, env.CMS_CLIENT_IP_HEADER);
  const attempts = isRateLimited(RULES.badCredential, ip);
  if (!attempts.allowed) {
    return { ok: false, response: rateLimitedResponse(attempts, RULES.badCredential) };
  }

  const key = await verifyApiKey(db, presented);
  if (!key) {
    // Only a failure spends the budget; a valid key is metered by its own rule.
    rateLimit(RULES.badCredential, ip);
    // Identical answer for malformed, unknown, revoked and expired keys.
    return {
      ok: false,
      response: Response.json(
        { error: "unauthenticated", message: "Invalid API key." },
        { status: 401, headers: baseHeaders() },
      ),
    };
  }
  return { ok: true, key };
}

/**
 * The budget a request draws on, decided by what the capability does.
 *
 * Reads are generous because ISR fans out; writes are tighter; the analytics
 * beacon is tightest because a publishable key — which is public by design —
 * can call it.
 */
function ruleFor(capability: { readOnly?: boolean; scopes: readonly string[] }): RateLimitRule {
  if (capability.readOnly) return RULES.v1Read;
  if (capability.scopes.includes("analytics:write") && !capability.scopes.includes("content:write")) {
    return RULES.analyticsWrite;
  }
  return RULES.v1Write;
}

async function handle(request: Request, path: string[]): Promise<Response> {
  const auth = await authenticate(request);
  if (!auth.ok) return auth.response;
  const { key } = auth;

  const origin = request.headers.get("origin");
  if (origin && !originAllowed(key, origin)) {
    /**
     * A secret or admin key arriving with an Origin header has leaked into
     * browser code, and a publishable key from an origin it was not issued to
     * is being used from somewhere it should not be. Refusing is how anyone
     * finds out; quietly allowing it would mean the leak is discovered by
     * whoever exploits it.
     */
    return Response.json(
      { error: "forbidden", message: "This key may not be used from this origin." },
      { status: 403, headers: baseHeaders() },
    );
  }

  const matched = matchRoute(request.method, path);
  if (!matched) {
    return Response.json(
      { error: "not_found", message: "No such endpoint." },
      { status: 404, headers: { ...baseHeaders(), ...corsHeaders(key, origin) } },
    );
  }

  const { capability, params } = matched;

  const rule = ruleFor(capability);
  const budget = rateLimit(rule, key.id);
  if (!budget.allowed) return rateLimitedResponse(budget, rule);

  let body: Record<string, unknown> = {};
  if (request.method !== "GET" && request.method !== "DELETE") {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_input", message: "Request body must be JSON." },
        { status: 400, headers: baseHeaders() },
      );
    }
  }

  const query = coerceQuery(capability, Object.fromEntries(new URL(request.url).searchParams));
  // Path params last: a caller must not be able to override `:id` from the
  // query string and address a different row than the URL names.
  const input = { ...query, ...body, ...params };

  try {
    const data = await invokeAudited(capability, input, {
      actor: actorFromApiKey(key),
      services: { db, storage, now, limits },
      transport: "rest",
    });

    const headers: Record<string, string> = {
      ...baseHeaders(),
      ...corsHeaders(key, origin),
      ...rateLimitHeaders(budget, rule),
    };

    if (capability.readOnly) {
      const etag = etagFor(data);
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
      }
      headers.ETag = etag;
    }

    return Response.json(data, { headers });
  } catch (error) {
    const response = errorResponse(error);
    for (const [name, value] of Object.entries(baseHeaders())) response.headers.set(name, value);
    return response;
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
export async function POST(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
export async function PATCH(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
export async function PUT(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}
export async function DELETE(request: Request, ctx: Ctx) {
  return handle(request, (await ctx.params).path);
}

/**
 * CORS preflight.
 *
 * A browser sending `Authorization` preflights first, and a preflight carries
 * no credentials — so there is no key to check the origin against, and the
 * only honest answer is the set of methods and headers this endpoint speaks.
 * The origin is echoed back so the real request can proceed; that request is
 * then authenticated and its origin checked against the key's allowlist, which
 * is where a wrong origin is actually refused. A preflight that said yes to
 * everything and a request that says no to the wrong origin is the standard
 * shape, because the preflight cannot know which key is coming.
 */
export function OPTIONS(request: Request): Response {
  const origin = request.headers.get("origin");
  const requested = request.headers.get("access-control-request-headers");
  if (!origin) return new Response(null, { status: 204, headers: { Allow: ALLOWED_METHODS } });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Allow-Headers": requested && requested.trim() ? requested : ALLOWED_HEADERS,
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}
