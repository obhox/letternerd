import { cookies } from "next/headers";
import { createLogger } from "@cms/core";

const log = createLogger("oauth.google");
import { env } from "@/env";
import { currentUser, dispatch, studioContext } from "@/server/context";
import {
  GOOGLE_TOKEN_ENDPOINT,
  analyticsSettingsUrl,
  googleRedirectUri,
  nonceCookie,
  redirectWithCookie,
} from "../shared";
import { pickProperty, type SearchConsoleSiteEntry } from "../property";
import { OAUTH_NONCE_COOKIE, verifyOAuthState } from "../state";

/**
 * Where Google sends the browser back, and the only place a code is exchanged.
 *
 * The ordering below is the whole security design, so it is worth stating
 * plainly. Nothing about a valid `code` makes a request trustworthy: a code is
 * a bearer value in a URL, and this endpoint's URL is guessable. What makes the
 * request trustworthy is that it arrives with a live owner session **and** a
 * state this server signed **and** the nonce cookie that state was minted
 * alongside. Each is checked before the code is spent:
 *
 *  1. **An authenticated session.** Without it, anyone who can reach this URL
 *     can drive a connection. "It had a valid code" is not authentication — it
 *     authenticates the *Google account*, and the attacker owns that account.
 *  2. **The signed state**, which is where the siteId comes from. A siteId
 *     taken from the query string is a siteId the caller chose, and choosing it
 *     is how somebody else's site ends up reading your Search Console property.
 *  3. **The nonce cookie**, consumed here, which makes the state single-use.
 *  4. **The owner role on that site**, re-checked against the live session.
 *
 * Only then is the code exchanged, and the exchange uses a `redirect_uri` built
 * from `CMS_STUDIO_URL` — never from a request header. See `../shared.ts`.
 */

export const dynamic = "force-dynamic";

interface GoogleTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const clearCookie = nonceCookie(null);

  // (1) A live session, before the code is looked at at all.
  const user = await currentUser();
  if (!user) {
    return redirectWithCookie(
      new URL("/sign-in", env.CMS_STUDIO_URL).toString(),
      clearCookie,
    );
  }

  // (2) + (3) The signed state and the nonce it was minted with. The cookie is
  // read now and cleared by every response below, so one state is spendable
  // exactly once whatever happens next.
  const cookieStore = await cookies();
  const state = verifyOAuthState(env.BETTER_AUTH_SECRET, url.searchParams.get("state"), {
    nonce: cookieStore.get(OAUTH_NONCE_COOKIE)?.value,
    userId: user.id,
    now: new Date(),
  });

  if (!state.ok) {
    /**
     * There is no site slug to return to — the only place one could come from
     * is the state that just failed verification, and using it would be
     * trusting exactly the value that was rejected. So this lands on the site
     * list rather than on a site page.
     */
    return redirectWithCookie(
      new URL(`/?oauth_error=${state.reason}`, env.CMS_STUDIO_URL).toString(),
      clearCookie,
    );
  }

  const { siteSlug, siteId } = state.payload;
  const back = (params: Record<string, string>) =>
    redirectWithCookie(analyticsSettingsUrl(siteSlug, params), clearCookie);

  // Google reports a refusal on the consent screen this way. It is a normal
  // outcome, not an error condition.
  const denied = url.searchParams.get("error");
  if (denied) return back({ error: "google_denied" });

  const code = url.searchParams.get("code");
  if (!code) return back({ error: "no_code" });

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return back({ error: "not_configured" });
  }

  // (4) The owner role, against the live session rather than against anything
  // the returning request carried.
  const ctx = await studioContext(siteSlug);
  if (ctx.role !== "owner") return back({ error: "forbidden" });
  if (ctx.site.id !== siteId) {
    // The slug now points at a different site than when consent started — a
    // rename and a re-registration in between. Storing the token would attach
    // it to whichever site happens to hold the slug today.
    return back({ error: "site_changed" });
  }

  /* ---- exchange the code ------------------------------------------- */

  let token: GoogleTokenResponse;
  try {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        // Must byte-for-byte match the one sent to the authorize endpoint, and
        // must come from configured origin rather than from this request.
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
      }).toString(),
      cache: "no-store",
    });

    if (!response.ok) {
      // The body can echo the client secret back in some error shapes; log the
      // status only.
      log.error("token exchange failed", { status: response.status });
      return back({ error: "exchange_failed" });
    }
    token = (await response.json()) as GoogleTokenResponse;
  } catch (error) {
    log.error("token exchange could not be completed", { error });
    return back({ error: "exchange_failed" });
  }

  const accessToken = typeof token.access_token === "string" ? token.access_token : undefined;
  const refreshToken = typeof token.refresh_token === "string" ? token.refresh_token : undefined;
  const expiresIn = typeof token.expires_in === "number" ? token.expires_in : undefined;
  const scopes = typeof token.scope === "string" ? token.scope.split(" ").filter(Boolean) : [];

  if (!accessToken) return back({ error: "exchange_failed" });
  if (!refreshToken) {
    /**
     * `prompt=consent` should have guaranteed one. Arriving here means Google
     * declined to issue it anyway, and storing the access token alone would
     * produce a connection that works for an hour and then reports an auth
     * failure the owner has no way to interpret.
     */
    return back({ error: "no_refresh_token" });
  }

  /* ---- decide which property these numbers come from ---------------- */

  let property: string | null = null;
  try {
    const listed = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
      cache: "no-store",
    });
    if (listed.ok) {
      const body = (await listed.json()) as { siteEntry?: SearchConsoleSiteEntry[] };
      property = pickProperty(body.siteEntry ?? [], ctx.site.baseUrl);
    } else {
      log.error("property list failed", { status: listed.status });
    }
  } catch (error) {
    log.error("property list could not be fetched", { error });
  }

  if (!property) return back({ error: "no_property" });

  /* ---- store it, encrypted ----------------------------------------- */

  const result = await dispatch(ctx, "connect_search_console", {
    propertyUrl: property,
    refreshToken,
    accessToken,
    ...(expiresIn === undefined ? {} : { expiresInSeconds: expiresIn }),
    scopes,
  });

  if (!result.ok) {
    log.error("connect_search_console refused", { code: result.code });
    return back({ error: "save_failed" });
  }

  return back({ connected: property });
}
