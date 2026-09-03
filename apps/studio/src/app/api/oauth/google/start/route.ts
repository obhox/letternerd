import { env } from "@/env";
import { currentUser, studioContext } from "@/server/context";
import {
  GOOGLE_AUTH_ENDPOINT,
  SEARCH_CONSOLE_SCOPE,
  analyticsSettingsUrl,
  googleRedirectUri,
  nonceCookie,
  redirectWithCookie,
} from "../shared";
import { newOAuthNonce, signOAuthState } from "../state";

/**
 * Opens Google's consent screen for one site.
 *
 * A route handler rather than a server action because the end of this function
 * is a top-level navigation to another origin, and it has to set a cookie on
 * the way out. Both are things a route handler does plainly and a server action
 * does awkwardly.
 *
 * ## Why `prompt=consent` is not optional here
 *
 * Google issues a **refresh token only on the first authorisation** of a given
 * client by a given account. Every subsequent trip through the consent screen
 * returns an access token and nothing else. So a flow without `prompt=consent`
 * works perfectly for whoever connects first and then, for everyone who has
 * ever authorised this app before — including the same person reconnecting
 * after a disconnect — silently produces a connection that dies in one hour and
 * cannot renew itself. `access_type=offline` asks for offline access;
 * `prompt=consent` is what makes Google actually re-issue the token that
 * provides it.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const slug = new URL(request.url).searchParams.get("site");
  if (!slug) {
    return new Response("Missing ?site=<slug>.", { status: 400 });
  }

  /**
   * Checked before anything else. `studioContext` redirects a signed-out
   * visitor to the sign-in page, which is the right answer for a navigation —
   * but the check is stated here so the ordering is explicit rather than a
   * side effect of what `studioContext` happens to do.
   */
  if (!(await currentUser())) {
    return Response.redirect(
      new URL(`/sign-in?redirect=/${slug}/settings/analytics`, env.CMS_STUDIO_URL),
      303,
    );
  }

  const ctx = await studioContext(slug);

  /**
   * Owner-only, checked here as well as in the capability.
   *
   * `connect_search_console` refuses a non-owner regardless, so this is not the
   * security boundary — it is a better failure. Without it an editor walks the
   * whole Google consent screen, grants access to their own account, and is
   * told "forbidden" on the way back, having already handed the CMS a grant it
   * will never use.
   */
  if (ctx.role !== "owner") {
    return Response.redirect(analyticsSettingsUrl(slug, { error: "forbidden" }), 303);
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(analyticsSettingsUrl(slug, { error: "not_configured" }), 303);
  }
  if (!env.ANALYTICS_ENCRYPTION_KEY) {
    // Refused before the consent screen rather than after it: without the key
    // the callback cannot store what Google returns, and the person would have
    // granted access for nothing.
    return Response.redirect(analyticsSettingsUrl(slug, { error: "no_encryption_key" }), 303);
  }

  const nonce = newOAuthNonce();
  const state = signOAuthState(env.BETTER_AUTH_SECRET, {
    siteId: ctx.site.id,
    siteSlug: slug,
    userId: ctx.userId,
    nonce,
    issuedAt: Date.now(),
  });

  const authorize = new URL(GOOGLE_AUTH_ENDPOINT);
  authorize.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", googleRedirectUri());
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", SEARCH_CONSOLE_SCOPE);
  // Ask for a credential that outlives the browser session…
  authorize.searchParams.set("access_type", "offline");
  // …and force the screen that actually issues one. See the note above.
  authorize.searchParams.set("prompt", "consent");
  /**
   * Off deliberately. With `include_granted_scopes=true` Google returns a token
   * carrying every scope this account has ever granted this client, so a token
   * minted for a read-only Search Console connection could quietly also carry
   * write access to something else. The stored credential should be able to do
   * exactly one thing.
   */
  authorize.searchParams.set("include_granted_scopes", "false");
  authorize.searchParams.set("state", state);

  return redirectWithCookie(authorize.toString(), nonceCookie(nonce));
}
