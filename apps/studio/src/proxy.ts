import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Routing and response hardening for every studio request.
 *
 * This file decides where an unauthenticated visitor lands and which security
 * headers every response carries. It does not decide what anybody may do — that
 * is `requireSite` in `@cms/auth`, running in server components and server
 * actions with the database in front of it.
 *
 * The distinction is the whole design. The proxy runs before the app, where a
 * database round trip on every navigation is ruinously slow, so the only
 * session evidence available here is whether a session cookie is present. A
 * cookie's presence proves nothing: it may be expired, revoked, or belong to a
 * user who was removed from the site a minute ago. Treating it as an answer
 * would put the entire tenant boundary on a check that cannot verify a
 * signature. Treating it as a hint — "send them to the studio, which will check
 * properly" — is exactly what it can support.
 *
 * (Next 16 renamed the `middleware` file convention to `proxy`; this is the
 * same code under the name the framework now expects.)
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
 * rejects sessions outright. `/api/mcp` is the same argument: a bearer-token
 * endpoint for MCP clients. `/api/cron` carries `CRON_SECRET` as a bearer token
 * and is invoked by a scheduler that holds no cookie — before it was listed
 * here every scheduled run was answered with a 307 to the sign-in page, which
 * `curl -fsS` reports as success, so scheduled publishing silently never ran.
 * Each of these routes performs its own authentication; the redirect below is
 * only ever the right answer for a person in a browser.
 */
export const PUBLIC_PREFIXES = [
  "/api/auth",
  "/api/health",
  "/api/v1",
  "/api/mcp",
  "/api/cron",
  "/sign-in",
  "/sign-up",
  "/verify-email",
  "/accept-invite",
  "/two-factor",
] as const;

export function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isApi(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * A fresh nonce per request, base64 so it is valid inside a CSP source list.
 *
 * `crypto.getRandomValues` rather than `node:crypto` because this file may run
 * on the edge runtime, where the Node module is unavailable.
 */
function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/**
 * Origins the studio legitimately loads images from beyond its own.
 *
 * The media CDN serves every uploaded asset. `https:` is allowed for images in
 * general because the editor preview renders whatever an author linked in
 * markdown, and an image is not an execution vector; scripts, styles and
 * connections stay locked to the studio's origin.
 */
function mediaCdnOrigin(): string | null {
  const raw = process.env.NEXT_PUBLIC_MEDIA_CDN_URL ?? process.env.MEDIA_CDN_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/**
 * The page policy.
 *
 * Scripts: only those carrying this request's nonce, plus anything they load
 * (`strict-dynamic`), so a sanitizer bypass in the content pipeline cannot
 * execute — the studio renders author-controlled HTML with the session cookie
 * in scope, and this header is the second line of defence behind
 * `rehype-sanitize`. `'unsafe-eval'` is a development-only concession: React
 * reconstructs server stack traces with `eval` in dev and never in production.
 *
 * Styles: `'unsafe-inline'` is a deliberate, stated trade. Shiki, Radix and the
 * editor write inline `style` attributes, and CSS is not a script execution
 * vector in any shipping browser. The nonce is still emitted so a future move
 * to nonced styles is a one-line change.
 */
export function buildPageCsp(nonce: string, options: { dev: boolean; cdnOrigin: string | null }): string {
  const { dev, cdnOrigin } = options;
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https:${cdnOrigin ? ` ${cdnOrigin}` : ""}`,
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

/**
 * The policy for API responses: they are JSON, never documents. A policy that
 * permits nothing costs nothing and closes the "this JSON was rendered as HTML
 * somehow" class of bug outright.
 */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

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
 * third-party asset or outbound link. HSTS is set only in production because a
 * local `http://localhost` studio with a preload-length HSTS would lock the
 * developer's browser out of every other local project on that host.
 */
export function harden(response: NextResponse, options: { csp: string; api: boolean }): NextResponse {
  const h = response.headers;
  h.set("Content-Security-Policy", options.csp);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin");
  if (!options.api) {
    // API responses are fetched cross-origin by consuming sites holding a
    // publishable key; CORP would not block a CORS-mode fetch, but there is no
    // reason to make that depend on the mode a client chose.
    h.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  if (process.env.NODE_ENV === "production") {
    h.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }
  return response;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const api = isApi(pathname);
  const dev = process.env.NODE_ENV === "development";

  /**
   * `x-pathname` is set — never merely passed through — on every branch.
   *
   * The two-factor gate in `studioContext` reads it to recognise the one page
   * an unenrolled owner may reach. A branch that forwarded the client's own
   * value would turn that exemption into a header anyone can send, and the
   * session-authenticated API routes (media upload, OAuth start) would accept
   * it. So the incoming value is overwritten here for API routes too.
   */
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);

  if (api) {
    if (isPublic(pathname) || getSessionCookie(request)) {
      return harden(NextResponse.next({ request: { headers: requestHeaders } }), { csp: API_CSP, api: true });
    }
    // A session-only API route (media upload, OAuth) reached without a cookie:
    // answer the machine that asked, not the browser it does not have.
    return harden(
      NextResponse.json({ error: "unauthenticated", message: "Sign in to continue." }, { status: 401 }),
      { csp: API_CSP, api: true },
    );
  }

  const nonce = newNonce();
  const csp = buildPageCsp(nonce, { dev, cdnOrigin: mediaCdnOrigin() });

  if (isPublic(pathname) || getSessionCookie(request)) {
    /**
     * The nonce reaches Next through the request: it reads the CSP header on
     * the *incoming* request, extracts `'nonce-…'` and stamps it onto every
     * script tag it emits. Without this the response policy would block the
     * framework's own bundles.
     */
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    return harden(NextResponse.next({ request: { headers: requestHeaders } }), { csp, api: false });
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

  return harden(NextResponse.redirect(signIn), { csp, api: false });
}

export const config = {
  /**
   * Static assets are excluded rather than allowed through, because running the
   * matcher at all costs an invocation per file. `favicon.ico` and friends are
   * named individually since they sit at the root rather than under `_next`.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
