// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { API_CSP, PUBLIC_PREFIXES, buildPageCsp, isPublic, proxy } from "../proxy";

/**
 * The proxy is the first thing every request meets, so the tests are about the
 * two things it decides: who gets redirected, and which headers everyone gets.
 *
 * The cron case is the one that bit in production. `/api/cron` was missing from
 * the public list, every scheduled call was answered with a 307 to the sign-in
 * page, and `curl -fsS` reported that as success. A test that imports the cron
 * route directly cannot catch it; only a test of the proxy can.
 */

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://studio.test${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

const SESSION = "better-auth.session_token=abc.def";

const HARDENING = [
  "content-security-policy",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
  "permissions-policy",
  "cross-origin-opener-policy",
];

describe("public prefixes", () => {
  it.each([...PUBLIC_PREFIXES])("%s passes without a session cookie", (prefix) => {
    const response = proxy(request(prefix));
    expect(response.status).not.toBe(307);
    expect(response.status).not.toBe(401);
  });

  it("covers the cron routes, which carry a bearer token and no cookie", () => {
    const response = proxy(request("/api/cron/publish-scheduled"));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("matches a prefix only at a path boundary", () => {
    expect(isPublic("/sign-in")).toBe(true);
    expect(isPublic("/sign-in/anything")).toBe(true);
    expect(isPublic("/sign-inside")).toBe(false);
    expect(isPublic("/api/v1x")).toBe(false);
  });
});

describe("unauthenticated studio paths", () => {
  it("redirects to sign-in carrying the path, never a full URL", () => {
    const response = proxy(request("/acme/posts?page=2"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("redirect")).toBe("/acme/posts?page=2");
  });

  it("answers a session-only API route with 401 JSON rather than a redirect", async () => {
    const response = proxy(request("/api/media/upload"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "unauthenticated" });
  });

  it("lets a request with a session cookie through to the app", () => {
    const response = proxy(request("/acme/posts", SESSION));
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });
});

describe("hardening headers", () => {
  const cases: [string, string, string | undefined][] = [
    ["a redirect", "/acme", undefined],
    ["a public page", "/sign-in", undefined],
    ["a session page", "/acme", SESSION],
    ["an API route", "/api/v1/site", undefined],
  ];
  it.each(cases)("are present on %s", (_label, path, cookie) => {
    const response = proxy(request(path, cookie));
    for (const name of HARDENING) {
      expect(response.headers.get(name), name).toBeTruthy();
    }
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
  });

  it("gives API responses a policy that permits nothing", () => {
    const response = proxy(request("/api/v1/site"));
    expect(response.headers.get("content-security-policy")).toBe(API_CSP);
    expect(response.headers.get("cross-origin-resource-policy")).toBeNull();
  });

  it("gives pages a nonce-based script policy and forwards the nonce to the app", () => {
    const response = proxy(request("/sign-in"));
    const csp = response.headers.get("content-security-policy")!;
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    // The request header Next reads the nonce from.
    const forwarded = response.headers.get("x-middleware-request-x-nonce");
    expect(forwarded).toBeTruthy();
    expect(csp).toContain(`'nonce-${forwarded}'`);
  });

  it("uses a different nonce for every request", () => {
    const a = proxy(request("/sign-in")).headers.get("content-security-policy");
    const b = proxy(request("/sign-in")).headers.get("content-security-policy");
    expect(a).not.toBe(b);
  });

  it("only allows eval and websockets in development", () => {
    expect(buildPageCsp("n", { dev: false, cdnOrigin: null })).not.toContain("unsafe-eval");
    expect(buildPageCsp("n", { dev: true, cdnOrigin: null })).toContain("'unsafe-eval'");
    expect(buildPageCsp("n", { dev: false, cdnOrigin: "https://cdn.example" })).toContain(
      "img-src 'self' blob: data: https: https://cdn.example",
    );
  });
});

describe("x-pathname", () => {
  it.each([
    ["an API route", "/api/media/upload"],
    ["a page", "/acme/posts"],
  ])("is overwritten with the real path on %s, never forwarded from the client", (_label, path) => {
    const spoofed = new NextRequest(`http://studio.test${path}`, {
      headers: { cookie: SESSION, "x-pathname": "/acme/settings/security" },
    });
    const response = proxy(spoofed);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-request-x-pathname")).toBe(path);
  });
});
