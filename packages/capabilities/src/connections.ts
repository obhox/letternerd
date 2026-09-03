import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { conflict, defineCapability, invalidInput, notFound, preconditionFailed } from "@cms/core";
import {
  createSearchConsoleProvider,
  isAnalyticsError,
  mergeProviders,
  refreshAccessToken,
  type AnalyticsProvider,
  type FetchLike,
} from "@cms/analytics";
import * as schema from "@cms/db/schema";
import type { Database } from "./services";

/**
 * Where the analytics credentials live, and why they are encrypted.
 *
 * Three of the six insight rules — low CTR at high impressions, near-miss
 * rankings, decaying content — cannot run at all without Search Console. They
 * are not degraded without it; they are absent, and `list_insights` names them
 * as skipped. This module is the missing half: somewhere to put a per-site
 * Google credential so `createInsightsCapabilities({ provider })` has something
 * to be handed.
 *
 * ## Hash versus encrypt, decided by what the CMS has to do with the value
 *
 * `packages/db/src/api-keys.ts` stores an API key as a SHA-256 digest, and that
 * is correct there for a specific reason: the CMS only ever has to *verify* a
 * presented key. It never needs the key back, so it never stores anything that
 * could give it back, and a stolen database yields no usable credential.
 *
 * An OAuth refresh token is not verified — it is **replayed**. The CMS posts it
 * to `https://oauth2.googleapis.com/token` to mint access tokens, which means
 * the original bytes must be recoverable. Hashing is not merely inconvenient
 * here, it is impossible: a digest cannot be presented to Google. Once
 * recoverability is a requirement, authenticated encryption is the only
 * remaining option, and the entire security of these rows collapses onto one
 * question — who can read `ANALYTICS_ENCRYPTION_KEY`.
 *
 * So the key's handling *is* the security story:
 *
 *  - It is never stored in the database it protects. A dump without it is
 *    inert; a dump with it is a live Google credential per connected site.
 *  - A missing or wrong-length key is a **construction failure**, not a
 *    fallback to plaintext. The tempting "encrypt if configured, otherwise
 *    store as-is" is how a staging misconfiguration silently writes bare
 *    refresh tokens into a table nobody will ever re-read, and the column name
 *    keeps claiming they are encrypted.
 *  - AES-256-**GCM**, not CBC. The auth tag is what makes a tampered row fail
 *    loudly instead of decrypting to plausible-looking garbage that then gets
 *    posted to Google.
 *
 * ## Nothing here ever returns a token
 *
 * `list_connections` selects an explicit column list that does not include the
 * ciphertext columns at all — the same discipline as `API_KEY_PUBLIC_COLUMNS`
 * in `settings.ts`, and for the same reason: a column that is never fetched
 * cannot leak through a log line, a serialisation, or a later refactor that
 * spreads a row.
 */

/* ------------------------------------------------------------------ */
/* Encryption — small, pure, and tested directly                       */
/* ------------------------------------------------------------------ */

const ALGORITHM = "aes-256-gcm";

/** AES-256 takes exactly this. Anything else is a configuration error. */
export const ENCRYPTION_KEY_BYTES = 32;

/**
 * 96 bits, which is GCM's specified IV size.
 *
 * Not a stylistic choice: at 12 bytes the nonce is used directly, while any
 * other length is folded through GHASH first — a slower path with a weaker
 * uniqueness argument for randomly generated nonces.
 */
const IV_BYTES = 12;

/** GCM's full-length tag. Truncating it trades away exactly the tamper detection this uses GCM for. */
const AUTH_TAG_BYTES = 16;

/** Thrown when ciphertext cannot be authenticated. Never swallowed into a plaintext fallback. */
export class TokenDecryptionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TokenDecryptionError";
  }
}

/** Thrown at construction when the configured key is absent or the wrong size. */
export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

