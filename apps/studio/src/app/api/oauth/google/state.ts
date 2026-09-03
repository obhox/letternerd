import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The `state` parameter, made trustworthy.
 *
 * ## What an unprotected callback actually costs
 *
 * The usual telling of OAuth CSRF is "an attacker makes the victim's browser
 * complete a flow". Here the consequence is specific and quiet: `state` is
 * where this application remembers *which site* the consent screen was opened
 * for. If the callback simply believes it, anyone can hand a signed-in owner a
 * link whose state names **their** siteId while the Google account being
 * connected is the **attacker's**. The victim's site then reads the attacker's
 * Search Console property, and every insight the editor acts on afterwards —
 * every "rewrite this title", every "this page is decaying" — is about a site
 * they have never seen. Nothing errors. Nothing looks wrong.
 *
 * So the siteId in the callback must be something this server said, not
 * something the request said. An HMAC over the payload is what makes that true.
 *
 * ## Three separate checks, none of which replaces the others
 *
 *  1. **The signature** proves this server minted the payload. Verified before
 *     any field is read — including `issuedAt`, since an attacker controls
 *     every byte of an unverified payload and would simply set it to now.
 *  2. **The nonce**, echoed in an httpOnly cookie that the callback clears,
 *     makes a state single-use. The signature cannot do this: it stays valid
 *     for the whole TTL by construction, so a state captured from a referer
 *     header, a proxy log or a shared URL would replay happily.
 *  3. **The userId**, checked against the live session, stops one person's
 *     consent from being pasted into another person's browser.
 *
 * This lives in the studio rather than in `@cms/capabilities` because it is an
 * HTTP concern signed with `BETTER_AUTH_SECRET` — a value that belongs to this
 * deployment's session layer. The capability package has no routes and no
 * notion of a redirect.
 */

export interface OAuthStatePayload {
  /** The site the consent screen was opened for. */
  siteId: string;
  /**
   * The same site's URL slug, carried so the callback never has to take one
   * from a query parameter. A slug the request supplies is a slug an attacker
   * chooses, which is the whole attack this envelope exists to close.
   */
  siteSlug: string;
  /** The user who opened it. Re-checked against the callback's session. */
  userId: string;
  /** Single-use, and also echoed in a cookie so a replayed state fails. */
  nonce: string;
  /** Epoch milliseconds. States are short-lived; a stale one is refused. */
  issuedAt: number;
}

/** Longer than any real consent screen, shorter than any useful replay window. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/** A minute of tolerance for clock skew between whatever signed and whatever verifies. */
const FUTURE_SKEW_MS = 60_000;

export class OAuthStateSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthStateSecretError";
  }
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input as never).toString("base64url");
}

function hmac(secret: string, message: string): Buffer {
  return createHmac("sha256", secret).update(message).digest();
}

/** `<base64url(payload)>.<base64url(hmac)>`. */
export function signOAuthState(secret: string, payload: OAuthStatePayload): string {
  if (secret.length < 32) {
    /**
     * The same bar `env.ts` holds `BETTER_AUTH_SECRET` to, restated because
     * this is a second thing that secret protects. A short key here is a
     * forgeable state, and a forgeable state is exactly the attack above.
     */
    throw new OAuthStateSecretError(
      "The OAuth state signing secret must be at least 32 characters.",
    );
  }
  const body = base64url(JSON.stringify(payload));
  return `${body}.${base64url(hmac(secret, body))}`;
}

export type OAuthStateFailure =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "nonce_mismatch"
  | "user_mismatch";

export type OAuthStateResult =
  | { ok: true; payload: OAuthStatePayload }
  | { ok: false; reason: OAuthStateFailure };

/**
 * Verifies a returned state against what this server already knows.
 *
 * A result rather than a throw: the callback turns each reason into a different
 * message for the person staring at a failed connection, and an exception would
 * flatten "your consent screen sat open too long" into the same 500 as "someone
 * forged this".
 */
export function verifyOAuthState(
  secret: string,
  raw: string | null | undefined,
  expected: { nonce: string | null | undefined; userId: string; now: Date },
): OAuthStateResult {
  if (!raw) return { ok: false, reason: "malformed" };

  const dot = raw.indexOf(".");
  if (dot <= 0 || dot === raw.length - 1) return { ok: false, reason: "malformed" };

  const body = raw.slice(0, dot);
  const signature = Buffer.from(raw.slice(dot + 1), "base64url");
  const expectedSignature = hmac(secret, body);

  // Length-checked first: `timingSafeEqual` throws on a length mismatch rather
  // than returning false, and that would surface as a crash instead of a refusal.
  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(signature, expectedSignature)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: OAuthStatePayload;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as OAuthStatePayload).siteId !== "string" ||
      typeof (parsed as OAuthStatePayload).siteSlug !== "string" ||
      typeof (parsed as OAuthStatePayload).userId !== "string" ||
      typeof (parsed as OAuthStatePayload).nonce !== "string" ||
      typeof (parsed as OAuthStatePayload).issuedAt !== "number"
    ) {
      return { ok: false, reason: "malformed" };
    }
    payload = parsed as OAuthStatePayload;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (expected.now.getTime() - payload.issuedAt > OAUTH_STATE_TTL_MS) {
    return { ok: false, reason: "expired" };
  }
  if (payload.issuedAt - expected.now.getTime() > FUTURE_SKEW_MS) {
    // Issued in the future by more than clock skew explains. Not something this
    // server produced, whatever the signature says.
    return { ok: false, reason: "expired" };
  }

  if (!expected.nonce || expected.nonce !== payload.nonce) {
    return { ok: false, reason: "nonce_mismatch" };
  }
  if (expected.userId !== payload.userId) {
    return { ok: false, reason: "user_mismatch" };
  }

  return { ok: true, payload };
}

/** 192 bits. A nonce a caller could guess is a nonce that stops one replay in a million. */
export function newOAuthNonce(): string {
  return randomBytes(24).toString("base64url");
}

/** The cookie the nonce rides in, so `start` and `callback` cannot disagree on the name. */
export const OAUTH_NONCE_COOKIE = "cms_gsc_oauth_nonce";

/** Human wording for each refusal, for the screen the person lands back on. */
export const OAUTH_STATE_MESSAGES: Record<OAuthStateFailure, string> = {
  malformed: "That sign-in link was incomplete. Start the connection again.",
  bad_signature:
    "That sign-in response did not come from this studio and was rejected. Start the connection " +
    "again from the Analytics settings page.",
  expired: "The connection took too long to complete. Start it again.",
  nonce_mismatch:
    "That sign-in response had already been used, or was opened in a different browser. Start " +
    "the connection again.",
  user_mismatch:
    "That sign-in was started by a different account. Sign in as that account, or start the " +
    "connection again from this one.",
};
