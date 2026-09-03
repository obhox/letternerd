import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { invokeAudited, registry } from "@cms/capabilities";
import { HTTP_STATUS, isCmsError, type Actor } from "@cms/core";
import { atLeast, type SiteRole } from "@cms/core/roles";
import { listMemberships, requireSite } from "@cms/auth";
import * as schema from "@cms/db/schema";
import { env } from "@/env";
import { getSession } from "@/lib/auth";
import { db, storage, now, limits } from "./services";

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
export interface StudioContextOptions {
  /**
   * Let a member whose role requires a second factor through without one.
   * Only the security settings page — the place enrolment happens — passes
   * this; every other screen and every server action gets the gate.
   */
  allowUnenrolled?: boolean;
}

export async function studioContext(
  siteSlug: string,
  options: StudioContextOptions = {},
): Promise<StudioContext> {
  const requestHeaders = await headers();
  const session = await getSession(requestHeaders);
  if (!session?.user) redirect(`/sign-in?redirect=/${siteSlug}`);

  try {
    const { actor, site, role } = await requireSite({
      db,
      session: { userId: session.user.id },
      site: siteSlug,
    });

    /**
     * The second-factor requirement, enforced where authorization is.
     *
     * A role that can publish to a live site or mint API keys is a role a
     * phished password must not be enough for. The check sits here rather
     * than in a layout because layouts guard navigations and this guards
     * server actions too: a browser that skips the redirect and posts an
     * action directly meets the same refusal.
     */
    const requiredRole = env.CMS_REQUIRE_2FA_ROLE;
    const enrolled = Boolean((session.user as { twoFactorEnabled?: boolean }).twoFactorEnabled);
    const securityPath = `/${site.slug}/settings/security`;
    // Trustworthy only because `src/proxy.ts` overwrites this header on every
    // branch, API routes included; a value the client sent never survives it.
    const onSecurityPage = requestHeaders.get("x-pathname") === securityPath;
    if (requiredRole && atLeast(role, requiredRole) && !enrolled && !options.allowUnenrolled && !onSecurityPage) {
      redirect(`${securityPath}?required=1`);
    }

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
    /**
     * `invokeAudited` writes the audit row for every non-read-only success,
     * with the transport named — the same wrapper REST and MCP use, so a
     * change made by a person and a change made by an agent leave the same
     * kind of trail.
     */
    const data = await invokeAudited<T>(cap, input, {
      actor: ctx.actor,
      services: { db, storage, now, limits },
      transport: "studio",
    });

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
