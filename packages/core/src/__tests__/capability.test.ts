import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type Actor,
  KEY_ROLES,
  KEY_SCOPES,
  assertCanWriteDocument,
  atLeast,
  can,
  createRegistry,
  defineCapability,
  isCmsError,
  rankOf,
} from "../index";

function actor(over: Partial<Actor> = {}): Actor {
  return {
    kind: "user",
    id: "user_1",
    siteId: "site_1",
    role: "editor",
    scopes: ["content:read", "content:write", "content:publish"],
    publishedOnly: false,
    ...over,
  };
}

const ctx = (a: Actor) => ({ actor: a, services: {} });

const noop = defineCapability({
  name: "publish_document",
  title: "Publish document",
  description: "Publish a draft.",
  input: z.object({ documentId: z.string() }),
  scopes: ["content:publish"],
  role: "editor",
  route: { method: "POST", path: "/documents/:id/publish" },
  handler: async (input) => ({ ok: true, id: input.documentId }),
});

describe("role hierarchy", () => {
  it("is strictly ordered", () => {
    expect(rankOf("owner")).toBeGreaterThan(rankOf("editor"));
    expect(rankOf("editor")).toBeGreaterThan(rankOf("author"));
  });

  it("treats an unknown role as the least privileged, not the most", () => {
    expect(rankOf("superuser")).toBe(rankOf("author"));
    expect(atLeast("superuser", "editor")).toBe(false);
    expect(can.publish("")).toBe(false);
  });

  it("does not let an author publish", () => {
    expect(can.publish("author")).toBe(false);
    expect(can.publish("editor")).toBe(true);
  });
});

describe("capability.invoke", () => {
  it("runs the handler when scope and role are satisfied", async () => {
    await expect(noop.invoke({ documentId: "d1" }, ctx(actor()))).resolves.toEqual({
      ok: true,
      id: "d1",
    });
  });

  it("rejects invalid input before touching authorization", async () => {
    const err = await noop.invoke({}, ctx(actor())).catch((e) => e);
    expect(isCmsError(err) && err.code).toBe("invalid_input");
  });

  it("refuses a credential missing the scope, even with a sufficient role", async () => {
    const a = actor({ role: "owner", scopes: ["content:read"] });
    const err = await noop.invoke({ documentId: "d1" }, ctx(a)).catch((e) => e);
    expect(isCmsError(err) && err.code).toBe("forbidden");
  });

  it("refuses a role below the floor, even with the scope", async () => {
    const a = actor({ role: "author", scopes: ["content:publish"] });
    const err = await noop.invoke({ documentId: "d1" }, ctx(a)).catch((e) => e);
    expect(isCmsError(err) && err.code).toBe("forbidden");
  });
});

describe("document ownership", () => {
  it("lets an editor write anyone's document", () => {
    expect(() =>
      assertCanWriteDocument(actor({ role: "editor" }), { createdBy: "someone_else" }),
    ).not.toThrow();
  });

  it("lets an author write only their own", () => {
    const a = actor({ role: "author", id: "user_1" });
    expect(() => assertCanWriteDocument(a, { createdBy: "user_1" })).not.toThrow();
    expect(() => assertCanWriteDocument(a, { createdBy: "user_2" })).toThrow();
    expect(() => assertCanWriteDocument(a, { createdBy: null })).toThrow();
  });
});

describe("api key scopes", () => {
  it("never lets a key administer the site", () => {
    for (const type of ["publishable", "read", "admin"] as const) {
      expect(KEY_SCOPES[type]).not.toContain("site:admin");
      expect(KEY_ROLES[type]).not.toBe("owner");
    }
  });

  it("gives a browser-safe publishable key reads only", () => {
    expect(KEY_SCOPES.publishable).not.toContain("content:write");
    expect(KEY_SCOPES.publishable).not.toContain("content:publish");
  });
});

describe("registry", () => {
  it("rejects duplicate names", () => {
    expect(() => createRegistry([noop, noop])).toThrow(/Duplicate/);
  });

  it("rejects names that are not valid MCP tool names", () => {
    const bad = { ...noop, name: "Publish-Document" };
    expect(() => createRegistry([bad])).toThrow(/snake_case/);
  });
});
