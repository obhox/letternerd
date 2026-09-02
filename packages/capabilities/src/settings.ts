import { randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import {
  conflict,
  defineCapability,
  invalidInput,
  notFound,
  preconditionFailed,
} from "@cms/core";
import { ASSIGNABLE_ROLES, INVITABLE_ROLES, type SiteRole } from "@cms/core/roles";
import { createInvitation } from "@cms/auth";
import { generateApiKey } from "@cms/db/api-keys";
import * as schema from "@cms/db/schema";
import type { Database } from "./services";

/**
 * Site administration: credentials, people and outbound hooks.
 *
 * Everything here is `owner` and `site:admin`. That is not caution for its own
 * sake — `KEY_SCOPES` in `@cms/core` deliberately withholds `site:admin` from
 * every API key type, so a leaked admin key cannot mint further keys, invite a
 * member or point a webhook at an attacker's collector. These capabilities are
 * reachable only by a person in a session, which is the property that makes
 * the key hierarchy mean anything.
 *
 * Two invariants run through this module and are tested directly:
 *
 *  1. **A site is never left without an owner.** Only an owner can add one, so
 *     a site whose last owner is demoted or removed cannot be administered by
 *     anybody ever again — no member can invite one, no key carries the scope,
 *     and recovery means someone with database access writing a row by hand.
 *     Both mutations that could cause it refuse it.
 *
 *  2. **A secret is shown exactly once, at the moment it is created.** API
 *     keys and webhook secrets are the two here. Neither is recoverable, and
 *     no listing returns either — a list that could show a secret is a secret
 *     that leaks through every screenshot, cache and audit log the list
 *     touches.
 */

/* ------------------------------------------------------------------ */
/* API keys                                                            */
/* ------------------------------------------------------------------ */

const apiKeyType = z.enum(["publishable", "read", "admin"]);

/**
 * The columns a key listing may ever select.
 *
 * Written out rather than `select()` with a delete afterwards: `keyHash` must
 * not be fetched at all, so it cannot reach a log line, a serialisation, or a
 * future field-spreading refactor. The prefix is the identifier a person uses
 * to recognise a key, and it is deliberately too short to be one.
 */
const API_KEY_PUBLIC_COLUMNS = {
  id: schema.apiKeys.id,
  name: schema.apiKeys.name,
  type: schema.apiKeys.type,
  keyPrefix: schema.apiKeys.keyPrefix,
  scopes: schema.apiKeys.scopes,
  allowedOrigins: schema.apiKeys.allowedOrigins,
  lastUsedAt: schema.apiKeys.lastUsedAt,
  expiresAt: schema.apiKeys.expiresAt,
  revokedAt: schema.apiKeys.revokedAt,
  createdAt: schema.apiKeys.createdAt,
} as const;

/** What a listing says about one key. Never the plaintext, never the digest. */
export interface PublicApiKey {
  id: string;
  name: string;
  type: string;
  keyPrefix: string;
  scopes: string[];
  allowedOrigins: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export const listApiKeys = defineCapability({
  name: "list_api_keys",
  title: "List API keys",
  description:
    "Every API key issued for this site: its name, type, scopes, prefix and last use. " +
    "The key itself is never returned — it is stored only as a digest and was shown once, at " +
    "creation. Revoked keys are excluded unless `includeRevoked` is set; the count is always reported.",
  input: z.object({ includeRevoked: z.boolean().default(false) }),
  scopes: ["site:admin"],
  role: "owner",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/settings/api-keys" },
  handler: async (input, { actor, services }) => {
    const rows = (await services.db
      .select(API_KEY_PUBLIC_COLUMNS)
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.siteId, actor.siteId))
      .orderBy(asc(schema.apiKeys.createdAt))) as PublicApiKey[];

    /**
     * Partitioned here rather than filtered in SQL, which is the exception to
     * how the rest of this codebase reads.
     *
     * The row set is one site's keys — tens, not thousands — and the response
     * needs both halves anyway: hiding revoked keys without saying how many
     * there are turns "I revoked that last week" into a support question. The
     * split is over a column that is already fetched, so there is nothing here
     * a WHERE clause would protect.
     */
    const live = rows.filter((row) => row.revokedAt === null);
    const revoked = rows.filter((row) => row.revokedAt !== null);

    return {
      keys: input.includeRevoked ? rows : live,
      activeCount: live.length,
      revokedCount: revoked.length,
    };
  },
});

