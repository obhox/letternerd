import { env } from "@/env";
import { OAUTH_NONCE_COOKIE } from "./state";

/**
 * The pieces both halves of the Google flow have to agree on.
 *
 * `start` and `callback` are two requests separated by a trip through
 * Google's servers, and every value they disagree about fails at the far end
 * with a message from Google rather than from us. Redirect URI, cookie
 * attributes and the scope string live here so there is one definition of each.
 */

/** Read-only Search Console. The only scope this integration asks for. */
export const SEARCH_CONSOLE_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Built from configured origin, **never** from a request header.
 *
 * `Host`, `X-Forwarded-Host` and `Origin` are all attacker-controllable on a
 * request. Deriving the redirect URI from one of them is the classic way an
 * authorization code ends up delivered to a host the attacker owns: they send
 * a request carrying `X-Forwarded-Host: evil.example`, we build
 * `https://evil.example/api/oauth/google/callback`, and Google — if that host
 * has been registered, or if any open redirect exists on the real one — hands
 * the code to them. `CMS_STUDIO_URL` is the same value better-auth builds its
 * own callbacks from, so this cannot drift from the rest of the deployment
 * either.
 *
 * It must also match a URI registered on the Google Cloud OAuth client
 * *exactly*, including scheme, port and trailing path.
 */
export function googleRedirectUri(): string {
  return new URL("/api/oauth/google/callback", env.CMS_STUDIO_URL).toString();
}

/** Where a completed or failed attempt lands the person back. */
export function analyticsSettingsUrl(
  siteSlug: string,
  params: Record<string, string> = {},
): string {
  const url = new URL(`/${siteSlug}/settings/analytics`, env.CMS_STUDIO_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The nonce cookie, spelled out once.
 *
 * `SameSite=Lax`, not `Strict`. The callback arrives as a top-level navigation
 * from `accounts.google.com`, and a Strict cookie is not sent on a cross-site
 * navigation at all — the flow would fail its own replay check every single
 * time, for everybody. Lax is sent on top-level GET navigations, which is
 * exactly and only what this needs.
 *
 * `Secure` is conditioned on the configured origin rather than hardcoded,
 * because a `Secure` cookie is silently dropped on `http://localhost` and the
 * whole flow would be undebuggable in development.
 */
export function nonceCookie(value: string | null): string {
  const secure = env.CMS_STUDIO_URL.startsWith("https://");
  const attributes = [
    `${OAUTH_NONCE_COOKIE}=${value ?? ""}`,
    // Scoped to the flow: no other route has any business reading it.
    "Path=/api/oauth/google",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    // Clearing sets Max-Age=0; the TTL otherwise matches the state's.
    value === null ? "Max-Age=0" : "Max-Age=600",
  ];
  return attributes.join("; ");
}

/** A redirect that also writes (or clears) the nonce cookie in one response. */
export function redirectWithCookie(location: string, cookie: string): Response {
  return new Response(null, {
    // 303: the browser must follow with a GET whatever the original method was.
    status: 303,
    headers: { Location: location, "Set-Cookie": cookie, "Cache-Control": "no-store" },
  });
}
