import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isCmsError, type CmsErrorCode } from "@cms/core";
import { acceptInvitation, createInvitation, hashInvitationToken } from "../invitations";
import { createFakeDb } from "./fake-db";

const SITE_ID = "11111111-1111-4111-8111-111111111111";

async function codeOf(promise: Promise<unknown>): Promise<CmsErrorCode | "no-error"> {
  try {
    await promise;
    return "no-error";
  } catch (error) {
    if (isCmsError(error)) return error.code;
    throw error;
  }
}

function invitationRow(over: Record<string, unknown> = {}) {
  return {
    id: "inv_1",
    siteId: SITE_ID,
    email: "ada@example.com",
    role: "editor",
    tokenHash: hashInvitationToken("plaintext-token"),
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    invitedByUserId: "user_owner",
    ...over,
  };
}

function accept(rows: ReturnType<typeof invitationRow>[], over: Record<string, unknown> = {}) {
  const fake = createFakeDb({ siteInvitations: rows });
  const promise = acceptInvitation({
    db: fake.db,
    token: "plaintext-token",
    userId: "user_ada",
    userEmail: "ada@example.com",
    emailVerified: true,
    ...over,
  });
  return { fake, promise };
}

describe("createInvitation", () => {
  it("returns the plaintext once and stores only its digest", async () => {
    const fake = createFakeDb();

    const issued = await createInvitation({
      db: fake.db,
      siteId: SITE_ID,
      email: "Ada@Example.com",
      role: "editor",
      invitedByUserId: "user_owner",
    });

    const stored = fake.inserts[0]!;
    expect(stored.table).toBe("siteInvitations");
    expect(stored.values.tokenHash).toBe(
      createHash("sha256").update(issued.token).digest("hex"),
    );

    // Nothing written to the row may be, or contain, the token itself.
    const serialized = JSON.stringify(stored.values);
    expect(serialized).not.toContain(issued.token);
    expect(stored.values).not.toHaveProperty("token");

    // The address is normalised on the way in, so the match at redemption is
    // comparing like with like.
    expect(stored.values.email).toBe("ada@example.com");
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses to mint an owner", async () => {
    const fake = createFakeDb();
    expect(
      await codeOf(
        createInvitation({
          db: fake.db,
          siteId: SITE_ID,
          email: "ada@example.com",
          // The whole point of INVITABLE_ROLES; an emailed link is the weakest
          // credential in the system and must not carry the strongest role.
          role: "owner",
          invitedByUserId: "user_owner",
        }),
      ),
    ).toBe("invalid_input");
    expect(fake.inserts).toHaveLength(0);
  });

  it("issues a different token every time", async () => {
    const fake = createFakeDb();
    const args = {
      db: fake.db,
      siteId: SITE_ID,
      email: "ada@example.com",
      role: "author" as const,
      invitedByUserId: "user_owner",
    };
    const a = await createInvitation(args);
    const b = await createInvitation(args);
    expect(a.token).not.toBe(b.token);
  });
});

describe("acceptInvitation", () => {
  it("refuses an unverified account before reading anything", async () => {
    const { fake, promise } = accept([invitationRow()], { emailVerified: false });
    // The escalation: sign-up asks only for an address, so an unproved one
    // could otherwise claim a seat invited to somebody else.
    expect(await codeOf(promise)).toBe("forbidden");
    expect(fake.transactions).toBe(0);
    expect(fake.inserts).toHaveLength(0);
  });

  it("refuses an account whose address is not the invited one", async () => {
    const { fake, promise } = accept([invitationRow()], { userEmail: "mallory@example.com" });
    expect(await codeOf(promise)).toBe("forbidden");
    expect(fake.inserts).toHaveLength(0);
  });

  it("refuses an expired invitation", async () => {
    const { fake, promise } = accept([
      invitationRow({ expiresAt: new Date(Date.now() - 1000) }),
    ]);
    expect(await codeOf(promise)).toBe("precondition_failed");
    expect(fake.inserts).toHaveLength(0);
  });

  it("refuses an invitation that has already been accepted", async () => {
    const { fake, promise } = accept([invitationRow({ acceptedAt: new Date() })]);
    expect(await codeOf(promise)).toBe("conflict");
    expect(fake.inserts).toHaveLength(0);
  });

  it("answers not_found for a token that matches nothing", async () => {
    const { promise } = accept([]);
    expect(await codeOf(promise)).toBe("not_found");
  });

  it("refuses an owner invitation even if one reached the table", async () => {
    // Rows can arrive from a migration or a direct statement; redemption is
    // where a role becomes real permission, so it is checked again here.
    const { fake, promise } = accept([invitationRow({ role: "owner" })]);
    expect(await codeOf(promise)).toBe("forbidden");
    expect(fake.inserts).toHaveLength(0);
  });

  it("matches the invited address case-insensitively", async () => {
    const { promise } = accept([invitationRow()], { userEmail: "  Ada@Example.com " });
    await expect(promise).resolves.toEqual({ siteId: SITE_ID, role: "editor" });
  });

  it("creates the membership and marks the invitation used, in one transaction", async () => {
    const { fake, promise } = accept([invitationRow()]);

    await expect(promise).resolves.toEqual({ siteId: SITE_ID, role: "editor" });

    expect(fake.transactions).toBe(1);
    expect(fake.inserts).toEqual([
      { table: "siteMembers", values: { siteId: SITE_ID, userId: "user_ada", role: "editor" } },
    ]);

    const update = fake.updates[0]!;
    expect(update.table).toBe("siteInvitations");
    expect(update.set.acceptedAt).toBeInstanceOf(Date);
    expect(update.where).toBeDefined();
  });

  it("looks the invitation up by digest, never by the plaintext", async () => {
    const { fake, promise } = accept([invitationRow()]);
    await promise;
    // The marker the fake operator produced: [column, comparand].
    const condition = fake.conditions[0] as { op: string; args: unknown[] };
    expect(condition.op).toBe("eq");
    expect(condition.args[1]).toBe(hashInvitationToken("plaintext-token"));
    expect(condition.args).not.toContain("plaintext-token");
  });
});
