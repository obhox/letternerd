import { beforeAll, describe, expect, it, vi } from "vitest";
import type { VerifiedKey } from "@cms/db/api-keys";

/**
 * The remote MCP endpoint's front door.
 *
 * The interesting cases are all refusals, and the shape of the refusal is the
 * feature. An MCP client that receives a transport-level failure cannot tell
 * "your key is wrong" from "the server is broken", and those want completely
 * different responses from whoever is watching — so an unauthenticated call has
 * to come back as an ordinary HTTP 401 with `WWW-Authenticate`, before any
 * JSON-RPC framing is attempted.
 *
 * The database is mocked away rather than stood up: nothing below reaches a
 * handler, and a suite that needs Postgres to assert that a missing header is
 * refused is a suite that stops being run.
 */

const state = vi.hoisted(() => ({ key: null as VerifiedKey | null }));

vi.mock("@/server/services", () => ({
  db: {},
  storage: {},
  now: () => new Date("2026-01-01T00:00:00.000Z"),
  limits: {},
}));

vi.mock("@cms/db/api-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cms/db/api-keys")>();
  // Only the lookup is faked. `originAllowed` is the real rule, because it is
  // one of the things under test.
  return { ...actual, verifyApiKey: async () => state.key };
});

const ADMIN_KEY: VerifiedKey = {
  id: "00000000-0000-4000-8000-000000000001",
  siteId: "00000000-0000-4000-8000-0000000000aa",
  type: "admin",
  role: "editor",
  scopes: ["content:read", "content:write", "content:publish"],
  allowedOrigins: [],
  publishedOnly: false,
};

let POST: (request: Request) => Promise<Response>;
let GET: () => Response;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/cms_test";
  process.env.BETTER_AUTH_SECRET ??= "0123456789abcdef0123456789abcdef0123456789";
  process.env.CMS_STUDIO_URL ??= "http://localhost:3000";

  ({ POST, GET } = (await import("../route")) as {
    POST: typeof POST;
    GET: typeof GET;
  });
});

/** A well-formed `tools/list`, so only the credential is ever in question. */
function call(headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }),
  );
}

describe("authentication", () => {
  it("refuses a request with no Authorization header, and says how to authenticate", async () => {
    state.key = null;

    const response = await call();

    expect(response.status).toBe(401);
    // The header is the whole point: a client can act on this, and a thrown
    // transport error is something it can only report.
    expect(response.headers.get("WWW-Authenticate")).toBe('Bearer realm="cms"');

    const body = (await response.json()) as {
      jsonrpc: string;
      id: null;
      error: { code: number; message: string; data: { error: string } };
    };
    // Still JSON-RPC-shaped, so a client that only knows how to print a
    // JSON-RPC error has something to print.
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBeNull();
    expect(body.error.data.error).toBe("unauthenticated");
    expect(body.error.message).toContain("Authorization: Bearer");
  });

  it("refuses an unknown key as an invalid token, without saying why it is invalid", async () => {
    state.key = null;

    const response = await call({ authorization: "Bearer cms_ak_not-a-real-key" });

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toBe(
      'Bearer realm="cms", error="invalid_token"',
    );
    // Revoked, expired, malformed and never-existed are one answer on purpose.
    expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
      "Invalid API key.",
    );
  });

  it("refuses a key presented under the wrong scheme", async () => {
    state.key = ADMIN_KEY;

    for (const authorization of ["cms_ak_live", "Basic cms_ak_live", "bearer cms_ak_live"]) {
      const response = await call({ authorization });
      expect(response.status, authorization).toBe(401);
    }
  });

  it("refuses an admin key that arrives from a browser", async () => {
    state.key = ADMIN_KEY;

    /**
     * An admin key carrying an `Origin` header has leaked into client-side
     * code. Refusing is how anyone finds out; allowing it means the leak is
     * discovered by whoever exploits it. Real MCP clients send no `Origin`.
     */
    const response = await call({
      authorization: "Bearer cms_ak_live",
      origin: "https://example.com",
    });

    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { data: { error: string } } }).error.data.error).toBe(
      "forbidden",
    );
  });
});

describe("method handling", () => {
  it("answers GET with 405 and names the method that works, rather than hanging", () => {
    const response = GET();

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
  });
});
