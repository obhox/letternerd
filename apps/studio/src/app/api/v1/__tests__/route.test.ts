import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineCapability, createRegistry } from "@cms/core";
import type { VerifiedKey } from "@cms/db/api-keys";
import { resetRateLimits } from "@/server/rate-limit";

/**
 * The public API's front door and its response headers.
 *
 * The headers are the point. A read served to a bearer key is per-tenant and,
 * for a read or admin key, includes drafts; a `Cache-Control: public` on that
 * response tells every shared cache between here and the caller that it may
 * hand the body to the next requester of the same URL. These tests pin the
 * opposite, and pin the CORS and rate-limit behaviour around it.
 */

const state = vi.hoisted(() => ({ key: null as VerifiedKey | null, calls: 0 }));

vi.mock("@/server/services", () => ({
  db: { insert: () => ({ values: async () => {} }) },
  storage: {},
  now: () => new Date("2026-01-01T00:00:00.000Z"),
  limits: {},
}));

vi.mock("@cms/db/api-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cms/db/api-keys")>();
  return {
    ...actual,
    verifyApiKey: async () => {
      state.calls += 1;
      return state.key;
    },
  };
});

vi.mock("@cms/capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cms/capabilities")>();
  const getSite = defineCapability({
    name: "get_site",
    title: "Get site",
    description: "reads",
    input: z.object({}),
    scopes: ["content:read"],
    role: "author",
    readOnly: true,
    idempotent: true,
    route: { method: "GET", path: "/site" },
    handler: async (_i, { actor }) => ({ siteId: actor.siteId, draft: "secret draft" }),
  });
  const updateSite = defineCapability({
    name: "update_site",
    title: "Update site",
    description: "writes",
    input: z.object({ name: z.string() }),
    scopes: ["site:admin"],
    role: "owner",
    route: { method: "PATCH", path: "/site" },
    handler: async (i) => ({ name: i.name }),
  });
  return { ...actual, registry: createRegistry([getSite, updateSite]) };
});

const READ_KEY: VerifiedKey = {
  id: "00000000-0000-4000-8000-000000000002",
  siteId: "00000000-0000-4000-8000-0000000000aa",
  type: "read",
  role: "author",
  scopes: ["content:read", "media:read", "analytics:write", "analytics:read"],
  allowedOrigins: [],
  publishedOnly: false,
};

const PUBLISHABLE_KEY: VerifiedKey = {
  ...READ_KEY,
  id: "00000000-0000-4000-8000-000000000003",
  type: "publishable",
  scopes: ["content:read", "media:read", "analytics:write"],
  allowedOrigins: ["https://blog.example"],
  publishedOnly: true,
};

type Handler = (request: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;
let GET: Handler;
let PATCH: Handler;
let OPTIONS: (request: Request) => Response;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/cms_test";
  process.env.BETTER_AUTH_SECRET ??= "0123456789abcdef0123456789abcdef0123456789";
  process.env.CMS_STUDIO_URL ??= "http://localhost:3000";
  ({ GET, PATCH, OPTIONS } = (await import("../[...path]/route")) as { GET: Handler; PATCH: Handler; OPTIONS: typeof OPTIONS });
});

afterEach(() => {
  state.key = null;
  state.calls = 0;
  resetRateLimits();
});

function call(method: "GET" | "PATCH", path: string, headers: Record<string, string> = {}, body?: unknown) {
  const request = new Request(`http://localhost:3000/api/v1${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ctx = { params: Promise.resolve({ path: path.split("/").filter(Boolean) }) };
  return method === "GET" ? GET(request, ctx) : PATCH(request, ctx);
}

describe("authentication", () => {
  it("refuses a request with no key, with WWW-Authenticate", async () => {
    const response = await call("GET", "/site");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(state.calls).toBe(0);
  });

  it("refuses an unknown key with the same answer as a revoked one", async () => {
    const response = await call("GET", "/site", { authorization: "Bearer cms_sk_nope" });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated", message: "Invalid API key." });
  });

  it("does not spend the failure budget on valid keys", async () => {
    state.key = READ_KEY;
    for (let i = 0; i < 100; i++) {
      const ok = await call("GET", "/site", { authorization: "Bearer cms_sk_x", "x-forwarded-for": "203.0.113.9" });
      expect(ok.status).toBe(200);
    }
  });

  it("budgets failed lookups per source address before hitting the database", async () => {
    for (let i = 0; i < 30; i++) {
      await call("GET", "/site", { authorization: "Bearer cms_sk_nope", "x-forwarded-for": "203.0.113.9" });
    }
    expect(state.calls).toBe(30);
    const refused = await call("GET", "/site", { authorization: "Bearer cms_sk_nope", "x-forwarded-for": "203.0.113.9" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    // Refused before the lookup: the database saw the thirty failures and nothing more.
    expect(state.calls).toBe(30);
    // A different address is unaffected.
    const other = await call("GET", "/site", { authorization: "Bearer cms_sk_nope", "x-forwarded-for": "198.51.100.1" });
    expect(other.status).toBe(401);
  });
});

describe("response headers", () => {
  it("never marks a tenant-scoped read as publicly cacheable", async () => {
    state.key = READ_KEY;
    const response = await call("GET", "/site", { authorization: "Bearer cms_sk_x" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Authorization, Origin");
    expect(response.headers.get("etag")).toMatch(/^W\/"/);
    expect(response.headers.get("ratelimit-limit")).toBe("600");
  });

  it("still answers 304 to a matching ETag", async () => {
    state.key = READ_KEY;
    const first = await call("GET", "/site", { authorization: "Bearer cms_sk_x" });
    const etag = first.headers.get("etag")!;
    const second = await call("GET", "/site", { authorization: "Bearer cms_sk_x", "if-none-match": etag });
    expect(second.status).toBe(304);
    expect(second.headers.get("cache-control")).toBe("private, no-store");
  });

  it("carries the no-store rule on errors too", async () => {
    state.key = READ_KEY;
    const response = await call("PATCH", "/site", { authorization: "Bearer cms_sk_x", "content-type": "application/json" }, { name: "x" });
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

describe("CORS", () => {
  it("refuses a secret key that arrives with an Origin", async () => {
    state.key = READ_KEY;
    const response = await call("GET", "/site", { authorization: "Bearer cms_sk_x", origin: "https://blog.example" });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("echoes only an allow-listed origin for a publishable key", async () => {
    state.key = PUBLISHABLE_KEY;
    const ok = await call("GET", "/site", { authorization: "Bearer cms_pk_x", origin: "https://blog.example" });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("https://blog.example");
    expect(ok.headers.get("access-control-expose-headers")).toContain("ETag");

    const bad = await call("GET", "/site", { authorization: "Bearer cms_pk_x", origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers a preflight without a credential and names Authorization", () => {
    const response = OPTIONS(
      new Request("http://localhost:3000/api/v1/site", {
        method: "OPTIONS",
        headers: { origin: "https://blog.example", "access-control-request-headers": "authorization" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://blog.example");
    expect(response.headers.get("access-control-allow-headers")).toBe("authorization");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("vary")).toBe("Origin");
  });
});

describe("rate limits", () => {
  it("meters reads per key and answers 429 with Retry-After past the budget", async () => {
    state.key = READ_KEY;
    for (let i = 0; i < 600; i++) await call("GET", "/site", { authorization: "Bearer cms_sk_x" });
    const refused = await call("GET", "/site", { authorization: "Bearer cms_sk_x" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBeTruthy();
    expect(await refused.json()).toMatchObject({ error: "rate_limited" });
  });
});
