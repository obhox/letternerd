import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineCapability, type Actor } from "@cms/core";
import { invokeAudited, redactAuditInput } from "../audit";

const actor: Actor = {
  kind: "api_key",
  id: "key-1",
  siteId: "00000000-0000-4000-8000-0000000000aa",
  role: "editor",
  scopes: ["content:read", "content:write"],
  publishedOnly: false,
};

function fakeDb() {
  const rows: Record<string, unknown>[] = [];
  const db = {
    insert: () => ({
      values: async (row: Record<string, unknown>) => {
        rows.push(row);
      },
    }),
  };
  return { db, rows };
}

const write = defineCapability({
  name: "write_thing",
  title: "Write",
  description: "writes",
  input: z.object({ title: z.string(), refreshToken: z.string().optional(), nested: z.any().optional() }),
  scopes: ["content:write"],
  role: "editor",
  route: { method: "POST", path: "/things" },
  handler: async (input) => ({ ok: true, title: input.title }),
});

const read = defineCapability({
  name: "read_thing",
  title: "Read",
  description: "reads",
  input: z.object({}),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  route: { method: "GET", path: "/things" },
  handler: async () => ({ ok: true }),
});

describe("invokeAudited", () => {
  it.each(["studio", "rest", "mcp", "stdio"] as const)("records a %s write with the transport named", async (transport) => {
    const { db, rows } = fakeDb();
    const result = await invokeAudited(write, { title: "x" }, {
      actor,
      services: { db } as never,
      transport,
    });
    expect(result).toEqual({ ok: true, title: "x" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      siteId: actor.siteId,
      actorType: "api_key",
      actorId: "key-1",
      capability: "write_thing",
      transport,
      input: { title: "x" },
    });
  });

  it("does not record reads", async () => {
    const { db, rows } = fakeDb();
    await invokeAudited(read, {}, { actor, services: { db } as never, transport: "rest" });
    expect(rows).toHaveLength(0);
  });

  it("does not record a refused call", async () => {
    const { db, rows } = fakeDb();
    const readOnlyActor: Actor = { ...actor, scopes: ["content:read"], role: "author" };
    await expect(
      invokeAudited(write, { title: "x" }, { actor: readOnlyActor, services: { db } as never, transport: "rest" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(rows).toHaveLength(0);
  });

  it("redacts credentials at any depth", async () => {
    const { db, rows } = fakeDb();
    await invokeAudited(
      write,
      { title: "x", refreshToken: "r", nested: { connection: { accessToken: "a", propertyUrl: "https://p" } } },
      { actor, services: { db } as never, transport: "mcp" },
    );
    expect(rows[0]?.input).toEqual({
      title: "x",
      refreshToken: "<redacted>",
      nested: { connection: { accessToken: "<redacted>", propertyUrl: "https://p" } },
    });
  });

  it("returns the result even when the audit row cannot be written, and says so", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const db = { insert: () => ({ values: async () => { throw new Error("db down"); } }) };
    const result = await invokeAudited(write, { title: "x" }, { actor, services: { db } as never, transport: "rest" });
    expect(result).toEqual({ ok: true, title: "x" });
    expect(stderr).toHaveBeenCalled();
    expect(String(stderr.mock.calls[0]?.[0])).toContain("audit row was not written");
    stderr.mockRestore();
  });

  it("skips the nil site a cross-site sweep runs under", async () => {
    const { db, rows } = fakeDb();
    const sweep: Actor = { ...actor, kind: "system", siteId: "00000000-0000-0000-0000-000000000000", role: "owner" };
    await invokeAudited(write, { title: "x" }, { actor: sweep, services: { db } as never, transport: "cron" });
    expect(rows).toHaveLength(0);
  });
});

describe("redactAuditInput", () => {
  it("omits long strings by length and keeps short ones", () => {
    expect(redactAuditInput({ bodyMd: "x".repeat(500), slug: "hello" })).toEqual({
      bodyMd: "<500 chars omitted>",
      slug: "hello",
    });
  });

  it("walks arrays", () => {
    expect(redactAuditInput({ items: [{ apiKey: "k", n: 1 }] })).toEqual({ items: [{ apiKey: "<redacted>", n: 1 }] });
  });
});
