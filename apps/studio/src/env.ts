import { z } from "zod";
import { SITE_ROLES, type SiteRole } from "@cms/core/roles";

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

export const IS_PRODUCTION = process.env.NODE_ENV === "production";

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

/**
 * Values that are not secrets, whatever their length.
 *
 * Every one of these has shipped in a file somebody can read: `.env.example`,
 * the Dockerfile's build-stage placeholders, this repository's own tests. A
 * deployment that copied the example file and never replaced them boots with a
 * `CRON_SECRET` that anyone who has read the example knows — and that endpoint
 * publishes content on every site. The length rule below would pass the
 * example `BETTER_AUTH_SECRET`, which is 52 characters of prose; this list is
 * why it does not.
 *
 * Matched case-insensitively on the whole value, and additionally by a few
 * substrings that only ever appear in a placeholder.
 */
export const PLACEHOLDER_SECRETS: readonly string[] = [
  "dev-only-secret-replace-me-with-openssl-rand-base64-48",
  "dev-cron-secret",
  "dev-webhook-signing-key",
  "dev-crawler-ip-salt",
  "build-time-placeholder-not-a-real-secret-0000000000",
];

const PLACEHOLDER_FRAGMENTS = ["replace-me", "placeholder", "changeme", "change-me", "example"];

export const MIN_SECRET_LENGTH = 32;

/**
 * Whether a configured secret is strong enough to protect anything.
 *
 * Length is the floor; a known placeholder or a value made of one repeated
 * character fails regardless. This is not an entropy estimate — it is the
 * short list of mistakes that actually happen, checked where they can be
 * refused before they matter.
 */
export function secretProblem(value: string): string | null {
  if (value.length < MIN_SECRET_LENGTH) {
    return `must be at least ${MIN_SECRET_LENGTH} characters (openssl rand -hex 32)`;
  }
  const lower = value.toLowerCase();
  if (PLACEHOLDER_SECRETS.includes(lower)) return "is the placeholder from .env.example";
  if (PLACEHOLDER_FRAGMENTS.some((f) => lower.includes(f))) return "looks like a placeholder";
  if (new Set(value).size < 8) return "has almost no variety; use a generated value";
  return null;
}

/**
 * Enforced in production and merely tolerated elsewhere.
 *
 * A laptop running the seeded dev stack with `dev-cron-secret` is fine; the
 * same value on a public host is a published credential. The check keys on
 * `NODE_ENV` rather than on a flag of its own so there is no way to ask
 * production to be lenient.
 */
