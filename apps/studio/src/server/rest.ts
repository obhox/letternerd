import { createHash } from "node:crypto";
import { z } from "zod";
import { registry } from "@cms/capabilities";
import { HTTP_STATUS, createLogger, isCmsError, type AnyCapability } from "@cms/core";

const log = createLogger("api.v1");

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
  log.error("unhandled error", { error });
  return Response.json({ error: "internal", message: "Something went wrong." }, { status: 500 });
}

/**
 * Query strings carry only strings; capability schemas do not.
 *
 * `?limit=20` arrives as `"20"` and fails a `z.number()` with a 422 that tells
 * the caller their perfectly correct request was invalid. Coercing here rather
 * than loosening every schema with `z.coerce` keeps the domain honest about the
 * types it wants — a number is a number when MCP sends one — and confines the
 * fact that HTTP has no types to the transport that has that problem.
 *
 * Only the two types a query string genuinely ambiguates are converted, and a
 * value that does not convert is passed through untouched so the schema, not
 * this function, produces the error message.
 */
export function coerceQuery(
  capability: AnyCapability,
  query: Record<string, string>,
): Record<string, unknown> {
  const shape = objectShapeOf(capability.input);
  if (!shape) return query;

  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(query)) {
    const target = shape[key] ? baseTypeOf(shape[key]) : undefined;

    if (target instanceof z.ZodNumber) {
      const n = Number(raw);
      out[key] = raw.trim() !== "" && Number.isFinite(n) ? n : raw;
    } else if (target instanceof z.ZodBoolean) {
      if (raw === "true" || raw === "1") out[key] = true;
      else if (raw === "false" || raw === "0") out[key] = false;
      // A bare `?missingAltOnly` is the HTML convention for "on".
      else if (raw === "") out[key] = true;
      else out[key] = raw;
    } else {
      out[key] = raw;
    }
  }
  return out;
}

function objectShapeOf(schema: z.ZodTypeAny): z.ZodRawShape | null {
  const base = unwrapEffects(schema);
  return base instanceof z.ZodObject ? (base.shape as z.ZodRawShape) : null;
}

function unwrapEffects(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (let i = 0; i < 10 && current instanceof z.ZodEffects; i++) {
    current = current.innerType();
  }
  return current;
}

/** See past `.optional()`, `.default()` and `.nullable()` to the real type. */
function baseTypeOf(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (let i = 0; i < 10; i++) {
    if (
      current instanceof z.ZodOptional ||
      current instanceof z.ZodDefault ||
      current instanceof z.ZodNullable
    ) {
      current = current._def.innerType as z.ZodTypeAny;
      continue;
    }
    break;
  }
  return current;
}
