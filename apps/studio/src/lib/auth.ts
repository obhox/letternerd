import { createAuth, type Auth } from "@cms/auth";
import { env } from "@/env";

/**
 * The studio's better-auth instance.
 *
 * `@cms/auth` owns every policy decision — session lifetime, rate limits, field
 * mapping, the verification rule. This module supplies only what is local to
 * this deployment: the origin it is mounted on and how to send mail. Anything
 * more configured here would be a second opinion that the REST app and the MCP
 * server do not share, and two better-auth instances that disagree stop
 * accepting each other's cookies without ever raising an error.
 */

/**
 * Mail delivery, if this deployment has any.
 *
 * Resend over `fetch` rather than their SDK: this is one POST with a JSON body,
 * and a dependency whose sole job is to build that request is a dependency that
 * still has to be audited, updated and shipped to the edge.
 *
 * Returning `undefined` when no key is configured is the point. `@cms/auth`
 * throws at construction when verification is required and no sender exists, so
 * a production install that forgot its mail provider fails to boot instead of
 * quietly accepting unverified addresses — and an unverified address is enough
 * to claim somebody else's invitation.
 */
function resolveVerificationSender(): ((args: { to: string; url: string }) => Promise<void>) | undefined {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return undefined;

  const from = env.EMAIL_FROM;
  if (!from) {
    /**
     * Half-configured mail is worse than none: `@cms/auth` would see a sender,
     * conclude verification is deliverable, and enable it — and then every
     * send would fail on a missing `from`, locking new accounts out with no
     * way to verify. Refuse at construction instead.
     */
    throw new Error(
      "RESEND_API_KEY is set but EMAIL_FROM is not. Set the sender address, or unset " +
        "RESEND_API_KEY to run without email delivery.",
    );
  }

  return async ({ to, url }) => {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject: "Verify your email address",
        text: [
          "Confirm this address to finish setting up your CMS Studio account:",
          "",
          url,
          "",
          "If you did not create an account, you can ignore this message.",
        ].join("\n"),
      }),
    });

    if (!response.ok) {
      /**
       * The provider's body can echo the recipient address, and this error is
       * headed for the server log. Status only — the address is already known
       * to whoever is reading the log, but there is no reason to write it
       * twice, and Resend's error payloads are not a stable contract.
       */
      throw new Error(`Resend rejected the verification email (HTTP ${response.status}).`);
    }
  };
}

/**
 * One instance per process, kept on `globalThis` in development.
 *
 * Next's dev server re-evaluates modules on every edit. Without this, each
 * reload constructs a fresh better-auth — and `createAuth` opens a `pg.Pool`
 * per instance, so a morning's editing exhausts Postgres's connection limit and
 * sign-in starts failing for reasons that have nothing to do with the code
 * being written. Production evaluates the module once, so the cache is
 * populated only outside it: a stale instance surviving a deploy would be far
 * worse than an extra pool.
 */
const globalForAuth = globalThis as typeof globalThis & { __cmsStudioAuth?: Auth };

export const auth: Auth =
  globalForAuth.__cmsStudioAuth ??
  createAuth({
    baseURL: env.CMS_STUDIO_URL,
    basePath: "/api/auth",
    connectionString: env.DATABASE_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.CMS_TRUSTED_ORIGINS,
    requireEmailVerification: env.CMS_REQUIRE_EMAIL_VERIFICATION,
    sendVerificationEmail: resolveVerificationSender(),
  });

if (process.env.NODE_ENV !== "production") {
  globalForAuth.__cmsStudioAuth = auth;
}

/**
 * The session behind a request, or null.
 *
 * Takes `Headers` rather than reading them itself so the caller decides where
 * they came from — `await headers()` in a server component, `request.headers`
 * in a route handler. This is the real check, and it reads the database;
 * `src/middleware.ts` only looks for the presence of a cookie, which is a
 * routing hint and not an authorization.
 */
export async function getSession(headers: Headers) {
  return auth.api.getSession({ headers });
}

export type StudioSession = Awaited<ReturnType<typeof getSession>>;
