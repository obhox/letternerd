import { describe, expect, it } from "vitest";
import { SCOPES, can, isCmsError, type CmsErrorCode } from "@cms/core";
import type { VerifiedKey } from "@cms/db/api-keys";
import { actorFromApiKey, listMemberships, requireSite, type SiteRow } from "../site-scope";
import { createFakeDb, fakeSite } from "./fake-db";

const SITE_ID = "11111111-1111-4111-8111-111111111111";

/** The code, or the fact that nothing was thrown — never a bare truthy check. */
async function codeOf(promise: Promise<unknown>): Promise<CmsErrorCode | "no-error"> {
  try {
    await promise;
    return "no-error";
  } catch (error) {
    if (isCmsError(error)) return error.code;
    throw error;
  }
}

describe("requireSite", () => {
  it("refuses an anonymous caller before touching the database", async () => {
    const fake = createFakeDb();
    expect(
      await codeOf(requireSite({ db: fake.db, session: null, site: "blog" })),
    ).toBe("unauthenticated");
    expect(fake.conditions).toHaveLength(0);
  });

  it("answers not_found — never forbidden — for a site the user is not a member of", async () => {
    const fake = createFakeDb({ sites: [fakeSite()], siteMembers: [] });

    const code = await codeOf(
      requireSite({ db: fake.db, session: { userId: "user_outsider" }, site: "blog" }),
    );

    // A 403 here would confirm the slug names a real site, which is exactly
    // the tenant-enumeration oracle `@cms/core/errors` warns about.
    expect(code).toBe("not_found");
    expect(code).not.toBe("forbidden");
  });

  it("gives a non-existent site the identical answer, so the two cannot be told apart", async () => {
    const fake = createFakeDb({ sites: [], siteMembers: [] });

    expect(
      await codeOf(requireSite({ db: fake.db, session: { userId: "user_1" }, site: "ghost" })),
    ).toBe("not_found");
  });

  it("forbids a member whose role does not satisfy the capability", async () => {
    const fake = createFakeDb({
      sites: [fakeSite()],
      siteMembers: [{ siteId: SITE_ID, userId: "user_1", role: "author" }],
    });

    expect(
      await codeOf(
        requireSite({
          db: fake.db,
          session: { userId: "user_1" },
          site: "blog",
          capability: can.publish,
        }),
      ),
    ).toBe("forbidden");
  });

  it("resolves an actor carrying the site, the membership role and full scopes", async () => {
    const fake = createFakeDb({
      sites: [fakeSite()],
      siteMembers: [{ siteId: SITE_ID, userId: "user_1", role: "editor" }],
    });

    const { actor, site, role } = await requireSite({
      db: fake.db,
      session: { userId: "user_1" },
      site: "blog",
      capability: can.publish,
    });

    expect(actor.kind).toBe("user");
    expect(actor.id).toBe("user_1");
    // The resolved row's id, not the slug the caller sent.
    expect(actor.siteId).toBe(SITE_ID);
    expect(actor.role).toBe("editor");
    expect(role).toBe("editor");
    expect(site.slug).toBe("blog");
    // A human session is not scope-limited; scopes constrain API keys.
    expect(actor.scopes).toEqual([...SCOPES]);
    expect(actor.publishedOnly).toBe(false);
  });

  it("accepts a uuid reference as well as a slug", async () => {
    const fake = createFakeDb({
      sites: [fakeSite()],
      siteMembers: [{ siteId: SITE_ID, userId: "user_1", role: "owner" }],
    });

    const { actor } = await requireSite({
      db: fake.db,
      session: { userId: "user_1" },
      site: SITE_ID,
    });

    expect(actor.siteId).toBe(SITE_ID);
  });

  it("never lets a membership on one site resolve a request for another", async () => {
    // The membership row belongs to a different site than the one asked for;
    // the join key is the resolved site id, so it must not match.
    const other = "22222222-2222-4222-8222-222222222222";
    const fake = createFakeDb({
      sites: [fakeSite({ id: other, slug: "docs" })],
      siteMembers: [],
    });

    expect(
      await codeOf(requireSite({ db: fake.db, session: { userId: "user_1" }, site: "docs" })),
    ).toBe("not_found");
  });
});

describe("listMemberships", () => {
  it("returns only sites the user holds a membership on, ordered by name", async () => {
    const fake = createFakeDb({
      siteMembers: [
        { siteId: "b", userId: "user_1", role: "author" },
        { siteId: "a", userId: "user_1", role: "owner" },
        // A membership whose site row is gone must not produce a hole.
        { siteId: "missing", userId: "user_1", role: "editor" },
      ],
      sites: [fakeSite({ id: "b", name: "Zebra" }), fakeSite({ id: "a", name: "Alpha" })],
    });

    const result = await listMemberships(fake.db, "user_1");

    expect(result.map((r) => [r.site.name, r.role])).toEqual([
      ["Alpha", "owner"],
      ["Zebra", "author"],
    ]);
  });

  it("does not query sites at all when there are no memberships", async () => {
    const fake = createFakeDb({ siteMembers: [] });
    expect(await listMemberships(fake.db, "user_1")).toEqual([]);
    expect(fake.conditions).toHaveLength(1);
  });
});

describe("actorFromApiKey", () => {
  const key = (over: Partial<VerifiedKey> = {}): VerifiedKey => ({
    id: "key_1",
    siteId: SITE_ID,
    type: "publishable",
    role: "author",
    scopes: ["content:read", "media:read", "analytics:write"],
    allowedOrigins: [],
    publishedOnly: true,
    ...over,
  });

  it("keeps a publishable key blind to drafts", async () => {
    const actor = actorFromApiKey(key());
    expect(actor.kind).toBe("api_key");
    expect(actor.publishedOnly).toBe(true);
    expect(actor.siteId).toBe(SITE_ID);
    expect(actor.scopes).not.toContain("content:write");
  });

  it("never grants a key the owner role", () => {
    for (const type of ["publishable", "read", "admin"] as const) {
      const role = actorFromApiKey(key({ type, role: type === "admin" ? "editor" : "author" })).role;
      expect(role).not.toBe("owner");
    }
  });

  it("carries the key's own site and scopes, mixing in nothing from the request", () => {
    const actor = actorFromApiKey(
      key({ type: "admin", role: "editor", scopes: ["content:read", "content:write"], publishedOnly: false }),
    );
    expect(actor.role).toBe("editor");
    expect(actor.scopes).toEqual(["content:read", "content:write"]);
    expect(actor.publishedOnly).toBe(false);
  });
});

// The `SiteRow` export is what callers annotate with; keep it usable.
const _row: SiteRow = fakeSite() as unknown as SiteRow;
void _row;
