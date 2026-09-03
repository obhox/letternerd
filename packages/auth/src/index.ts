import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import pg from "pg";

export * from "./site-scope";
export * from "./invitations";

/**
 * Authentication for studio users, configured once and shared by every app
 * that has to read a session.
 *
 * Two better-auth instances configured separately drift on field mappings and
 * then quietly stop accepting each other's cookies, so there is one factory
 * and each app supplies only its own `baseURL`.
 *
 * better-auth gets its own small `pg.Pool` rather than sharing `@cms/db`'s
 * Drizzle connection. It costs a handful of connections and buys two things:
 * better-auth's schema expectations stay uncoupled from the application's ORM
 * version, and a long report or a migration holding the application pool
 * cannot starve sign-in — the one request that must keep working when the rest
 * of the system is busy.
 *
 * Field mapping is written out rather than left to a naming convention. The
 * schema in `@cms/db` is snake_case and better-auth's models are camelCase; a
 * convention that a library upgrade silently changes would turn every insert
 * into a missing-column error, and only in production, where the columns are.
 */

export interface AuthConfig {
  /** Origin this instance is mounted on, e.g. https://studio.example.com. */
  baseURL: string;
  /** Mount path. Every app exposes better-auth at /api/auth. */
  basePath?: string;
  connectionString: string;
  secret: string;
  trustedOrigins: string[];
  /** Unset means: required in production, optional everywhere else. */
  requireEmailVerification?: boolean;
  sendVerificationEmail?: (args: { to: string; url: string }) => Promise<void>;
  /**
   * Whether `/sign-up/email` accepts strangers. Unset means: open outside
   * production, closed in it — an open form on a public host is account spam
   * and verification-email spam even when no membership follows from it. An
   * address holding a live invitation may always register.
   */
  allowSignUp?: boolean;
  /**
   * The header carrying the client address behind the reverse proxy. Only
   * trustworthy when the proxy overwrites it; `x-forwarded-for` by default.
   */
  clientIpHeader?: string;
  /** Shown in authenticator apps next to the account. */
  twoFactorIssuer?: string;
}

/**
 * Whether a new account must prove its address before it counts as real.
 *
 * The tempting default is to derive this from whether a mail provider happens
 * to be configured, so that local development stays frictionless. That fails
 * open: a production install that simply never set a mail provider would
 * accept unverified addresses forever, and because accepting an invitation
 * binds a seat to an email address, an unverified account is enough to claim
 * someone else's. So production requires verification unless told otherwise in
 * so many words, and refuses to start rather than half-enforcing it — a boot
 * failure is a page and a five-minute fix, while silently accepting unverified
 * accounts is discovered by whoever exploits it.
 */
function resolveVerificationPolicy(config: AuthConfig): boolean {
  const required = config.requireEmailVerification ?? process.env.NODE_ENV === "production";

  if (required && !config.sendVerificationEmail) {
    throw new Error(
      "Email verification is required but no `sendVerificationEmail` was provided. " +
        "Supply a mail sender, or pass `requireEmailVerification: false` to accept " +
        "unverified addresses deliberately.",
    );
  }

  return required;
}

export interface SignUpPolicyArgs {
  allowSignUp: boolean;
  email: string;
  /** Whether a live, unaccepted invitation exists for the normalised address. */
  hasLiveInvitation: (email: string) => Promise<boolean>;
}

/**
 * The registration decision, separated from better-auth so it can be tested
 * without a database: open installs admit anyone, closed installs admit only
 * an address that has been invited. The refusal is an `APIError` because that
 * is what better-auth turns into a proper 403 with a stable code the sign-up
 * form can name.
 */
export async function assertSignUpPermitted(args: SignUpPolicyArgs): Promise<void> {
  if (args.allowSignUp) return;
  const email = args.email.trim().toLowerCase();
  if (email && (await args.hasLiveInvitation(email))) return;
  throw new APIError("FORBIDDEN", {
    code: "SIGNUP_BY_INVITATION_ONLY",
    message: "This studio creates accounts by invitation only.",
  });
}