function strongSecret(name: string) {
  return z
    .string()
    .optional()
    .transform((raw) => raw?.trim() || undefined)
    .superRefine((value, ctx) => {
      if (value === undefined || !IS_PRODUCTION) return;
      const problem = secretProblem(value);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} ${problem}` });
    });
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),

  /**
   * Sessions are signed with this. A short secret is a forgeable cookie, and a
   * forged studio cookie publishes to somebody's live site, so the length is
   * enforced rather than merely documented — `openssl rand -base64 48`
   * comfortably clears it. In production the placeholder check applies too.
   */
  BETTER_AUTH_SECRET: z
    .string()
    .min(MIN_SECRET_LENGTH, `must be at least ${MIN_SECRET_LENGTH} characters`)
    .superRefine((value, ctx) => {
      if (!IS_PRODUCTION) return;
      const problem = secretProblem(value);
      if (problem) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }),

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
   * Whether anyone may create an account. Open by default: a new account holds
   * no membership and can do nothing until an owner invites it, and the
   * sign-up endpoint is rate limited and, in production, email-verified.
   * Set to `false` to admit only addresses that hold a live invitation.
   */
  CMS_ALLOW_SIGNUP: z.string().optional(),

  /**
   * The lowest site role that must have a second factor enrolled before the
   * studio will serve it. `owner` in production by default: an owner mints API
   * keys and publishes to live sites, and a phished owner password should not
   * be enough for either. `none` disables the requirement.
   */
  CMS_REQUIRE_2FA_ROLE: z.enum([...SITE_ROLES, "none"]).optional(),

  /**
   * The header carrying the client address behind the reverse proxy, for rate
   * limiting. Only trustworthy when the proxy overwrites it; `infra/DEPLOY.md`
   * says which value to use for which proxy.
   */
  CMS_CLIENT_IP_HEADER: z
    .string()
    .regex(/^[a-z0-9-]+$/i, "must be a header name")
    .optional(),

  /** `off` disables the studio's own request budgets. For end-to-end suites only. */
  CMS_RATE_LIMIT: z.string().optional(),

  /**
   * Bearer token the scheduler presents to `/api/cron/[job]`. Optional so a
   * studio boots without scheduled jobs, but never weak in production: that
   * endpoint publishes content across every site.
   */
  CRON_SECRET: strongSecret("CRON_SECRET"),

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
  MEDIA_MAX_UPLOAD_BYTES: z
    .string()
    .optional()
    .refine((v) => v === undefined || v.trim() === "" || (Number.isFinite(Number(v)) && Number(v) > 0), {
      message: "must be a positive number of bytes",
    }),

  /**
   * Google Search Console, and the key that protects stored credentials.
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
   * secret is stored: `secretsCipher()` in `@cms/capabilities` throws rather
   * than falling back to storing OAuth tokens or webhook signing secrets in the
   * clear. That split is intentional — booting without it is fine, storing a
   * credential without it is not, and the second failure is the one that must
   * be loud. The cipher checks the exact byte length; here only placeholder
   * values are refused.
   */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ANALYTICS_ENCRYPTION_KEY: strongSecret("ANALYTICS_ENCRYPTION_KEY"),
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

const require2faRole: SiteRole | null = (() => {
  const configured = raw.CMS_REQUIRE_2FA_ROLE ?? (IS_PRODUCTION ? "owner" : "none");
  return configured === "none" ? null : configured;
})();

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
  /** Open unless an operator closes it. */
  CMS_ALLOW_SIGNUP: optionalBoolean(raw.CMS_ALLOW_SIGNUP) ?? true,
  /** `null` means no role is required to enrol. */
  CMS_REQUIRE_2FA_ROLE: require2faRole,
  CMS_CLIENT_IP_HEADER: raw.CMS_CLIENT_IP_HEADER?.trim().toLowerCase() || "x-forwarded-for",
  CRON_SECRET: raw.CRON_SECRET,

  MEDIA_STORAGE_DRIVER: raw.MEDIA_STORAGE_DRIVER ?? "local",
  S3_ENDPOINT: raw.S3_ENDPOINT?.trim() || undefined,
  S3_REGION: raw.S3_REGION?.trim() || "auto",
  S3_BUCKET: raw.S3_BUCKET?.trim() || undefined,
  S3_ACCESS_KEY_ID: raw.S3_ACCESS_KEY_ID?.trim() || undefined,
  S3_SECRET_ACCESS_KEY: raw.S3_SECRET_ACCESS_KEY?.trim() || undefined,
  MEDIA_CDN_URL: raw.MEDIA_CDN_URL?.trim() || undefined,
  MEDIA_MAX_UPLOAD_BYTES: Number(raw.MEDIA_MAX_UPLOAD_BYTES?.trim() || 26_214_400),

  GOOGLE_CLIENT_ID: raw.GOOGLE_CLIENT_ID?.trim() || undefined,
  GOOGLE_CLIENT_SECRET: raw.GOOGLE_CLIENT_SECRET?.trim() || undefined,
  ANALYTICS_ENCRYPTION_KEY: raw.ANALYTICS_ENCRYPTION_KEY,
} as const;

export type Env = typeof env;

/**
 * The cron secret as it stands right now, or `null` if it is unusable.
 *
 * Read at call time rather than from the parsed snapshot so a rotation in the
 * container environment takes effect without a restart, and so the strength
 * rule applies to the value actually being compared: a weak secret is treated
 * as no secret at all, which makes the cron endpoint refuse everything — the
 * loud failure — instead of accepting a published credential.
 */
export function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  if (!value) return null;
  if (IS_PRODUCTION && secretProblem(value)) return null;
  return value;
}
