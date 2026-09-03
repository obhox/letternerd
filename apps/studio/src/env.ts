import { z } from "zod";

/**
 * The studio's server environment, parsed once at import.
 *
 * Configuration is read here and nowhere else. Scattered `process.env` reads
 * are how a deployment discovers at 3am that one code path wanted
 * `CMS_STUDIO_URL` and another wanted `STUDIO_URL`: nothing fails until the
 * one request that takes the second path.
 *
 * The parse is deliberately at module scope, so a missing or malformed value
 * takes the process down on the first import rather than surfacing as a 500 on
 * every request. A server that refuses to start is a rollback and a five-minute
 * fix; a server that boots and then fails every request looks like an outage of
 * unknown cause, and by the time it is understood the previous release is gone
 * from the deploy history.
 *
 * This module is server-only. Importing it from a client component would pull
 * `DATABASE_URL` and `BETTER_AUTH_SECRET` into the browser bundle. The auth
 * client (`src/lib/auth-client.ts`) reads the one value it needs from a
 * `NEXT_PUBLIC_` variable instead, precisely to avoid that.
 */

/**
 * Anything that is not plainly false is true.
 *
 * This flag can only make the system stricter — it decides whether a new
 * account must prove its address — so an unrecognised value must not quietly
 * disable verification. `undefined` is preserved rather than coerced to
 * `false`, because `@cms/auth` treats "unset" as "required in production" and
 * flattening it here would silently take that default away.
 */
function optionalBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = raw.trim().toLowerCase();
  return !(value === "false" || value === "0" || value === "off" || value === "no");
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),

  /**
   * Sessions are signed with this. A short secret is a forgeable cookie, and a
   * forged studio cookie publishes to somebody's live site, so the length is
   * enforced rather than merely documented — `openssl rand -base64 48`
   * comfortably clears it.
   */
  BETTER_AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),

  /**
   * The origin this studio is served from. better-auth builds verification
   * links and its own callback URLs from it; if it disagrees with the real
   * origin, every emailed link points somewhere the user cannot reach.
   */
  CMS_STUDIO_URL: z.string().url(),

  CMS_TRUSTED_ORIGINS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  CMS_REQUIRE_EMAIL_VERIFICATION: z.string().optional(),

  /**
   * Media storage. Optional as a group: the local driver is a working default
   * for development, and refusing to boot without an S3 bucket would make the
   * studio unusable for anyone not yet uploading images. A misconfigured S3
   * driver surfaces on the first upload with a clear error instead.
   */
  MEDIA_STORAGE_DRIVER: z.enum(["s3", "local"]).optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  MEDIA_CDN_URL: z.string().optional(),
  MEDIA_MAX_UPLOAD_BYTES: z.string().optional(),

  /**
   * Google Search Console, and the key that protects its credentials.
   *
   * Optional as a group, and that is a deliberate product decision rather than
   * laziness. A studio with no Google application configured is a complete,
   * working studio with three fewer insight rules — the analytics settings
   * screen says which variables are missing and `list_insights` reports those
   * rules as skipped rather than as finding nothing. Making these required
   * would mean every install, including every local checkout, needs a Google
   * Cloud project before it can boot.
   *
   * `ANALYTICS_ENCRYPTION_KEY` is optional *here* and mandatory the moment a
   * connection is created: `analyticsTokenCipher()` in `@cms/capabilities`
   * throws rather than falling back to storing tokens in the clear. That split
   * is intentional — booting without it is fine, storing a Google refresh token
   * without it is not, and the second failure is the one that must be loud.
   *
   * It is not validated for length here. The one place that knows AES-256 needs
   * exactly 32 bytes is the cipher, and a second opinion in this file would
   * eventually disagree with it.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ANALYTICS_ENCRYPTION_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  /**
   * Name the variables. A dump of zod's issue tree tells an operator that
   * something is wrong with an object they never wrote; a list of names tells
   * them which lines of their environment file to look at.
   */
  const problems = parsed.error.issues.map((issue) => {
    const name = issue.path.join(".") || "(root)";
    return issue.code === "invalid_type" && issue.received === "undefined"
      ? `  ${name} is required but not set`
      : `  ${name}: ${issue.message}`;
  });

  throw new Error(
    `The studio cannot start: its environment is incomplete.\n${problems.join("\n")}\n` +
      "See .env.example for the full list and the local-development defaults.",
  );
}

const raw = parsed.data;

/**
 * Origins better-auth will accept a request from, beyond its own.
 *
 * Comma-separated because that is what a single environment variable can carry.
 * Blank entries are dropped rather than passed through: an empty string in this
 * list is not a harmless no-op, it is an origin value that some comparisons
 * treat as matching.
 */
const trustedOrigins = (raw.CMS_TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);

export const env = {
  DATABASE_URL: raw.DATABASE_URL,
  BETTER_AUTH_SECRET: raw.BETTER_AUTH_SECRET,
  CMS_STUDIO_URL: raw.CMS_STUDIO_URL,
  /** Always an array; the studio's own origin is added by `@cms/auth`. */
  CMS_TRUSTED_ORIGINS: trustedOrigins.length > 0 ? trustedOrigins : [raw.CMS_STUDIO_URL],
  RESEND_API_KEY: raw.RESEND_API_KEY?.trim() || undefined,
  EMAIL_FROM: raw.EMAIL_FROM?.trim() || undefined,
  /** `undefined` means "let `@cms/auth` decide from NODE_ENV". */
  CMS_REQUIRE_EMAIL_VERIFICATION: optionalBoolean(raw.CMS_REQUIRE_EMAIL_VERIFICATION),

  MEDIA_STORAGE_DRIVER: raw.MEDIA_STORAGE_DRIVER ?? "local",
  S3_ENDPOINT: raw.S3_ENDPOINT?.trim() || undefined,
  S3_REGION: raw.S3_REGION?.trim() || "auto",
  S3_BUCKET: raw.S3_BUCKET?.trim() || undefined,
  S3_ACCESS_KEY_ID: raw.S3_ACCESS_KEY_ID?.trim() || undefined,
  S3_SECRET_ACCESS_KEY: raw.S3_SECRET_ACCESS_KEY?.trim() || undefined,
  MEDIA_CDN_URL: raw.MEDIA_CDN_URL?.trim() || undefined,
  MEDIA_MAX_UPLOAD_BYTES: Number(raw.MEDIA_MAX_UPLOAD_BYTES ?? 26_214_400),

  GOOGLE_CLIENT_ID: raw.GOOGLE_CLIENT_ID?.trim() || undefined,
  GOOGLE_CLIENT_SECRET: raw.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  ANALYTICS_ENCRYPTION_KEY: raw.ANALYTICS_ENCRYPTION_KEY?.trim() || undefined,
} as const;

export type Env = typeof env;
