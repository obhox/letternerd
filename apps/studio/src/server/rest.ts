import { createHash } from "node:crypto";
import { registry } from "@cms/capabilities";
import { HTTP_STATUS, isCmsError, type AnyCapability } from "@cms/core";

/**
 * Routing for the public API, derived from the capability registry.
 *
 * The routes are not written out anywhere. Each capability declares its own
 * `{ method, path }`, and this module matches an incoming request against that
 * table — so a capability cannot exist without a REST route, and a REST route
 * cannot exist without a capability behind it. That is the same property the
 * MCP server gets by iterating the registry, and it is what keeps the two
 * surfaces from drifting apart as features are added.
 */

export interface MatchedRoute {
  capability: AnyCapability;
  params: Record<string, string>;
}

interface CompiledRoute {
  capability: AnyCapability;
  method: string;
  segments: string[];
}

const compiled: CompiledRoute[] = [...registry.values()].map((capability) => ({
  capability,
  method: capability.route.method,
  segments: capability.route.path.split("/").filter(Boolean),
}));

/**
 * Static segments beat parameters.
 *
 * `/documents/:id` and a hypothetical `/documents/search` both match two
 * segments, and whichever was registered first would otherwise win by
 * accident. Sorting by the number of literal segments makes the resolution
 * order a property of the routes rather than of the registry's iteration.
 */
compiled.sort(
  (a, b) =>
    b.segments.filter((s) => !s.startsWith(":")).length -
    a.segments.filter((s) => !s.startsWith(":")).length,
);

export function matchRoute(method: string, path: string[]): MatchedRoute | null {
  for (const route of compiled) {
    if (route.method !== method) continue;
    if (route.segments.length !== path.length) continue;

    const params: Record<string, string> = {};
    let ok = true;

    for (let i = 0; i < route.segments.length; i++) {
      const segment = route.segments[i]!;
      const actual = path[i]!;
      if (segment.startsWith(":")) {
        params[segment.slice(1)] = decodeURIComponent(actual);
      } else if (segment !== actual) {
        ok = false;
        break;
      }
    }

    if (ok) return { capability: route.capability, params };
  }
  return null;
}

/** Every read is ETagged so a consuming site's ISR revalidation costs a 304. */
export function etagFor(payload: unknown): string {
  const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `W/"${digest.slice(0, 24)}"`;
}

export function errorResponse(error: unknown): Response {
  if (isCmsError(error)) {
    return Response.json(
      { error: error.code, message: error.message, ...error.details },
      { status: HTTP_STATUS[error.code] },
    );
  }
  // Never leak an internal message to an unauthenticated caller.
  console.error("[api/v1] unhandled:", error);
  return Response.json({ error: "internal", message: "Something went wrong." }, { status: 500 });
}