export const createApiKey = defineCapability({
  name: "create_api_key",
  title: "Create API key",
  description:
    "Issue a new API key and return its plaintext ONCE. The plaintext is not stored — only a " +
    "SHA-256 digest is — so it cannot be shown again, recovered or reset; a lost key must be " +
    "revoked and replaced. `publishable` keys are for browser bundles (published reads and the " +
    "analytics beacon only), `read` adds analytics reads, `admin` can write and publish content. " +
    "No key type can administer the site, so a key cannot mint further keys.",
  input: z.object({
    name: z.string().min(1).max(120),
    type: apiKeyType,
    /** Only enforced for publishable keys; see `originAllowed` in @cms/db. */
    allowedOrigins: z.array(z.string().url()).max(50).default([]),
    expiresInDays: z.number().int().min(1).max(3650).optional(),
  }),
  scopes: ["site:admin"],
  role: "owner",
  route: { method: "POST", path: "/settings/api-keys" },
  handler: async (input, { actor, services }) => {
    const issued = generateApiKey(input.type);
    const now = services.now();
    const expiresAt =
      input.expiresInDays === undefined
        ? null
        : new Date(now.getTime() + input.expiresInDays * 86_400_000);

    const [row] = (await services.db
      .insert(schema.apiKeys)
      .values({
        siteId: actor.siteId,
        name: input.name,
        type: input.type,
        keyHash: issued.keyHash,
        keyPrefix: issued.keyPrefix,
        scopes: [...issued.scopes],
        allowedOrigins: input.allowedOrigins,
        expiresAt,
        createdByUserId: actor.kind === "user" ? actor.id : null,
      })
      .returning(API_KEY_PUBLIC_COLUMNS)) as PublicApiKey[];

    if (!row) throw conflict("The API key could not be created.");

    return {
      key: row,
      /**
       * The only time this value exists outside the caller's own memory.
       *
       * Named `plaintext` rather than something softer so that every transport
       * — and the audit redactor in the studio, which matches on `key` and
       * `secret` — treats it as what it is.
       */
      plaintext: issued.plaintext,
      shownOnce: true,
      notice:
        "Copy this key now. It is stored only as a SHA-256 digest, so this is the only time it " +
        "can be shown — nobody, including this system's operators, can recover it later. If it " +
        "is lost or exposed, revoke it and create another.",
    };
  },
});

export const revokeApiKey = defineCapability({
  name: "revoke_api_key",
  title: "Revoke API key",
  description:
    "Revoke a key immediately. Every request presenting it fails from the next call onwards; " +
    "there is no grace period and no un-revoke. The row is kept so the audit trail still names " +
    "the credential that made past changes. Revoking an already-revoked key succeeds unchanged.",
  input: z.object({ id: z.string().uuid() }),
  scopes: ["site:admin"],
  role: "owner",
  destructive: true,
  idempotent: true,
  route: { method: "POST", path: "/settings/api-keys/:id/revoke" },
  handler: async (input, { actor, services }) => {
    const [existing] = (await services.db
      .select(API_KEY_PUBLIC_COLUMNS)
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.siteId, actor.siteId), eq(schema.apiKeys.id, input.id)))
      .limit(1)) as PublicApiKey[];

    if (!existing) throw notFound("API key not found.");
    // Idempotent on purpose: someone revoking a leaked key twice is someone in
    // a hurry, and an error there reads as "it did not work".
    if (existing.revokedAt !== null) return { key: existing, alreadyRevoked: true };

    const [row] = (await services.db
      .update(schema.apiKeys)
      .set({ revokedAt: services.now() })
      .where(and(eq(schema.apiKeys.siteId, actor.siteId), eq(schema.apiKeys.id, input.id)))
      .returning(API_KEY_PUBLIC_COLUMNS)) as PublicApiKey[];

    if (!row) throw notFound("API key not found.");
    return { key: row, alreadyRevoked: false };
  },
});

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

