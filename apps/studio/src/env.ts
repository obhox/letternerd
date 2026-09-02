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
} as const;

export type Env = typeof env;
