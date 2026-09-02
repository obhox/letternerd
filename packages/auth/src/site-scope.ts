import {
  SCOPES,
  forbidden,
  notFound,
  unauthenticated,
  type Actor,
} from "@cms/core";
import type { SiteRole } from "@cms/core/roles";
import type { Database } from "@cms/db";
import type { VerifiedKey } from "@cms/db/api-keys";
import * as schema from "@cms/db/schema";

/**
 * The one place a request turns into a site-scoped `Actor`.
 *
 * Every query in the system filters by `actor.siteId`, so the whole tenant
 * boundary reduces to the question of where that value came from. It comes
 * from here and nowhere else: no capability input carries a site id, and no
 * handler is permitted to assemble a `siteId` filter of its own. A second
 * place that resolves a site is a second place that can get it wrong, and the
 * failure is silent — one tenant reading another's drafts looks exactly like a
 * working request.
 */

export type SiteRow = typeof schema.sites.$inferSelect;

/**
 * The shape `requireSite` needs from a better-auth session.
 *
 * Structural rather than better-auth's own session type so that the studio's
 * server actions, the REST layer and the tests can all supply one without
 * dragging a live auth instance along.
 */
export interface SessionLike {
  userId: string;
  sessionId?: string;
  activeSiteId?: string | null;
}

/**
 * A site reference is a slug unless it is unmistakably a uuid.
 *
 * Postgres raises a cast error when a `uuid` column is compared to a literal
 * that is not one, so an unguarded `id = $1` would turn "no site by that slug"
 * — an ordinary 404 — into a 500. Checking the shape first keeps the miss on
 * the not-found path where it belongs.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RequireSiteArgs {
  db: Database;
  session: SessionLike | null;
  /** Slug or uuid, as it arrived in the URL. */
  site: string;
  /** e.g. `can.publish`. Checked against the membership role, not the key. */
  capability?: (role: string) => boolean;
}

export async function requireSite(
  args: RequireSiteArgs,
): Promise<{ actor: Actor; site: SiteRow; role: SiteRole }> {
  const { db, session, site: reference, capability } = args;

  // Not signed in at all. Distinct from "signed in and not allowed" because
  // the transport turns this one into a sign-in redirect.
  if (!session) throw unauthenticated();

  const site = await db.query.sites.findFirst({
    where: (s, { eq, or }) =>
      UUID_PATTERN.test(reference)
        ? or(eq(s.id, reference), eq(s.slug, reference))
        : eq(s.slug, reference),
  });

  /**
   * Both misses below throw the same error, deliberately.
   *
   * A site that exists but that this user is not a member of must be
   * indistinguishable from one that does not exist. Answering `forbidden`
   * here would confirm the slug is real, which turns the studio URL into a
   * tenant-enumeration oracle — someone can walk a wordlist and learn every
   * customer on the install. `@cms/core/errors` documents this, and CI asserts
   * 404 specifically.
   */
  if (!site) throw notFound("Site not found.");

  const membership = await db.query.siteMembers.findFirst({
    where: (m, { and, eq }) => and(eq(m.siteId, site.id), eq(m.userId, session.userId)),
  });

  if (!membership) throw notFound("Site not found.");

  const role: SiteRole = membership.role;

  /**
   * Membership established, capability refused. `forbidden` is correct now and
   * leaks nothing: the caller already knows the site exists, because they are
   * on it.
   */
  if (capability && !capability(role)) {
    throw forbidden("You do not have permission to do that on this site.");
  }

  return {
    actor: {
      kind: "user",
      id: session.userId,
      // The resolved row's id, never the caller's reference — a slug that
      // matched is proof of nothing about which uuid the rest of the request
      // should use.
      siteId: site.id,
      role,
      /**
       * A human session carries every scope. Scopes exist to constrain API
       * keys, which are handed out to machines and cannot be asked to
       * re-authenticate; what a person may do is decided by their role. Giving
       * a session a narrower scope set would silently disable capabilities
       * that their role plainly permits.
       */
      scopes: [...SCOPES],
      /** Drafts are the studio's whole purpose. Only publishable keys are blind to them. */
      publishedOnly: false,
    },
    site,
    role,
  };
}

/**
 * Every site the user may see, for the site picker.
 *
 * Two queries rather than a join because `@cms/db` declares no Drizzle
 * relations, and a hand-written join here would be a second place that decides
 * which sites a user can see. Membership is still the only filter: sites are
 * fetched by the ids the membership rows produced, so a site with no row for
 * this user can never enter the list.
 */
export async function listMemberships(
  db: Database,
  userId: string,
): Promise<{ site: SiteRow; role: SiteRole }[]> {
  const memberships = await db.query.siteMembers.findMany({
    where: (m, { eq }) => eq(m.userId, userId),
  });
  if (memberships.length === 0) return [];

  const siteIds = memberships.map((m) => m.siteId);
  const sites = await db.query.sites.findMany({
    where: (s, { inArray }) => inArray(s.id, siteIds),
  });
  const byId = new Map(sites.map((s) => [s.id, s]));

  return memberships
    .map((m) => {
      const site = byId.get(m.siteId);
      return site ? { site, role: m.role as SiteRole } : null;
    })
    .filter((entry): entry is { site: SiteRow; role: SiteRole } => entry !== null)
    .sort((a, b) => a.site.name.localeCompare(b.site.name));
}

/**
 * The machine equivalent of `requireSite`.
 *
 * A verified key already answers every question an actor needs: it belongs to
 * exactly one site, its type fixes its role and its stored scopes have already
 * been intersected with what that type may ever hold. Nothing from the request
 * is mixed in, so — as with a session — there is no path by which a caller
 * chooses its own tenant. `KEY_ROLES` maps no key type to `owner`, which is
 * why a leaked key cannot mint further keys or change site settings.
 */
export function actorFromApiKey(key: VerifiedKey): Actor {
  return {
    kind: "api_key",
    id: key.id,
    siteId: key.siteId,
    role: key.role,
    scopes: key.scopes,
    publishedOnly: key.publishedOnly,
  };
}