const assignableRole = z.enum(["owner", "editor", "author"]);
const invitableRole = z.enum(["editor", "author"]);

interface MemberRow {
  membershipId: string;
  userId: string;
  role: SiteRole;
  createdAt: Date;
  email: string | null;
  name: string | null;
}

/**
 * Every membership on the site, in one read.
 *
 * One query rather than a count plus a lookup, because the last-owner rule
 * needs the whole set anyway and two reads of the same table can disagree —
 * the count is taken before the other owner is removed, the lookup after, and
 * the guard passes on a site that has just lost its last owner.
 */
async function readMembers(db: Database, siteId: string): Promise<MemberRow[]> {
  return db
    .select({
      membershipId: schema.siteMembers.id,
      userId: schema.siteMembers.userId,
      role: schema.siteMembers.role,
      createdAt: schema.siteMembers.createdAt,
      email: schema.user.email,
      name: schema.user.name,
    })
    .from(schema.siteMembers)
    .leftJoin(schema.user, eq(schema.user.id, schema.siteMembers.userId))
    .where(eq(schema.siteMembers.siteId, siteId))
    .orderBy(asc(schema.siteMembers.createdAt));
}

/**
 * The rule that keeps a site administrable.
 *
 * Owner is the only role that can grant owner. Remove or demote the last one
 * and the site is permanently stuck: no member can promote anybody, no API key
 * carries `site:admin` (`KEY_SCOPES` withholds it from all three key types),
 * and no invitation can mint an owner (`INVITABLE_ROLES`). The only way back is
 * an operator writing to `site_members` directly, which on a hosted install
 * means a support ticket and a human with production database access.
 *
 * So the refusal is here, at the two mutations that can cause it, rather than
 * in the UI — the studio, the REST API and an MCP client all reach this same
 * function, and a rule enforced in only one of them is not a rule.
 */
function assertNotLastOwner(
  members: readonly { userId: string; role: SiteRole }[],
  targetUserId: string,
  action: string,
): void {
  const owners = members.filter((member) => member.role === "owner");
  const targetIsOwner = owners.some((owner) => owner.userId === targetUserId);
  if (!targetIsOwner || owners.length > 1) return;

  throw preconditionFailed(
    `This is the site's only owner, so they cannot be ${action}. Promote another member to ` +
      "owner first — a site with no owner cannot be administered by anyone and cannot be " +
      "recovered without direct database access.",
    { ownerCount: owners.length, userId: targetUserId },
  );
}

export const listMembers = defineCapability({
  name: "list_members",
  title: "List members",
  description:
    "Everyone with access to this site and their role, plus invitations that have been sent and " +
    "not yet accepted. `ownerCount` is included because the last owner cannot be demoted or " +
    "removed — a site with no owner is unrecoverable.",
  input: z.object({}),
  scopes: ["site:admin"],
  role: "owner",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/settings/members" },
  handler: async (_input, { actor, services }) => {
    const members = await readMembers(services.db, actor.siteId);

    const invitations = await services.db
      .select({
        id: schema.siteInvitations.id,
        email: schema.siteInvitations.email,
        role: schema.siteInvitations.role,
        expiresAt: schema.siteInvitations.expiresAt,
        acceptedAt: schema.siteInvitations.acceptedAt,
        createdAt: schema.siteInvitations.createdAt,
      })
      .from(schema.siteInvitations)
      .where(eq(schema.siteInvitations.siteId, actor.siteId))
      .orderBy(asc(schema.siteInvitations.createdAt));

    const now = services.now();
    const pending = invitations.filter(
      (invitation) => invitation.acceptedAt === null && invitation.expiresAt.getTime() > now.getTime(),
    );

    return {
      members,
      pendingInvitations: pending,
      ownerCount: members.filter((member) => member.role === "owner").length,
      /** So a UI can render the controls it is allowed to offer, not guess. */
      assignableRoles: ASSIGNABLE_ROLES,
      invitableRoles: INVITABLE_ROLES,
    };
  },
});

