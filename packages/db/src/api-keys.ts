import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { KEY_ROLES, KEY_SCOPES, type ApiKeyType, type Scope } from "@cms/core";
import type { SiteRole } from "@cms/core/roles";
import type { Database } from "./index.js";
import * as schema from "./schema/index.js";

/**
 * Server-side API key issuance and verification.
 *
 * Keys are stored only as a SHA-256 digest; the plaintext is shown once at
 * creation and is unrecoverable afterwards. A leaked database therefore yields
 * no usable credentials.
 *
 * SHA-256 rather than a password hash is the right choice here specifically
 * because these are high-entropy random tokens, not user-chosen passwords.
 * Argon2's cost exists to defeat dictionary attacks on guessable inputs; there
 * is nothing to guess in 256 bits of randomness, and paying that cost on every
 * API request would only make the endpoint easy to exhaust.
 */

const PREFIXES: Record<ApiKeyType, string> = {
  publishable: "cms_pk_",
  read: "cms_sk_",
  admin: "cms_ak_",
};

export interface IssuedKey {
  /** Shown to the user exactly once. */
  plaintext: string;
  keyHash: string;
  keyPrefix: string;
  scopes: readonly Scope[];
}

export function generateApiKey(type: ApiKeyType): IssuedKey {
  const prefix = PREFIXES[type];
  const secret = randomBytes(32).toString("base64url");
  const plaintext = `${prefix}${secret}`;
  return {
    plaintext,
    keyHash: hashApiKey(plaintext),
    // Enough to recognise a key in a list without being enough to use it.
    keyPrefix: plaintext.slice(0, prefix.length + 6),
    scopes: KEY_SCOPES[type],
  };
}

export function hashApiKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Infer the key type from its prefix, before any database work. */
export function keyTypeOf(plaintext: string): ApiKeyType | null {
  for (const [type, prefix] of Object.entries(PREFIXES) as [ApiKeyType, string][]) {
    if (plaintext.startsWith(prefix)) return type;
  }
  return null;
}

/**
 * Compare two hashes without leaking timing information.
 *
 * The lookup below is by hash equality in SQL, which is already constant-time
 * enough in practice; this exists for callers holding a candidate hash in
 * memory.
 */
export function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface VerifiedKey {
  id: string;
  siteId: string;
  type: ApiKeyType;
  role: SiteRole;
  scopes: Scope[];
  allowedOrigins: string[];
  /** Publishable keys may never see a draft. */
  publishedOnly: boolean;
}

/**
 * Resolve a presented key to its record, or null.
 *
 * Rejects revoked and expired keys in the query itself rather than after the
 * fetch, so an expired key cannot be used through a code path that forgets to
 * check.
 */
export async function verifyApiKey(
  db: Database,
  plaintext: string,
): Promise<VerifiedKey | null> {
  const type = keyTypeOf(plaintext);
  if (!type) return null;

  const [row] = await db
    .select()
    .from(schema.apiKeys)
    .where(
      and(
        eq(schema.apiKeys.keyHash, hashApiKey(plaintext)),
        isNull(schema.apiKeys.revokedAt),
        or(isNull(schema.apiKeys.expiresAt), gt(schema.apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (!row) return null;

  // Fire-and-forget: last-used tracking must not add latency to, or fail, the
  // request being authenticated.
  void db
    .update(schema.apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(schema.apiKeys.id, row.id))
    .catch(() => {});

  return {
    id: row.id,
    siteId: row.siteId,
    type: row.type,
    role: KEY_ROLES[row.type],
    // Trust the stored scopes, intersected with what the type may ever hold,
    // so widening a type's scopes later cannot retroactively widen old keys.
    scopes: (row.scopes as Scope[]).filter((s) => KEY_SCOPES[row.type].includes(s)),
    allowedOrigins: row.allowedOrigins,
    publishedOnly: row.type === "publishable",
  };
}

/**
 * Origin check for browser-held keys.
 *
 * Only publishable keys are origin-checked, because only they are ever meant
 * to reach a browser. A secret or admin key arriving with an `Origin` header
 * at all is a sign it has leaked into client code, and the CORS layer refuses
 * it outright rather than quietly allowing the request.
 */
export function originAllowed(key: VerifiedKey, origin: string | null): boolean {
  if (key.type !== "publishable") return false;
  if (key.allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return key.allowedOrigins.includes(origin);
}
