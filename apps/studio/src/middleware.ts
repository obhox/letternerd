import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Routing and response hardening for every studio request.
 *
 * This middleware decides where an unauthenticated visitor lands. It does not
 * decide what anybody may do — that is `requireSite` in `@cms/auth`, running in
 * server components and server actions with the database in front of it.
 *
 * The distinction is the whole design. Middleware runs on the edge runtime,
 * where a database round trip is either impossible or ruinously slow on every
 * navigation, so the only session evidence available here is whether a session
 * cookie is present. A cookie's presence proves nothing: it may be expired,
 * revoked, or belong to a user who was removed from the site a minute ago.
 * Treating it as an answer would put the entire tenant boundary on a check that
 * cannot verify a signature. Treating it as a hint — "send them to the studio,
 * which will check properly" — is exactly what it can support.
 */

/**
 * Paths that must work without a session.
 *
 * `/api/auth` is how a session is obtained in the first place; gating it would
 * make sign-in redirect to sign-in. `/api/health` is the container's liveness
 * probe, and an orchestrator that receives a 307 to a login page concludes the
 * process is unhealthy and restarts it in a loop.
 *
 * `/api/v1` is the public content API, which authenticates with an API key and
 * rejects sessions outright. Redirecting an unauthenticated request there to a
 * sign-in page would answer a machine with HTML; it returns its own 401 with a
 * WWW-Authenticate header instead. `/api/mcp` is the same argument in the same
 * words: it is a bearer-token endpoint for MCP clients, and a 307 to a login
 * page is a connection failure an agent cannot diagnose.
 */
const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/health",
  "/api/v1",
  "/api/mcp",
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/accept-invite",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Applied to every response, including the redirects this file issues.
 *
 * Next's `headers()` config in `next.config.mjs` covers rendered pages, but a
 * redirect produced here never reaches it — and the redirect is precisely the
 * response an unauthenticated visitor sees first.
 *
 * `DENY` rather than `SAMEORIGIN`: nothing in the studio is meant to be framed,
 * and a publish button that can be framed is a publish button that can be
 * clickjacked. `strict-origin-when-cross-origin` keeps document paths — which
 * contain site slugs and document ids — out of the `Referer` sent to any
 * third-party asset or outbound link.
 */
function harden(response: NextResponse): NextResponse {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) {
    return harden(NextResponse.next());
  }

  if (getSessionCookie(request)) {
    return harden(NextResponse.next());
  }

  const signIn = new URL("/sign-in", request.url);
  /**
   * Where to return to afterwards, carried as a path and never as a full URL.
   *
   * The sign-in page validates this again before acting on it. Both ends check
   * because both ends can be reached independently: this value can also arrive
   * from a link somebody was sent, in which case nothing in this file ever saw
   * it. An open redirect on a login page is the ideal phishing primitive — the
   * victim signs in to the real studio and is then handed to the attacker.
   */
  signIn.searchParams.set("redirect", `${pathname}${search}`);

  return harden(NextResponse.redirect(signIn));
}

export const config = {
  /**
   * Static assets are excluded rather than allowed through, because running the
   * matcher at all costs a middleware invocation per file. `favicon.ico` and
   * friends are named individually since they sit at the root rather than under
   * `_next`.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