export const inviteMember = defineCapability({
  name: "invite_member",
  title: "Invite a member",
  description:
    "Send an invitation for this site and return the acceptance link ONCE — the token is stored " +
    "only as a digest and cannot be shown again. An invitation cannot grant `owner`: an emailed " +
    "link is the weakest credential in the system, so ownership stays something an existing owner " +
    "grants to an account that is already a member. The invitee must verify their email address " +
    "before the seat is granted, and only the address invited can accept.",
  input: z.object({
    email: z.string().email(),
    role: invitableRole.default("author"),
    ttlHours: z.number().int().min(1).max(720).optional(),
  }),
  scopes: ["site:admin"],
  role: "owner",
  route: { method: "POST", path: "/settings/members/invitations" },
  handler: async (input, { actor, services }) => {
    /**
     * Re-stated here even though `createInvitation` enforces it.
     *
     * The zod enum above already excludes `owner`, and `INVITABLE_ROLES` is
     * checked twice more downstream — at issuance and again at redemption. The
     * duplication is deliberate: this is the boundary where an untrusted input
     * becomes a role, and a future edit that widens the enum should have to
     * delete this line to break the rule rather than merely forget it.
     */
    if (!INVITABLE_ROLES.includes(input.role)) {
      throw invalidInput(`An invitation cannot grant the "${input.role}" role.`, {
        role: input.role,
        allowed: INVITABLE_ROLES,
      });
    }

    // An invitation for someone who already has a seat does nothing on
    // acceptance (`acceptInvitation` keeps the role they have), so refusing
    // here is the honest answer rather than sending a link that changes nothing.
    const members = await readMembers(services.db, actor.siteId);
    const normalized = input.email.trim().toLowerCase();
    if (members.some((member) => member.email?.toLowerCase() === normalized)) {
      throw conflict(`${normalized} is already a member of this site.`, { email: normalized });
    }

    const invitation = await createInvitation({
      db: services.db,
      siteId: actor.siteId,
      email: input.email,
      role: input.role,
      invitedByUserId: actor.id,
      ...(input.ttlHours === undefined ? {} : { ttlHours: input.ttlHours }),
    });

    return {
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
      /**
       * Root-relative on purpose. The studio's own origin is not a capability
       * concern — this module has no business inventing a hostname, and a
       * wrong one produces links that 404 for the person least able to debug
       * them. The caller, which knows where it is mounted, prepends its origin.
       */
      acceptPath: `/accept-invite/${invitation.token}`,
      shownOnce: true,
      notice:
        "Copy this link now — the token is stored only as a digest, so it cannot be shown again. " +
        "It expires, works once, and only for the address it was sent to.",
    };
  },
});

export const updateMemberRole = defineCapability({
  name: "update_member_role",
  title: "Change a member's role",
  description:
    "Change what a member may do on this site. Refuses to demote the site's last owner, including " +
    "yourself: nobody else could then grant ownership back, and the site would need direct " +
    "database access to recover. Promote another member to owner first.",
  input: z.object({ userId: z.string().min(1), role: assignableRole }),
  scopes: ["site:admin"],
  role: "owner",
  idempotent: true,
  route: { method: "PATCH", path: "/settings/members/:userId" },
  handler: async (input, { actor, services }) => {
    return services.db.transaction(async (tx) => {
      /**
       * Read inside the transaction, and it must be a locking read.
       *
       * Two owners demoting each other at the same moment both see two owners
       * and both pass; the site ends with none. `for("update")` makes the
       * second transaction wait and re-read, which is the only place this race
       * can be closed — the invariant spans rows, so no column constraint can
       * express it.
       */
      const members = (await tx
        .select({
          membershipId: schema.siteMembers.id,
          userId: schema.siteMembers.userId,
          role: schema.siteMembers.role,
        })
        .from(schema.siteMembers)
        .where(eq(schema.siteMembers.siteId, actor.siteId))
        .for("update")) as { membershipId: string; userId: string; role: SiteRole }[];

      const target = members.find((member) => member.userId === input.userId);
      if (!target) throw notFound("This person is not a member of this site.");

      if (target.role !== input.role) {
        assertNotLastOwner(members, input.userId, "demoted");
      }

      const [updated] = await tx
        .update(schema.siteMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(schema.siteMembers.siteId, actor.siteId),
            eq(schema.siteMembers.userId, input.userId),
          ),
        )
        .returning();

      if (!updated) throw notFound("This person is not a member of this site.");
      return {
        member: updated,
        /** True when an owner just changed their own access; the UI reloads. */
        selfChanged: input.userId === actor.id,
      };
    });
  },
});