export interface TokenCipher {
  /** Returns `iv:authTag:ciphertext`, each part base64. */
  encrypt(plaintext: string): string;
  /** Reverses `encrypt`, or throws. It never returns a partially trusted value. */
  decrypt(payload: string): string;
}

/**
 * Turns the configured key into 32 raw bytes, or refuses.
 *
 * Hex and base64 are both accepted because both are what an operator's key
 * generator prints — `openssl rand -hex 32` and `openssl rand -base64 32`.
 * Hex is tried first and only on a strict 64-character match, because a
 * 64-character hex string is *also* valid base64 (decoding to 48 bytes), and
 * guessing wrong would silently derive a different key from the same string.
 *
 * Every failure names the length it got. "Invalid key" sends an operator
 * looking for a typo; "decoded to 24 bytes, needs 32" tells them they generated
 * the key with the wrong flag.
 */
export function parseEncryptionKey(raw: string | undefined | null): Buffer {
  if (raw === undefined || raw === null || raw.trim() === "") {
    throw new EncryptionKeyError(
      "ANALYTICS_ENCRYPTION_KEY is not set. Analytics credentials are encrypted at rest and " +
        "there is no unencrypted fallback — generate one with `openssl rand -hex 32` and set it " +
        "before connecting a provider.",
    );
  }

  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");

  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new EncryptionKeyError(
      `ANALYTICS_ENCRYPTION_KEY must be ${ENCRYPTION_KEY_BYTES} bytes (64 hex characters, or ` +
        `44 base64 characters); this one decoded to ${key.length}. AES-256 has no other key size, ` +
        "so this cannot be padded or truncated into something usable.",
    );
  }

  return key;
}

/**
 * A cipher bound to one key.
 *
 * Fails here, at construction, rather than at the first encrypt. A process that
 * boots with a broken key and then fails on the one request that touches a
 * credential looks like an intermittent outage; a process that refuses to build
 * the cipher is a five-minute configuration fix.
 */
export function createTokenCipher(rawKey: string | undefined | null): TokenCipher {
  const key = parseEncryptionKey(rawKey);

  return {
    encrypt(plaintext: string): string {
      /**
       * A fresh random IV per encryption, never a counter and never derived
       * from the row.
       *
       * GCM's security argument collapses entirely if an (key, IV) pair is ever
       * reused: two ciphertexts under the same pair leak their XOR, and worse,
       * reuse allows the authentication key to be recovered — after which
       * forged ciphertexts authenticate. 96 random bits per encryption keeps
       * collision probability negligible at any volume this table will see.
       */
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const authTag = cipher.getAuthTag();

      return [
        iv.toString("base64"),
        authTag.toString("base64"),
        ciphertext.toString("base64"),
      ].join(":");
    },

    decrypt(payload: string): string {
      const parts = payload.split(":");
      if (parts.length !== 3) {
        throw new TokenDecryptionError(
          `Stored credential is not in iv:authTag:ciphertext form (${parts.length} parts).`,
        );
      }

      const [ivPart, tagPart, bodyPart] = parts as [string, string, string];
      const iv = Buffer.from(ivPart, "base64");
      const authTag = Buffer.from(tagPart, "base64");
      const ciphertext = Buffer.from(bodyPart, "base64");

      // Checked before handing anything to `createDecipheriv`, which throws a
      // node-internal message that says nothing about which part is wrong.
      if (iv.length !== IV_BYTES) {
        throw new TokenDecryptionError(
          `Stored credential has a ${iv.length}-byte IV; ${IV_BYTES} expected.`,
        );
      }
      if (authTag.length !== AUTH_TAG_BYTES) {
        throw new TokenDecryptionError(
          `Stored credential has a ${authTag.length}-byte auth tag; ${AUTH_TAG_BYTES} expected.`,
        );
      }

      const decipher = createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);

      try {
        /**
         * `final()` is where the tag is verified, and it throws on mismatch.
         *
         * This is the whole reason for GCM over CBC. Any modification to the
         * ciphertext, the IV or the tag lands here as an exception rather than
         * as bytes that decode to something — and "something" would be posted
         * to Google as a refresh token, or worse, written back to the row.
         */
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      } catch (cause) {
        throw new TokenDecryptionError(
          "Stored credential failed authentication. It was modified, truncated, or encrypted " +
            "under a different ANALYTICS_ENCRYPTION_KEY. It cannot be recovered; disconnect and " +
            "reconnect the provider.",
          { cause },
        );
      }
    },
  };
}

