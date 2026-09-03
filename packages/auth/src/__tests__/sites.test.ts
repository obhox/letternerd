import { describe, expect, it } from "vitest";
import { isCmsError, type CmsErrorCode } from "@cms/core";
import { createSite } from "../sites";
import { createFakeDb } from "./fake-db";

/**
 * `createSite`'s only real guard against a Postgres unique-constraint race is
 * the database itself — see the comment on the `catch` in `../sites.ts`. The
 * fake db here, like `fake-db.ts` says of itself, is about which decision
 * `createSite` makes and what it writes, not about exercising a real
 * constraint violation, so that backstop path is not covered here.
 */

async function codeOf(promise: Promise<unknown>): Promise<CmsErrorCode | "no-error"> {
  try {
    await promise;
    return "no-error";
  } catch (error) {
    if (isCmsError(error)) return error.code;
    throw error;
  }
}

describe("createSite", () => {
  it("refuses a blank name", async () => {
    const fake = createFakeDb();
    expect(
      await codeOf(createSite({ db: fake.db, userId: "u1", name: "   ", baseUrl: "https://example.com" })),
    ).toBe("invalid_input");
    expect(fake.inserts).toHaveLength(0);
  });

  it("refuses a base URL that is not an absolute URL", async () => {
    const fake = createFakeDb();
    expect(
      await codeOf(createSite({ db: fake.db, userId: "u1", name: "Example", baseUrl: "not-a-url" })),
    ).toBe("invalid_input");
    expect(fake.inserts).toHaveLength(0);
  });

  it("refuses a non-http(s) base URL", async () => {
    const fake = createFakeDb();
    expect(
      await codeOf(createSite({ db: fake.db, userId: "u1", name: "Example", baseUrl: "ftp://example.com" })),
    ).toBe("invalid_input");
  });

  it("refuses a name that produces no usable URL segment", async () => {
    const fake = createFakeDb();
    expect(
      await codeOf(createSite({ db: fake.db, userId: "u1", name: "🎉🎉🎉", baseUrl: "https://example.com" })),
    ).toBe("invalid_input");
  });

  it("refuses a base URL already claimed by another site", async () => {
    const fake = createFakeDb({ sites: [{ id: "s1", baseUrl: "https://example.com" }] });
    expect(
      await codeOf(createSite({ db: fake.db, userId: "u1", name: "Example", baseUrl: "https://example.com" })),
    ).toBe("conflict");
    expect(fake.inserts).toHaveLength(0);
  });

  it("skips a slug that would collide with a studio route", async () => {
    const fake = createFakeDb();
    // "Sign In" slugifies to "sign-in", which is `/sign-in` — a real route
    // this site's studio pages would otherwise shadow or be shadowed by.
    await createSite({ db: fake.db, userId: "u1", name: "Sign In", baseUrl: "https://example.com" });
    const siteInsert = fake.inserts.find((row) => row.table === "sites")!;
    expect(siteInsert.values.slug).toBe("sign-in-2");
  });

  it("creates the site and grants the creator ownership, in one transaction", async () => {
    const fake = createFakeDb();

    const result = await createSite({
      db: fake.db,
      userId: "user_ada",
      name: "  My New Site  ",
      baseUrl: "https://example.com/",
    });

    expect(fake.transactions).toBe(1);
    expect(result).toEqual({
      id: "sites_1",
      slug: "my-new-site",
      name: "My New Site",
      // Trimmed of its trailing slash, matching `updateSite`'s own storage.
      baseUrl: "https://example.com",
    });

    expect(fake.inserts).toEqual([
      {
        table: "sites",
        values: { slug: "my-new-site", name: "My New Site", baseUrl: "https://example.com" },
      },
      {
        table: "siteMembers",
        values: { siteId: "sites_1", userId: "user_ada", role: "owner" },
      },
    ]);
  });
});
