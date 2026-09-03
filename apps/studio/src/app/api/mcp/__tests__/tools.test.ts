import { beforeAll, describe, expect, it, vi } from "vitest";
import { registry } from "@cms/capabilities";
import type { VerifiedKey } from "@cms/db/api-keys";

/**
 * What a client actually gets once it is through the door.
 *
 * These drive the real route handler with real JSON-RPC bodies, through the
 * real MCP server and transport. The point is parity: this endpoint is supposed
 * to serve the capability registry and nothing else, and the way that promise
 * breaks is quietly — a capability whose schema cannot be converted, or a
 * transport that grows a hand-maintained tool list. Comparing against
 * `registry` rather than against a number is what makes the assertion survive
 * the next capability someone adds.
 */

const state = vi.hoisted(() => ({ key: null as VerifiedKey | null }));

vi.mock("@/server/services", () => ({
  db: {},
  storage: {},
  now: () => new Date("2026-01-01T00:00:00.000Z"),
}));

vi.mock("@cms/db/api-keys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@cms/db/api-keys")>();
  return { ...actual, verifyApiKey: async () => state.key };
});

/** An admin key: the credential the settings screen tells people to create. */
const ADMIN_KEY: VerifiedKey = {
  id: "00000000-0000-4000-8000-000000000001",
  siteId: "00000000-0000-4000-8000-0000000000aa",
  type: "admin",
  role: "editor",
  scopes: [
    "content:read",
    "content:write",
    "content:publish",
    "media:read",
    "media:write",
    "taxonomy:write",
    "analytics:read",
    "analytics:write",
  ],
  allowedOrigins: [],
  publishedOnly: false,
};

interface JsonRpcResult {
  jsonrpc: string;
  id: number;
  result: {
    tools?: { name: string; description: string }[];
    isError?: boolean;
    content?: { type: string; text: string }[];
    serverInfo?: { name: string; version: string };
  };
}

let POST: (request: Request) => Promise<Response>;
let INFO: () => Response;

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/cms_test";
  process.env.BETTER_AUTH_SECRET ??= "0123456789abcdef0123456789abcdef0123456789";
  process.env.CMS_STUDIO_URL ??= "http://localhost:3000";

  ({ POST } = (await import("../route")) as { POST: typeof POST });
  ({ GET: INFO } = (await import("../info/route")) as { GET: typeof INFO });
});

async function rpc(method: string, params: unknown, id = 1): Promise<JsonRpcResult> {
  state.key = ADMIN_KEY;
  const response = await POST(
    new Request("http://localhost:3000/api/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer cms_ak_live",
        "content-type": "application/json",
        // Streamable HTTP requires both, and a client that omits one is told so.
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as JsonRpcResult;
}

describe("the tool list", () => {
  it("serves every capability in the registry, by name", async () => {
    const body = await rpc("tools/list", {});
    const served = (body.result.tools ?? []).map((tool) => tool.name).sort();

    expect(served).toHaveLength(registry.size);
    expect(served).toEqual([...registry.keys()].sort());
  });

  it("carries each capability's own description, so the agent reads one prose source", async () => {
    const body = await rpc("tools/list", {});
    const served = new Map((body.result.tools ?? []).map((tool) => [tool.name, tool.description]));

    for (const cap of registry.values()) {
      expect(served.get(cap.name), cap.name).toBe(cap.description);
    }
  });

  it("completes an initialize handshake, naming the server a client will show", async () => {
    const body = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });

    expect(body.result.serverInfo).toMatchObject({ name: "cms" });
  });
});

describe("domain failures", () => {
  it("hands a refusal back as a tool error carrying its code, not as a crash", async () => {
    /**
     * An admin key deliberately lacks `site:admin`, so a leaked one cannot mint
     * itself a successor. The refusal has to reach the agent as something it
     * can read and act on: a tool error naming the scope, rather than an
     * exception that becomes an opaque transport failure.
     */
    const body = await rpc("tools/call", {
      name: "create_api_key",
      arguments: { name: "escalation", type: "admin" },
    });

    expect(body.result.isError).toBe(true);
    const payload = JSON.parse(body.result.content?.[0]?.text ?? "{}") as {
      error: string;
      message: string;
    };
    expect(payload.error).toBe("forbidden");
    expect(payload.message).toContain("site:admin");
  });
});

describe("/api/mcp/info", () => {
  it("describes the same server the endpoint serves, without a key", async () => {
    const response = INFO();
    expect(response.status).toBe(200);

    const info = (await response.json()) as {
      name: string;
      version: string;
      transport: string;
      toolCount: number;
      tools: { name: string; summary: string; group: string }[];
    };

    expect(info.name).toBe("cms");
    expect(info.transport).toBe("streamable-http");
    expect(info.toolCount).toBe(registry.size);
    expect(info.tools.map((tool) => tool.name).sort()).toEqual([...registry.keys()].sort());
    // The screen renders these; an empty one is a blank row nobody notices.
    for (const tool of info.tools) {
      expect(tool.summary.length, tool.name).toBeGreaterThan(0);
      expect(tool.group, tool.name).not.toBe("Other");
    }
  });
});
