import type { SiteRole } from "./roles";
import { can, atLeast } from "./roles";
import { forbidden } from "./errors";

/**
 * Scopes are what an API key carries; roles are what a person holds.
 *
 * A capability declares both, and both are checked. They are not redundant:
 * an admin key held by an owner still must not delete a site, because the key
 * does not carry that scope — and an owner's browser session must not publish
 * on a site where they are only an author, because the session does not carry
 * that role.
 */
export const SCOPES = [
  "content:read",
  "content:write",
  "content:publish",
  "media:read",
  "media:write",
  "taxonomy:write",
  "analytics:read",
  "analytics:write",
  "site:admin",
] as const;

export type Scope = (typeof SCOPES)[number];

export type ApiKeyType = "publishable" | "read" | "admin";

/**
 * What each key type may do.
 *
 * A publishable key ships in a browser bundle, so it gets reads and the
 * analytics beacon and nothing else. An admin key can write content but
 * deliberately cannot mint further keys or change site settings — key
 * issuance is an owner-with-a-session action, so a leaked admin key cannot
 * bootstrap itself into a permanent one.
 */
export const KEY_SCOPES: Record<ApiKeyType, readonly Scope[]> = {
  publishable: ["content:read", "media:read", "analytics:write"],
  read: ["content:read", "media:read", "analytics:write", "analytics:read"],
  admin: [
    "content:read",
    "content:write",
    "content:publish",
    "media:read",
    "media:write",
    "taxonomy:write",
    "analytics:read",
    "analytics:write",
  ],
};

/** The effective site role a key acts with. No key type maps to `owner`. */
export const KEY_ROLES: Record<ApiKeyType, SiteRole> = {
  publishable: "author",
  read: "author",
  admin: "editor",
};

export type ActorKind = "user" | "api_key" | "system";

/**
 * Who is calling, and on which site.
 *
 * `siteId` is resolved *before* dispatch — from the session's active site
 * membership, or from the API key, which belongs to exactly one site. No
 * capability input ever carries a site id, so there is no code path where a
 * caller chooses their own tenant.
 */
export interface Actor {
  kind: ActorKind;
  /** User id, API key id, or a job name for system actors. */
  id: string;
  siteId: string;
  role: SiteRole;
  scopes: readonly Scope[];
  /**
   * Publishable keys may read published documents only. Enforced in the query,
   * not after the fetch, so a handler that forgets cannot leak a draft.
   */
  publishedOnly: boolean;
  /** Propagated into the audit log and MCP progress reporting. */
  requestId?: string;
}

export function hasScope(actor: Actor, scope: Scope): boolean {
  return actor.scopes.includes(scope);
}

export function assertScope(actor: Actor, scope: Scope): void {
  if (!hasScope(actor, scope)) {
    throw forbidden(`This credential lacks the "${scope}" scope.`);
  }
}

export function assertRole(actor: Actor, required: SiteRole): void {
  if (!atLeast(actor.role, required)) {
    throw forbidden(`This action requires the "${required}" role or higher.`);
  }
}

/**
 * The document-write check, in one place.
 *
 * `can.writeOwnDocument` is the floor; ownership is the other half. Keeping
 * both halves in a single function is what stops a new call site from
 * checking only the rank and silently letting an author edit someone else's
 * draft.
 */
export function assertCanWriteDocument(
  actor: Actor,
  doc: { createdBy: string | null },
): void {
  if (can.writeAnyDocument(actor.role)) return;
  if (can.writeOwnDocument(actor.role) && doc.createdBy === actor.id) return;
  throw forbidden("You can only edit documents you created.");
}

/** For cron jobs and migrations, which act outside any session. */
export function systemActor(siteId: string, job: string): Actor {
  return {
    kind: "system",
    id: `system:${job}`,
    siteId,
    role: "owner",
    scopes: [...SCOPES],
    publishedOnly: false,
  };
}