/**
 * The process-wide cipher, built once from the environment.
 *
 * Capabilities elsewhere in this package read nothing from the environment —
 * everything arrives through `services`. This is the deliberate exception, and
 * it is narrow: the key is not a per-request dependency, it is a property of
 * the deployment, and threading it through `CapabilityServices` would put a
 * live AES key into a structure that four transports construct, log around and
 * pass to fakes. The seam for tests is the `rawKey` parameter, which every test
 * uses instead of touching `process.env`.
 */
let cachedCipher: { rawKey: string; cipher: TokenCipher } | undefined;

export function analyticsTokenCipher(
  rawKey: string | undefined = process.env["ANALYTICS_ENCRYPTION_KEY"],
): TokenCipher {
  if (cachedCipher !== undefined && cachedCipher.rawKey === rawKey) return cachedCipher.cipher;
  const cipher = createTokenCipher(rawKey);
  // Only reached when construction succeeded, so a bad key is never cached.
  cachedCipher = { rawKey: rawKey as string, cipher };
  return cipher;
}

/* ------------------------------------------------------------------ */
/* Google credentials                                                  */
/* ------------------------------------------------------------------ */

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * The Google app this deployment is registered as, or null.
 *
 * Null rather than a throw: a CMS with no Google application configured is a
 * perfectly working CMS with three fewer insight rules, and refusing to boot
 * over it would make Search Console a hard dependency of the whole studio.
 * Every caller here treats null as "not configured" and says so in words.
 */
