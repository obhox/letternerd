import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { registry } from "@cms/capabilities";
import { HTTP_STATUS, isCmsError, type Actor } from "@cms/core";
import type { SiteRole } from "@cms/core/roles";
import { listMemberships, requireSite } from "@cms/auth";
import * as schema from "@cms/db/schema";
import { getSession } from "@/lib/auth";
import { db, storage, now } from "./services";

/**
 * The bridge between the studio and the capability layer.
 *
 * Screens never touch the database and never write authorization checks. They
 * resolve a site, then call `dispatch`, which is the same path the MCP server
 * and the REST API take. That is what stops the three surfaces from drifting:
 * a rule enforced here but not there is a rule that does not exist.
 */

export type SiteRow = typeof schema.sites.$inferSelect;

export interface StudioContext {
  actor: Actor;
  site: SiteRow;
  role: SiteRole;
  userId: string;
}

/**
 * Resolve the signed-in user against a site slug from the URL.
 *
 * Membership is re-checked on every request. The session carries an
 * `activeSiteId` for convenience, but trusting it would mean a stale cookie
 * outlives a revoked membership.
 */
export async function studioContext(siteSlug: string): Promise<StudioContext> {
  const session = await getSession(await headers());
  if (!session?.user) redirect(`/sign-in?redirect=/${siteSlug}`);

  try {
    const { actor, site, role } = await requireSite({
      db,
      session: { userId: session.user.id },
      site: siteSlug,
    });
    return { actor, site, role, userId: session.user.id };
  } catch (error) {
    // A site the user cannot see is answered as missing, never as forbidden —
    // a 403 would confirm the site exists to someone with no business knowing.
    if (isCmsError(error) && error.code === "not_found") notFound();
    if (isCmsError(error) && error.code === "unauthenticated") {
      redirect(`/sign-in?redirect=/${siteSlug}`);
    }
    throw error;
  }
}

export async function currentUser() {
  const session = await getSession(await headers());
  return session?.user ?? null;
}

export async function sitesForCurrentUser() {
  const session = await getSession(await headers());
  if (!session?.user) return [];
  return listMemberships(db, session.user.id);
}

export interface DispatchResult<T> {
  ok: true;
  data: T;
}

export interface DispatchFailure {
  ok: false;
  code: string;
  status: number;
  message: string;
  details: Record<string, unknown>;
}

/**
 * Run a capability as the current actor.
 *
 * Throws nothing: server actions return this straight to a client component,
 * and an exception crossing that boundary in production is replaced by a
 * generic digest, which would strip exactly the lint findings the editor needs
 * to show. Failures are values here for that reason.
 */
export async function dispatch<T = unknown>(
  ctx: StudioContext,
  capability: string,
  input: unknown,
): Promise<DispatchResult<T> | DispatchFailure> {
  const cap = registry.get(capability);
  if (!cap) {
    throw new Error(`Unknown capability "${capability}".`);
  }

  try {
    const data = (await cap.invoke(input, {
      actor: ctx.actor,
      services: { db, storage, now },
    })) as T;

    if (!cap.readOnly) {
      // Agents and people both write through here, so the trail records which.
      await db
        .insert(schema.auditLog)
        .values({
          siteId: ctx.actor.siteId,
          actorType: ctx.actor.kind,
          actorId: ctx.actor.id,
          capability: cap.name,
          transport: "studio",
          input: redact(input),
        })
        .catch(() => {
          // Never fail a successful write because its audit row did not land.
        });
    }

    return { ok: true, data };
  } catch (error) {
    if (isCmsError(error)) {
      return {
        ok: false,
        code: error.code,
        status: HTTP_STATUS[error.code],
        message: error.message,
        details: error.details,
      };
    }
    throw error;
  }
}

/** Capability inputs can carry a whole document body; the log wants none of it. */
function redact(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string" && v.length > 200) {
      out[k] = `<${v.length} chars omitted>`;
    } else if (/token|secret|password|key/i.test(k)) {
      out[k] = "<redacted>";
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Throw-on-failure variant, for server components where a failure is a bug. */
export async function dispatchOrThrow<T = unknown>(
  ctx: StudioContext,
  capability: string,
  input: unknown,
): Promise<T> {
  const result = await dispatch<T>(ctx, capability, input);
  if (!result.ok) {
    if (result.code === "not_found") notFound();
    throw new Error(`${capability}: ${result.message}`);
  }
  return result.data;
}