export function createAuth(config: AuthConfig) {
  const requireEmailVerification = resolveVerificationPolicy(config);
  const sendVerificationEmail = config.sendVerificationEmail;

  const allowSignUp = config.allowSignUp ?? process.env.NODE_ENV !== "production";

  const pool = new pg.Pool({
    connectionString: config.connectionString,
    // Small on purpose: this pool serves sign-in and session reads and nothing
    // else, and its whole point is not to share a budget with the app's work.
    max: 5,
  });

  return betterAuth({
    database: pool,
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: config.basePath ?? "/api/auth",
    trustedOrigins: config.trustedOrigins,

    emailAndPassword: {
      enabled: true,
      // Long enough that guessing is not a strategy; better-auth hashes with scrypt.
      minPasswordLength: 10,
      maxPasswordLength: 256,
      requireEmailVerification,
      autoSignIn: true,
    },

    /**
     * Registration policy, enforced where the row is created.
     *
     * When sign-up is closed, an account may still be created for an address
     * that holds a live invitation — the invitation is the authorisation, and
     * refusing it would make "invite a colleague" impossible on exactly the
     * installs that closed sign-up for safety. A hook rather than
     * `disableSignUp`, because that flag refuses before any question can be
     * asked. The lookup is by normalised address; the invitation itself is
     * still redeemed, and its address re-checked, by `acceptInvitation`.
     */
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            await assertSignUpPermitted({
              allowSignUp,
              email: String(user.email ?? ""),
              hasLiveInvitation: async (email) => {
                const { rows } = await pool.query<{ ok: number }>(
                  "select 1 as ok from site_invitations where lower(email) = $1 and accepted_at is null and expires_at > now() limit 1",
                  [email],
                );
                return rows.length > 0;
              },
            });
          },
        },
      },
    },

    /**
     * TOTP second factor.
     *
     * Optional for everyone; the studio decides per role whether it is
     * required (`CMS_REQUIRE_2FA_ROLE`) — an owner mints API keys and
     * publishes to live sites, and a phished password should not be enough for
     * either. Backup codes are issued at enrolment for the lost-phone case.
     * The plugin stores the TOTP secret encrypted with `secret`.
     */
    plugins: [
      twoFactor({
        issuer: config.twoFactorIssuer ?? "CMS Studio",
        schema: {
          twoFactor: {
            modelName: "two_factor",
            fields: {
              userId: "user_id",
              backupCodes: "backup_codes",
              failedVerificationCount: "failed_verification_count",
              lockedUntil: "locked_until",
            },
          },
          user: { fields: { twoFactorEnabled: "two_factor_enabled" } },
        },
      }),
    ],

    emailVerification: {
      // Nothing to send when no sender exists; `resolveVerificationPolicy` has
      // already refused the combination where that would matter.
      sendOnSignUp: Boolean(sendVerificationEmail),
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail?.({ to: user.email, url });
      },
    },

    /**
     * Brute-force protection.
     *
     * Left unconfigured, better-auth applies a generic per-minute default and
     * only in production, which is no obstacle at all to a credential-stuffing
     * run against `/sign-in/email`. The rules are per-path because the useful
     * limits differ by orders of magnitude: a studio makes many session reads
     * per page and a human makes very few sign-in attempts.
     *
     * Storage is in-memory, which does not survive a restart and is not shared
     * between replicas. Scaling this horizontally means moving it to shared
     * storage first, or the effective limit multiplies by the replica count.
     */
    rateLimit: {
      /**
       * Off only when explicitly asked, for end-to-end suites, which
       * legitimately spend several sign-ins and deliberately fail others. Opt
       * out by an explicit flag, never by `NODE_ENV`, so a misconfigured
       * production cannot silently unlimit itself.
       */
      enabled: process.env.CMS_AUTH_RATE_LIMIT !== "off",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 300, max: 5 },
        "/sign-up/email": { window: 3600, max: 5 },
        "/forget-password": { window: 3600, max: 5 },
        "/reset-password": { window: 3600, max: 5 },
        "/send-verification-email": { window: 3600, max: 5 },
        // A six-digit code is guessable in a million tries; five a window is not.
        "/two-factor/verify-totp": { window: 300, max: 5 },
        "/two-factor/verify-backup-code": { window: 300, max: 5 },
        "/two-factor/enable": { window: 3600, max: 10 },
        "/two-factor/disable": { window: 3600, max: 10 },
      },
    },

    advanced: {
      /**
       * Without this every rate-limit bucket keys on the reverse proxy's
       * address — one shared bucket for everyone, which is simultaneously a
       * brute-force hole and a self-inflicted denial of service. This header
       * is only trustworthy because the proxy in front overwrites it with the
       * real peer; it must not be forwarded from anywhere else.
       */
      ipAddress: { ipAddressHeaders: [config.clientIpHeader ?? "x-forwarded-for"] },
      useSecureCookies: process.env.NODE_ENV === "production",
    },

    session: {
      modelName: "session",
      /**
       * Seven days rather than thirty, refreshed daily. A studio session can
       * publish to a customer's live site, so a stolen cookie is worth having;
       * a month of validity makes that theft effectively permanent.
       */
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      /**
       * One minute, not five. This cached cookie is what the studio's role
       * checks read, so the window is exactly how long a revoked session, a
       * removed member or a demoted editor keeps their old privileges.
       */
      cookieCache: { enabled: true, maxAge: 60 },
      fields: {
        userId: "user_id",
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        /**
         * Which site the studio is currently scoped to.
         *
         * `input: false` because this must never be settable through
         * better-auth's own endpoints: a client that could write its own
         * `activeSiteId` would be choosing its own tenant. The server writes it
         * after `requireSite` has confirmed the membership, and `requireSite`
         * re-checks membership on every request regardless — this column is a
         * convenience, not an authorization.
         */
        activeSiteId: {
          type: "string",
          fieldName: "active_site_id",
          required: false,
          input: false,
        },
      },
    },

    user: {
      modelName: "user",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        /**
         * Operator escape hatch for this deployment's own administrators.
         *
         * `input: false` is the whole security of it: were this settable at
         * sign-up, anyone could register as a platform administrator. It is
         * granted by an operator with database access, and it grants no
         * content permission on its own — only the cross-site operational
         * screens. Site permissions still come from `siteMembers`.
         */
        isPlatformAdmin: {
          type: "boolean",
          fieldName: "is_platform_admin",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },

    account: {
      modelName: "account",
      fields: {
        userId: "user_id",
        accountId: "account_id",
        providerId: "provider_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    verification: {
      modelName: "verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },

    // Ids are generated by better-auth, not the database: `user.id` and its
    // relatives are plain `text` columns with no default, so leaving generation
    // to Postgres would insert nulls.
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = Auth["$Infer"]["Session"];