export function readGoogleCredentials(
  env: Record<string, string | undefined> = process.env,
): GoogleOAuthCredentials | null {
  const clientId = env["GOOGLE_CLIENT_ID"]?.trim();
  const clientSecret = env["GOOGLE_CLIENT_SECRET"]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/**
 * Refresh this far before the recorded expiry rather than at it.
 *
 * A token that expires in four seconds is a token that will expire mid-request
 * on a slow link, and the failure arrives as a 401 that looks exactly like a
 * revoked grant.
 */
const EXPIRY_SKEW_MS = 60_000;

/* ------------------------------------------------------------------ */
/* Reading connections                                                 */
/* ------------------------------------------------------------------ */

export const ANALYTICS_PROVIDERS = ["search_console", "falorb"] as const;
export type AnalyticsConnectionProvider = (typeof ANALYTICS_PROVIDERS)[number];

const providerEnum = z.enum(ANALYTICS_PROVIDERS);

/**
 * The columns a connection listing may ever select.
 *
 * Written out, exactly like `API_KEY_PUBLIC_COLUMNS` in `settings.ts`, and for
 * the identical reason: the two ciphertext columns are not merely omitted from
 * the response, they are never fetched. A `select()` followed by a `delete`
 * puts a decryptable credential into a variable that a future log line, error
 * serialiser or object spread can reach.
 */
const CONNECTION_PUBLIC_COLUMNS = {
  id: schema.siteAnalyticsConnections.id,
  provider: schema.siteAnalyticsConnections.provider,
  propertyUrl: schema.siteAnalyticsConnections.propertyUrl,
  scopes: schema.siteAnalyticsConnections.scopes,
  accessTokenExpiresAt: schema.siteAnalyticsConnections.accessTokenExpiresAt,
  connectedByUserId: schema.siteAnalyticsConnections.connectedByUserId,
  lastSyncedAt: schema.siteAnalyticsConnections.lastSyncedAt,
  lastError: schema.siteAnalyticsConnections.lastError,
  createdAt: schema.siteAnalyticsConnections.createdAt,
  updatedAt: schema.siteAnalyticsConnections.updatedAt,
} as const;

/** What a listing says about one connection. No token, encrypted or otherwise. */
export interface PublicConnection {
  id: string;
  provider: AnalyticsConnectionProvider;
  propertyUrl: string;
  scopes: string[];
  accessTokenExpiresAt: Date | null;
  connectedByUserId: string | null;
  lastSyncedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectionSummary extends PublicConnection {
  /**
   * Seconds until the current access token expires; negative when it already
   * has, null when there is no access token at all.
   *
   * Reported rather than reduced to a boolean because "expired" is not a fault
   * — the refresh token mints a new one on the next read. A screen that showed
   * a red "expired" badge for the ordinary state of an hour-old connection
   * would train its reader to ignore it.
   */
  expiresInSeconds: number | null;
}

export const listConnections = defineCapability({
  name: "list_connections",
  title: "List analytics connections",
  description:
    "Every analytics provider connected to this site: which property it points at, who connected " +
    "it, when it last synced and what went wrong if anything did. Tokens are never returned — " +
    "not in plaintext and not as ciphertext — because nothing outside this system has any use " +
    "for them. `expiresInSeconds` reports the access token's remaining life; a negative value is " +
    "normal and means the next read will refresh it.",
  input: z.object({}),
  scopes: ["site:admin"],
  role: "owner",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/settings/analytics/connections" },
  handler: async (_input, { actor, services }) => {
    const rows = (await services.db
      .select(CONNECTION_PUBLIC_COLUMNS)
      .from(schema.siteAnalyticsConnections)
      .where(eq(schema.siteAnalyticsConnections.siteId, actor.siteId))
      .orderBy(asc(schema.siteAnalyticsConnections.createdAt))) as PublicConnection[];

    const now = services.now();
    const connections: ConnectionSummary[] = rows.map((row) => ({
      ...row,
      expiresInSeconds:
        row.accessTokenExpiresAt === null
          ? null
          : Math.round((row.accessTokenExpiresAt.getTime() - now.getTime()) / 1000),
    }));

    return {
      connections,
      /** So a screen can render "not connected" for the rest without a second call. */
      availableProviders: ANALYTICS_PROVIDERS,
      /**
       * The three rules that are absent, not degraded, without a search
       * provider. Stated here so the settings screen and `list_insights`
       * coverage cannot drift into telling the reader different stories.
       */
      searchRulesUnlocked: [
        "low-ctr-high-impressions",
        "near-miss-ranking",
        "decaying-content",
      ],
    };
  },
});

/* ------------------------------------------------------------------ */
/* Connecting                                                          */
/* ------------------------------------------------------------------ */

export const connectSearchConsole = defineCapability({
  name: "connect_search_console",
  title: "Connect Google Search Console",
  description:
    "Store the result of a completed Google OAuth code exchange for this site. The refresh token " +
    "is encrypted with AES-256-GCM before it is written and is never returned by any capability; " +
    "it cannot be hashed like an API key because it has to be replayed to Google. Re-connecting " +
    "replaces the existing Search Console connection rather than adding a second one. This does " +
    "not perform the OAuth exchange — the callback route does that and passes the result here.",
  input: z.object({
    /** As Google names it. `sc-domain:example.com` is as valid as an https prefix. */
    propertyUrl: z.string().min(1).max(500),
    refreshToken: z.string().min(1).max(4096).optional(),
    accessToken: z.string().min(1).max(4096).optional(),
    /** As Google reports it: seconds from now, not an absolute time. */
    expiresInSeconds: z.number().int().min(0).max(60 * 60 * 24 * 30).optional(),
    scopes: z.array(z.string().min(1).max(200)).max(30).default([]),
  }),
  scopes: ["site:admin"],
  role: "owner",
  route: { method: "POST", path: "/settings/analytics/connections/search-console" },
  handler: async (input, { actor, services }) => {
    if (!input.refreshToken && !input.accessToken) {
      throw invalidInput(
        "A connection needs at least one token. Google issues a refresh token only when the " +
          "consent screen is opened with `access_type=offline&prompt=consent`; without one the " +
          "connection stops working within the hour and cannot renew itself.",
      );
    }

    // Built before the write, so a misconfigured key fails the request instead
    // of writing a row whose tokens cannot be read back.
    const cipher = analyticsTokenCipher();

    const now = services.now();
    const values = {
      siteId: actor.siteId,
      provider: "search_console" as const,
      propertyUrl: input.propertyUrl,
      accessTokenEncrypted: input.accessToken ? cipher.encrypt(input.accessToken) : null,
      refreshTokenEncrypted: input.refreshToken ? cipher.encrypt(input.refreshToken) : null,
      accessTokenExpiresAt:
        input.accessToken && input.expiresInSeconds !== undefined
          ? new Date(now.getTime() + input.expiresInSeconds * 1000)
          : null,
      scopes: input.scopes,
      connectedByUserId: actor.kind === "user" ? actor.id : null,
      lastError: null,
      updatedAt: now,
    };

    const [row] = (await services.db
      .insert(schema.siteAnalyticsConnections)
      .values(values)
      .onConflictDoUpdate({
        target: [
          schema.siteAnalyticsConnections.siteId,
          schema.siteAnalyticsConnections.provider,
        ],
        /**
         * A reconnect that omitted the refresh token must not blank the one on
         * file. Google withholds it on a repeat consent unless `prompt=consent`
         * is set, and overwriting a working refresh token with null would turn
         * a harmless re-authorisation into a connection that dies in an hour.
         */
        set: {
          propertyUrl: values.propertyUrl,
          accessTokenEncrypted: values.accessTokenEncrypted,
          accessTokenExpiresAt: values.accessTokenExpiresAt,
          scopes: values.scopes,
          connectedByUserId: values.connectedByUserId,
          lastError: null,
          updatedAt: now,
          ...(values.refreshTokenEncrypted === null
            ? {}
            : { refreshTokenEncrypted: values.refreshTokenEncrypted }),
        },
      })
      .returning(CONNECTION_PUBLIC_COLUMNS)) as PublicConnection[];

    if (!row) throw conflict("The Search Console connection could not be saved.");

    return {
      connection: row,
      /**
       * Deliberately not a secret to copy. Unlike an API key or a webhook
       * secret, nothing outside this system ever needs this credential, so
       * there is no "shown once" moment and no reason for the value to exist
       * anywhere a person could paste it.
       */
      storedEncrypted: true,
      notice:
        "The refresh token is encrypted at rest with AES-256-GCM and is never shown again — " +
        "nothing outside this system needs it. Revoke the grant at " +
        "https://myaccount.google.com/permissions to cut access from Google's side.",
    };
  },
});

export const disconnectConnection = defineCapability({
  name: "disconnect_connection",
  title: "Disconnect an analytics provider",
  description:
    "Delete this site's stored credentials for one provider. The insight rules that need it stop " +
    "running immediately and are reported as skipped rather than as finding nothing. This does " +
    "not revoke the grant on Google's side — do that at " +
    "https://myaccount.google.com/permissions — it only removes the copy stored here.",
  input: z.object({ provider: providerEnum }),
  scopes: ["site:admin"],
  role: "owner",
  destructive: true,
  idempotent: true,
  route: { method: "DELETE", path: "/settings/analytics/connections/:provider" },
  handler: async (input, { actor, services }) => {
    const [deleted] = (await services.db
      .delete(schema.siteAnalyticsConnections)
      .where(
        and(
          eq(schema.siteAnalyticsConnections.siteId, actor.siteId),
          eq(schema.siteAnalyticsConnections.provider, input.provider),
        ),
      )
      .returning({
        id: schema.siteAnalyticsConnections.id,
        provider: schema.siteAnalyticsConnections.provider,
        propertyUrl: schema.siteAnalyticsConnections.propertyUrl,
      })) as { id: string; provider: AnalyticsConnectionProvider; propertyUrl: string }[];

    if (!deleted) throw notFound("That provider is not connected to this site.");
    return { ...deleted, disconnected: true };
  },
});

/* ------------------------------------------------------------------ */
/* Testing a connection                                                */
/* ------------------------------------------------------------------ */

/** The row shape internal code needs, ciphertext included. Never returned to a caller. */
interface StoredConnection {
  id: string;
  provider: AnalyticsConnectionProvider;
  propertyUrl: string;
  accessTokenEncrypted: string | null;
  refreshTokenEncrypted: string | null;
  accessTokenExpiresAt: Date | null;
}

async function readStoredConnections(
  db: Database,
  siteId: string,
  provider?: AnalyticsConnectionProvider,
): Promise<StoredConnection[]> {
  const where =
    provider === undefined
      ? eq(schema.siteAnalyticsConnections.siteId, siteId)
      : and(
          eq(schema.siteAnalyticsConnections.siteId, siteId),
          eq(schema.siteAnalyticsConnections.provider, provider),
        );

  return (await db
    .select({
      id: schema.siteAnalyticsConnections.id,
      provider: schema.siteAnalyticsConnections.provider,
      propertyUrl: schema.siteAnalyticsConnections.propertyUrl,
      accessTokenEncrypted: schema.siteAnalyticsConnections.accessTokenEncrypted,
      refreshTokenEncrypted: schema.siteAnalyticsConnections.refreshTokenEncrypted,
      accessTokenExpiresAt: schema.siteAnalyticsConnections.accessTokenExpiresAt,
    })
    .from(schema.siteAnalyticsConnections)
    .where(where)) as StoredConnection[];
}

export interface UsableAccessToken {
  accessToken: string;
  /** True when this call minted it, so the caller knows a write happened. */
  refreshed: boolean;
}

/**
 * Produces a live access token for one stored connection, refreshing if needed.
 *
 * The refresh is persisted here rather than left to the caller, because the
 * alternative is minting a fresh token on every single read: a working refresh
 * that is not written down is indistinguishable from no refresh at all, except
 * in Google's quota.
 *
 * Two concurrent readers can both refresh. That is tolerated rather than locked
 * against — Google issues independent access tokens and honours both, so the
 * only cost is one wasted mint, whereas a row lock held across an outbound HTTP
 * call is a much worse failure mode when Google is slow.
 */
async function usableAccessToken(
  db: Database,
  row: StoredConnection,
  deps: {
    cipher: TokenCipher;
    google: GoogleOAuthCredentials;
    now: Date;
    fetch?: FetchLike;
  },
): Promise<UsableAccessToken> {
  const stillValid =
    row.accessTokenEncrypted !== null &&
    row.accessTokenExpiresAt !== null &&
    row.accessTokenExpiresAt.getTime() - deps.now.getTime() > EXPIRY_SKEW_MS;

  if (stillValid && row.accessTokenEncrypted) {
    return { accessToken: deps.cipher.decrypt(row.accessTokenEncrypted), refreshed: false };
  }

  if (row.refreshTokenEncrypted === null) {
    throw preconditionFailed(
      "This connection has no refresh token, so its access token cannot be renewed. Reconnect " +
        "the provider — the consent screen must be opened with `access_type=offline` and " +
        "`prompt=consent` for Google to issue one.",
    );
  }

  const refreshed = await refreshAccessToken({
    clientId: deps.google.clientId,
    clientSecret: deps.google.clientSecret,
    refreshToken: deps.cipher.decrypt(row.refreshTokenEncrypted),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
  });

  await db
    .update(schema.siteAnalyticsConnections)
    .set({
      accessTokenEncrypted: deps.cipher.encrypt(refreshed.accessToken),
      accessTokenExpiresAt: new Date(deps.now.getTime() + refreshed.expiresInSeconds * 1000),
      lastError: null,
      updatedAt: deps.now,
    })
    .where(eq(schema.siteAnalyticsConnections.id, row.id));

  return { accessToken: refreshed.accessToken, refreshed: true };
}

/** One short window, because this call exists to prove reachability, not to fetch data. */
function recentRange(now: Date): { start: string; end: string } {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { start: day(new Date(now.getTime() - 7 * 86_400_000)), end: day(now) };
}

function describeFailure(error: unknown): { message: string; retryable: boolean } {
  if (isAnalyticsError(error)) {
    return { message: error.message, retryable: error.retryable };
  }
  if (error instanceof TokenDecryptionError || error instanceof EncryptionKeyError) {
    return { message: error.message, retryable: false };
  }
  return {
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
  };
}

export const testConnection = defineCapability({
  name: "test_connection",
  title: "Test an analytics connection",
  description:
    "Decrypt this site's stored credentials, renew the access token if it has expired, and make " +
    "one real request to the provider. Records the outcome on the connection — `lastSyncedAt` on " +
    "success, `lastError` on failure — so the settings screen reports the last known state " +
    "rather than an optimistic one. Returns a verdict, never a token.",
  input: z.object({ provider: providerEnum.default("search_console") }),
  scopes: ["site:admin"],
  role: "owner",
  route: { method: "POST", path: "/settings/analytics/connections/:provider/test" },
  handler: async (input, { actor, services }) => {
    const [row] = await readStoredConnections(services.db, actor.siteId, input.provider);
    if (!row) throw notFound("That provider is not connected to this site.");

    if (input.provider !== "search_console") {
      throw preconditionFailed(
        `There is no client for "${input.provider}" connections yet, so this one cannot be tested.`,
      );
    }

    const google = readGoogleCredentials();
    if (!google) {
      throw preconditionFailed(
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not configured on this deployment, so a " +
          "stored Google credential cannot be renewed or used.",
      );
    }

    const now = services.now();

    try {
      const cipher = analyticsTokenCipher();
      const { accessToken, refreshed } = await usableAccessToken(services.db, row, {
        cipher,
        google,
        now,
      });

      const provider = createSearchConsoleProvider({
        siteUrl: row.propertyUrl,
        accessToken,
        // One row is enough to prove the property is reachable and the grant
        // covers it; asking for 25,000 would spend real quota on a health check.
        pageSize: 1,
      });

      const rows = await provider.listPagePerformance({ range: recentRange(now), limit: 1 });

      await services.db
        .update(schema.siteAnalyticsConnections)
        .set({ lastSyncedAt: now, lastError: null, updatedAt: now })
        .where(eq(schema.siteAnalyticsConnections.id, row.id));

      return {
        ok: true,
        provider: input.provider,
        propertyUrl: row.propertyUrl,
        checkedAt: now,
        accessTokenRefreshed: refreshed,
        /**
         * Zero rows is a pass, not a failure. A property verified yesterday
         * genuinely has no search data yet, and calling that a broken
         * connection would send someone to re-authorise a working grant.
         */
        rowsSeen: rows.length,
        message:
          rows.length > 0
            ? `Search Console answered for ${row.propertyUrl}.`
            : `Search Console answered for ${row.propertyUrl}, with no rows in the last 7 days. ` +
              "The connection works; the property has no search data for that window yet.",
      };
    } catch (error) {
      const failure = describeFailure(error);

      await services.db
        .update(schema.siteAnalyticsConnections)
        .set({ lastError: failure.message, updatedAt: now })
        .where(eq(schema.siteAnalyticsConnections.id, row.id))
        // The verdict is the point of this call; failing to record it must not
        // replace a useful diagnosis with a database error.
        .catch(() => {});

      return {
        ok: false,
        provider: input.provider,
        propertyUrl: row.propertyUrl,
        checkedAt: now,
        accessTokenRefreshed: false,
        rowsSeen: 0,
        retryable: failure.retryable,
        message: failure.message,
      };
    }
  },
});

/* ------------------------------------------------------------------ */
/* The bridge to the insight rules                                     */
/* ------------------------------------------------------------------ */

export interface ResolveProviderOptions {
  /** Defaults to the process cipher. Tests pass their own key. */
  cipher?: TokenCipher;
  /** Defaults to the environment. `null` means "explicitly not configured". */
  google?: GoogleOAuthCredentials | null;
  now?: () => Date;
  fetch?: FetchLike;
}

/**
 * A ready analytics provider for one site, or null.
 *
 * This is the function that closes the gap `insights.ts` documents: hand its
 * result to `createInsightsCapabilities({ provider })` and the three search
 * rules start running. It is deliberately **not** wired in from here — the
 * registry is assembled in `index.ts`, and a module that both defines
 * capabilities and reaches into another module's factory is a cycle waiting to
 * happen.
 *
 * ## It never throws
 *
 * Every path that cannot produce a provider returns null: no connection row, no
 * Google application configured, no encryption key, ciphertext that will not
 * authenticate, a refresh token Google has revoked. That is not swallowing
 * errors, and it is the opposite of the "0 impressions" trap the analytics
 * package warns about — null means `list_insights` reports those three rules as
 * *skipped, with a reason*, which is an honest and actionable screen. Throwing
 * would take down the whole insights page, including the first-party rules that
 * need no credentials at all, on a site whose only fault is that nobody has
 * connected Google yet.
 *
 * A failure that is worth a human's attention is still recorded on the row, so
 * the settings screen can show it.
 */
export async function resolveProviderForSite(
  db: Database,
  siteId: string,
  options: ResolveProviderOptions = {},
): Promise<AnalyticsProvider | null> {
  const now = (options.now ?? (() => new Date()))();

  let rows: StoredConnection[];
  try {
    rows = await readStoredConnections(db, siteId);
  } catch {
    return null;
  }
  if (rows.length === 0) return null;

  let cipher: TokenCipher;
  try {
    cipher = options.cipher ?? analyticsTokenCipher();
  } catch {
    // No key: the ciphertext is unreadable and there is nothing to fall back to.
    return null;
  }

  const google = options.google === undefined ? readGoogleCredentials() : options.google;
  const providers: AnalyticsProvider[] = [];

  for (const row of rows) {
    /**
     * Only Search Console resolves today.
     *
     * A Falorb row can be *stored* — the enum and the table allow it, so
     * connecting one later needs no migration — but constructing
     * `createFalorbProvider` needs an instance origin, and there is no column
     * and no configured value for one. Inventing a default here would produce
     * a provider that fails every call with a DNS error, which reads as an
     * outage rather than as "this was never configured".
     */
    if (row.provider !== "search_console") continue;
    if (!google) continue;

    try {
      const { accessToken } = await usableAccessToken(db, row, {
        cipher,
        google,
        now,
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });

      providers.push(
        createSearchConsoleProvider({
          siteUrl: row.propertyUrl,
          accessToken,
          ...(options.fetch ? { fetch: options.fetch } : {}),
        }),
      );
    } catch (error) {
      // Recorded, then skipped. The insights screen degrades to first-party
      // rules; the settings screen says why.
      const failure = describeFailure(error);
      await db
        .update(schema.siteAnalyticsConnections)
        .set({ lastError: failure.message, updatedAt: now })
        .where(eq(schema.siteAnalyticsConnections.id, row.id))
        .catch(() => {});
    }
  }

  if (providers.length === 0) return null;
  // `mergeProviders` joins several sources by path without inventing values;
  // with one source it would only decorate the name, so it is used only when
  // there is genuinely more than one.
  return providers.length === 1 ? (providers[0] as AnalyticsProvider) : mergeProviders(providers);
}

export const connectionsCapabilities = [
  listConnections,
  connectSearchConsole,
  disconnectConnection,
  testConnection,
];
