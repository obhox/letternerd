import { createLogger, isCmsError, type AnyCapability, type CapabilityContext } from "@cms/core";
import * as schema from "@cms/db/schema";

/**
 * The one door every transport writes through.
 *
 * `audit_log` exists so that "who published this" has an answer whether the
 * change came from a person in the studio, an agent over MCP, or a consuming
 * site's CI over REST — the schema comment says exactly that. For its first
 * release the only writer was the studio's own dispatcher, so an admin API
 * key could delete every document on a site through `/api/v1` and leave no
 * trace. This wrapper is the fix: a transport that calls `invokeAudited`
 * cannot forget to record the outcome, and a transport that calls
 * `capability.invoke` directly is now the thing a reviewer looks for.
 *
 * Only successful, non-read-only invocations are recorded. A refused call is
 * already visible as a 4xx in the request log, and recording reads would turn
 * the table into a traffic log with a per-tenant row for every ISR revalidation.
 */

export type AuditTransport = "studio" | "rest" | "mcp" | "stdio" | "cron" | "cli";

export interface AuditedContext extends CapabilityContext {
  transport: AuditTransport;
}

const log = createLogger("audit");

/**
 * Nil UUID: the marker `systemActor` uses when a sweep spans every site. The
 * table's `site_id` is a foreign key, so a row for it cannot exist; sweeps
 * mint per-site actors of their own for anything worth recording.
 */
const NO_SITE = "00000000-0000-0000-0000-000000000000";

export async function invokeAudited<T = unknown>(
  capability: AnyCapability,
  input: unknown,
  ctx: AuditedContext,
): Promise<T> {
  const { transport, ...invokeCtx } = ctx;
  const data = (await capability.invoke(input, invokeCtx)) as T;

  if (capability.readOnly || ctx.actor.siteId === NO_SITE) return data;

  try {
    await ctx.services.db.insert(schema.auditLog).values({
      siteId: ctx.actor.siteId,
      actorType: ctx.actor.kind,
      actorId: ctx.actor.id,
      capability: capability.name,
      transport,
      input: redactAuditInput(input),
    });
  } catch (error) {
    /**
     * Never fail a successful write because its audit row did not land — but
     * never lose it silently either. An audit gap that nobody can see is worse
     * than one that is at least logged where an operator will find it.
     */
    log.error("audit row was not written", {
      capability: capability.name,
      transport,
      siteId: ctx.actor.siteId,
      error: isCmsError(error) ? error.code : error,
    });
  }

  return data;
}

const SENSITIVE = /token|secret|password|key|credential|authorization/i;
const MAX_STRING = 200;
const MAX_DEPTH = 5;

/**
 * Capability inputs can carry a whole document body, or a nested credential
 * object; the log wants neither. Long strings are replaced with their length
 * and anything under a credential-shaped key is masked — recursively, because
 * a nested `{ connection: { refreshToken } }` is exactly the shape that a
 * top-level-only check lets through.
 */
export function redactAuditInput(input: unknown, depth = 0): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = redactValue(k, v, depth);
  }
  return out;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (SENSITIVE.test(key)) return "<redacted>";
  if (typeof value === "string") {
    return value.length > MAX_STRING ? `<${value.length} chars omitted>` : value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `<array of ${value.length}>`;
    return value.slice(0, 50).map((v) => redactValue(key, v, depth + 1));
  }
  if (typeof value === "object" && value !== null) {
    if (depth >= MAX_DEPTH) return "<object>";
    return redactAuditInput(value, depth + 1);
  }
  return value;
}
