import { actorFromApiKey } from "@cms/auth";
import { originAllowed, verifyApiKey } from "@cms/db/api-keys";
import { db, storage, now } from "@/server/services";
import { coerceQuery, errorResponse, etagFor, matchRoute } from "@/server/rest";

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

async function handle(request: Request, path: string[]): Promise<Response> {
  const header = request.headers.get("authorization");
  const presented = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  if (!presented) {
    return Response.json(
      { error: "unauthenticated", message: "Provide an API key as `Authorization: Bearer …`." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
    );
  }

  const key = await verifyApiKey(db, presented);
  if (!key) {
    // Identical answer for malformed, unknown, revoked and expired keys.
    return Response.json({ error: "unauthenticated", message: "Invalid API key." }, { status: 401 });
  }

  const origin = request.headers.get("origin");
  if (origin && !originAllowed(key, origin)) {
    /**
     * A secret or admin key arriving with an Origin header has leaked into
     * browser code. Refusing is how anyone finds out; quietly allowing it
     * would mean the leak is discovered by whoever exploits it.
     */
    return Response.json(
      { error: "forbidden", message: "This key may not be used from a browser." },
      { status: 403 },
    );
  }

  const matched = matchRoute(request.method, path);
  if (!matched) {
    return Response.json({ error: "not_found", message: "No such endpoint." }, { status: 404 });
  }

  const { capability, params } = matched;

  let body: Record<string, unknown> = {};
  if (request.method !== "GET" && request.method !== "DELETE") {
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return Response.json(
        { error: "invalid_input", message: "Request body must be JSON." },
        { status: 400 },
      );
    }
  }

  const query = coerceQuery(capability, Object.fromEntries(new URL(request.url).searchParams));
  // Path params last: a caller must not be able to override `:id` from the
  // query string and address a different row than the URL names.
  const input = { ...query, ...body, ...params };

  try {
    const data = await capability.invoke(input, {
      actor: actorFromApiKey(key),
      services: { db, storage, now },
    });

    const headers: Record<string, string> = {};
    if (capability.readOnly) {
      const etag = etagFor(data);
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, { status: 304, headers: { ETag: etag } });
      }
      headers.ETag = etag;
      headers["Cache-Control"] = "public, s-maxage=60, stale-while-revalidate=600";
    } else {
      headers["Cache-Control"] = "no-store";
    }

    if (origin && originAllowed(key, origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers.Vary = "Origin";
    }

    return Response.json(data, { headers });
  } catch (error) {
    return errorResponse(error);
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
