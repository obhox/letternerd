import { createHash, randomBytes } from "node:crypto";
import {
  conflict,
  forbidden,
  invalidInput,
  notFound,
  preconditionFailed,
} from "@cms/core";
import { INVITABLE_ROLES, type SiteRole } from "@cms/core/roles";
import type { Database } from "@cms/db";
import * as schema from "@cms/db/schema";

/**
 * Site invitations: issuing a single-use link and redeeming it for a seat.
 *
 * The token is stored only as a SHA-256 digest, for the same reason API keys
 * are (`packages/db/src/api-keys.ts`): a leaked database then yields no usable
 * invitation links. SHA-256 rather than a password hash is right here too —
 * these are 256 bits of randomness, so there is no dictionary to defend
 * against, and the cost of Argon2 on every redemption would only make the
 * endpoint cheap to exhaust.
 */

/** Long enough that guessing is not a strategy; base64url so it survives a URL. */
const TOKEN_BYTES = 32;

const DEFAULT_TTL_HOURS = 72;

export function hashInvitationToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Mailbox case is not significant in practice, and an invitation refused
 * because the sender typed `Ada@` while the account holds `ada@` is a support
 * ticket, not a security win. Both sides are normalised the same way so the
 * comparison cannot be made asymmetric by whichever side is normalised first.
 */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface IssuedInvitation {
  id: string;
  siteId: string;
  email: string;
  role: SiteRole;
  /** Returned exactly once, for the link. Unrecoverable afterwards. */
  token: string;
  expiresAt: Date;
}

export interface CreateInvitationArgs {
  db: Database;
  siteId: string;
  email: string;
  role: SiteRole;
  invitedByUserId: string;
  ttlHours?: number;
}

export async function createInvitation(args: CreateInvitationArgs): Promise<IssuedInvitation> {
  const { db, siteId, invitedByUserId } = args;
  const email = normalizeEmail(args.email);
  const ttlHours = args.ttlHours ?? DEFAULT_TTL_HOURS;

  /**
   * An invitation may not mint an owner.
   *
   * Ownership carries members, API keys and site deletion, and an emailed link
   * is the weakest credential in the system — it sits in a mailbox, possibly
   * forwarded, possibly at a provider the site does not control. Promoting to
   * owner stays an action an existing owner takes against a known account, in
   * a session. `INVITABLE_ROLES` states this once; this is where it binds.
   */
  if (!INVITABLE_ROLES.includes(args.role)) {
    throw invalidInput(`An invitation cannot grant the "${args.role}" role.`, {
      role: args.role,
      allowed: INVITABLE_ROLES,
    });
  }

  if (!email.includes("@")) {
    throw invalidInput("An invitation needs an email address.", { email: args.email });
  }

  if (!Number.isFinite(ttlHours) || ttlHours <= 0) {
    throw invalidInput("An invitation must expire in the future.", { ttlHours });
  }

  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  const [row] = await db
    .insert(schema.siteInvitations)
    .values({
      siteId,
      email,
      role: args.role,
      // Only the digest is ever written. The plaintext leaves in the return
      // value and is never persisted, logged or recoverable.
      tokenHash: hashInvitationToken(token),
      expiresAt,
      invitedByUserId,
    })
    .returning();

  if (!row) throw conflict("The invitation could not be created.");

  return { id: row.id, siteId: row.siteId, email: row.email, role: row.role, token, expiresAt };
}

/**
 * Drizzle's comparison operators, taken from the query that reads the invitation.
 *
 * This package holds no direct `drizzle-orm` dependency: the ORM version is
 * `@cms/db`'s to choose, and a second copy resolved here is how one
 * transaction ends up half-built by two versions of the same query builder.
 * The relational query builder hands its operators to every `where` callback,
 * so the one statement below that needs `eq` outside a callback keeps the
 * reference the read was already given.
 */
type FindFirstArgs = NonNullable<
  Parameters<Database["query"]["siteInvitations"]["findFirst"]>[0]
>;
type QueryOperators = Parameters<
  Extract<FindFirstArgs["where"], (...a: never[]) => unknown>
>[1];

export interface AcceptInvitationArgs {
  db: Database;
  /** The plaintext from the link. */
  token: string;
  userId: string;
  userEmail: string;
  /**
   * The accepting account's stored `emailVerified` flag, read from the
   * session — not something the caller may assert on its own behalf.
   */
  emailVerified: boolean;
}

export async function acceptInvitation(
  args: AcceptInvitationArgs,
): Promise<{ siteId: string; role: SiteRole }> {
  const { db, token, userId, userEmail, emailVerified } = args;

  /**
   * An unverified address may not claim an invitation.
   *
   * This is the escalation `createAuth`'s verification policy exists to
   * prevent, and it is checked twice on purpose. Sign-up asks for nothing but
   * an address; if that address is never proved, anyone who learns that
   * `ada@example.com` has been invited can register under it and walk into
   * someone else's site. Requiring verification at sign-up closes it once;
   * refusing here closes it again, so an install that deliberately turned
   * verification off has not also opened this door.
   */
  if (!emailVerified) {
    throw forbidden("Verify your email address before accepting an invitation.");
  }

  const tokenHash = hashInvitationToken(token);

  return db.transaction(async (tx) => {
    let operators: QueryOperators | undefined;

    const invitation = await tx.query.siteInvitations.findFirst({
      where: (i, ops) => {
        operators = ops;
        // Looked up by digest, so the plaintext never reaches a query log.
        return ops.eq(i.tokenHash, tokenHash);
      },
    });

    // An unknown digest is not evidence of anything: a mistyped link and a
    // forged one get the same answer.
    if (!invitation) throw notFound("This invitation link is not valid.");

    // Single use. Checked inside the transaction so two simultaneous
    // redemptions of one link cannot both pass a stale read.
    if (invitation.acceptedAt) {
      throw conflict("This invitation has already been accepted.");
    }

    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw preconditionFailed("This invitation has expired. Ask for a new one.");
    }

    /**
     * The seat belongs to the address it was sent to.
     *
     * Without this a leaked or forwarded link is a seat for whoever opens it,
     * which is precisely the pairing the verification check above guards the
     * other half of. `forbidden` rather than `not_found` is right here: the
     * holder of a valid token already knows the invitation exists, so there is
     * nothing left to enumerate, and a bare 404 would send them hunting for a
     * broken link instead of the wrong account.
     */
    if (normalizeEmail(invitation.email) !== normalizeEmail(userEmail)) {
      throw forbidden("This invitation was sent to a different email address.");
    }

    /**
     * Re-checked at redemption, not only at issuance.
     *
     * `createInvitation` is not the only way a row can appear in this table —
     * a migration, a fixture or a direct SQL statement can — and this is the
     * point where a role becomes real permission.
     */
    if (!INVITABLE_ROLES.includes(invitation.role)) {
      throw forbidden(`An invitation cannot grant the "${invitation.role}" role.`);
    }

    await tx
      .insert(schema.siteMembers)
      .values({ siteId: invitation.siteId, userId, role: invitation.role })
      /**
       * Already a member: keep the role they have. An invitation is an offer
       * of access, not an instruction to overwrite it — accepting a stale
       * `author` invite must not demote a site's owner.
       */
      .onConflictDoNothing();

    // Set by the callback above, which the read cannot have skipped.
    if (!operators) throw conflict("The invitation could not be redeemed.");

    await tx
      .update(schema.siteInvitations)
      .set({ acceptedAt: new Date() })
      .where(operators.eq(schema.siteInvitations.id, invitation.id));

    return { siteId: invitation.siteId, role: invitation.role };
  });
}