export const removeMember = defineCapability({
  name: "remove_member",
  title: "Remove a member",
  description:
    "Revoke someone's access to this site. Their documents, revisions and audit entries are kept " +
    "and still attributed to them. Refuses to remove the site's last owner, including yourself — " +
    "a site with no owner cannot be administered by anyone and cannot be recovered without " +
    "direct database access.",
  input: z.object({ userId: z.string().min(1) }),
  scopes: ["site:admin"],
  role: "owner",
  destructive: true,
  route: { method: "DELETE", path: "/settings/members/:userId" },
  handler: async (input, { actor, services }) => {
    return services.db.transaction(async (tx) => {
      const members = (await tx
        .select({
          membershipId: schema.siteMembers.id,
          userId: schema.siteMembers.userId,
          role: schema.siteMembers.role,
        })
        .from(schema.siteMembers)
        .where(eq(schema.siteMembers.siteId, actor.siteId))
        .for("update")) as { membershipId: string; userId: string; role: SiteRole }[];

      const target = members.find((member) => member.userId === input.userId);
      if (!target) throw notFound("This person is not a member of this site.");

      assertNotLastOwner(members, input.userId, "removed");

      await tx
        .delete(schema.siteMembers)
        .where(
          and(
            eq(schema.siteMembers.siteId, actor.siteId),
            eq(schema.siteMembers.userId, input.userId),
          ),
        );

      return { userId: input.userId, removed: true, selfRemoved: input.userId === actor.id };
    });
  },
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

/**
 * The events this system emits today.
 *
 * Exported for the settings screen so the checkbox list and the deliverer
 * cannot drift into disagreement. The input below does not restrict to this
 * list — a consumer subscribing to an event we have not shipped yet simply
 * receives nothing, which is harmless, whereas a hard enum here would reject
 * a valid subscription every time a new event is added upstream of this file.
 */
export const KNOWN_WEBHOOK_EVENTS = [
  "document.published",
  "document.updated",
  "document.unpublished",
] as const;

const WEBHOOK_PUBLIC_COLUMNS = {
  id: schema.webhooks.id,
  url: schema.webhooks.url,
  events: schema.webhooks.events,
  isActive: schema.webhooks.isActive,
  createdAt: schema.webhooks.createdAt,
} as const;

interface PublicWebhook {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
}

/** Long enough that the HMAC it keys cannot be brute-forced from a delivery. */
function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export const listWebhooks = defineCapability({
  name: "list_webhooks",
  title: "List webhooks",
  description:
    "Outbound hooks for this site: where they post, which events they subscribe to and whether " +
    "they are active. The signing secret is never returned — it is shown once when the webhook is " +
    "created or its secret is rotated, and rotating it invalidates the old one immediately.",
  input: z.object({}),
  scopes: ["site:admin"],
  role: "owner",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/settings/webhooks" },
  handler: async (_input, { actor, services }) => {
    const webhooks = (await services.db
      .select(WEBHOOK_PUBLIC_COLUMNS)
      .from(schema.webhooks)
      .where(eq(schema.webhooks.siteId, actor.siteId))
      .orderBy(asc(schema.webhooks.createdAt))) as PublicWebhook[];

    return { webhooks, knownEvents: KNOWN_WEBHOOK_EVENTS };
  },
});

export const upsertWebhook = defineCapability({
  name: "upsert_webhook",
  title: "Create or update a webhook",
  description:
    "Create a webhook, or update one by id. Creating returns the signing secret ONCE; the " +
    "receiving site verifies an HMAC over the raw body with it, and it is never shown again. " +
    "Pass `rotateSecret` to issue a new one — deliveries signed with the old secret stop " +
    "verifying the moment it is rotated, so update the receiver in the same change.",
  input: z.object({
    id: z.string().uuid().optional(),
    url: z.string().url(),
    events: z.array(z.string().min(1).max(100)).min(1).max(50),
    isActive: z.boolean().default(true),
    rotateSecret: z.boolean().default(false),
  }),
  scopes: ["site:admin"],
  role: "owner",
  route: { method: "PUT", path: "/settings/webhooks" },
  handler: async (input, { actor, services }) => {
    // A hook posting over plain HTTP publishes its payload and its signature
    // to every network in the path, which makes the HMAC decorative.
    if (!input.url.startsWith("https://")) {
      throw invalidInput("A webhook URL must use https — the payload and its signature are sent in the request body.", {
        url: input.url,
      });
    }

    if (input.id === undefined) {
      const secret = generateWebhookSecret();
      const [row] = (await services.db
        .insert(schema.webhooks)
        .values({
          siteId: actor.siteId,
          url: input.url,
          secret,
          events: input.events,
          isActive: input.isActive,
        })
        .returning(WEBHOOK_PUBLIC_COLUMNS)) as PublicWebhook[];

      if (!row) throw conflict("The webhook could not be created.");
      return {
        webhook: row,
        secret,
        shownOnce: true,
        notice:
          "Copy this signing secret now. It is not shown again. The receiving site uses it to " +
          "verify the HMAC over each delivery's raw body; without it every delivery must be " +
          "treated as unauthenticated.",
      };
    }

    const secret = input.rotateSecret ? generateWebhookSecret() : undefined;

    const [row] = (await services.db
      .update(schema.webhooks)
      .set({
        url: input.url,
        events: input.events,
        isActive: input.isActive,
        ...(secret === undefined ? {} : { secret }),
      })
      .where(and(eq(schema.webhooks.siteId, actor.siteId), eq(schema.webhooks.id, input.id)))
      .returning(WEBHOOK_PUBLIC_COLUMNS)) as PublicWebhook[];

    if (!row) throw notFound("Webhook not found.");

    return {
      webhook: row,
      // `undefined`, not the stored value: an update that did not rotate has
      // no secret to report, and reading the column to echo it back would put
      // a live secret into every save response for no reason at all.
      secret,
      shownOnce: secret !== undefined,
      notice:
        secret === undefined
          ? null
          : "The old signing secret stopped working the moment this was saved. Copy the new one " +
            "into the receiving site now — it is not shown again.",
    };
  },
});

export const deleteWebhook = defineCapability({
  name: "delete_webhook",
  title: "Delete webhook",
  description:
    "Delete a webhook and its delivery history. Deliveries stop immediately and the signing " +
    "secret is gone; recreating it later issues a different secret.",
  input: z.object({ id: z.string().uuid() }),
  scopes: ["site:admin"],
  role: "owner",
  destructive: true,
  route: { method: "DELETE", path: "/settings/webhooks/:id" },
  handler: async (input, { actor, services }) => {
    const [deleted] = (await services.db
      .delete(schema.webhooks)
      .where(and(eq(schema.webhooks.siteId, actor.siteId), eq(schema.webhooks.id, input.id)))
      .returning({ id: schema.webhooks.id, url: schema.webhooks.url })) as {
      id: string;
      url: string;
    }[];

    if (!deleted) throw notFound("Webhook not found.");
    return deleted;
  },
});

export const settingsCapabilities = [
  listApiKeys,
  createApiKey,
  revokeApiKey,
  listMembers,
  inviteMember,
  updateMemberRole,
  removeMember,
  listWebhooks,
  upsertWebhook,
  deleteWebhook,
];
