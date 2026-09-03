import { beforeAll, describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { isCmsError, type Actor, type CapabilityServices } from "@cms/core";
import { INVITABLE_ROLES } from "@cms/core/roles";
import { hashApiKey } from "@cms/db/api-keys";
import { openWebhookSecret, settingsCapabilities } from "../settings";

/**
 * Site administration, tested against a hand-rolled database.
 *
 * No live Postgres and no network: the rules worth protecting here are not
 * about SQL, they are about what the handler refuses to do. A fake makes the
 * awkward states — a site with exactly one owner, a key that was revoked last
 * week — arrangeable in one line, and those are precisely the states an
 * integration test tends to skip.
 */

type Row = Record<string, unknown>;

interface FakeConfig {
  reads?: Record<string, Row[][]>;
  inserts?: Record<string, Row[][]>;
  updates?: Record<string, Row[][]>;
  deletes?: Record<string, Row[][]>;
}

interface FakeDb {
  db: unknown;
  calls: { op: string; table: string }[];
  payloads: Row[];
}

/**
 * A drizzle-shaped stub: every builder method returns itself, and awaiting the
 * chain yields the next canned result queued for whichever table the chain
 * named. Results are queued per table because several handlers read the same
 * table twice for different questions.
 */
function createFakeDb(config: FakeConfig = {}): FakeDb {
  const queues: Record<string, Record<string, Row[][]>> = {
    read: structuredClone(config.reads ?? {}),
    insert: structuredClone(config.inserts ?? {}),
    update: structuredClone(config.updates ?? {}),
    delete: structuredClone(config.deletes ?? {}),
  };
  const calls: { op: string; table: string }[] = [];
  const payloads: Row[] = [];

  const CHAIN_METHODS = [
    "from",
    "where",
    "orderBy",
    "limit",
    "offset",
    "groupBy",
    "having",
    "leftJoin",
    "innerJoin",
    "for",
    "onConflictDoNothing",
    "onConflictDoUpdate",
    "returning",
    "set",
    "values",
  ];

  function make(op: string, initialTable: string | null): Record<string, unknown> {
    let table = initialTable;
    const chain: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      chain[method] = (...args: unknown[]) => {
        if (method === "from") table = getTableName(args[0] as never);
        // Captured so a test can assert what was actually written — the point
        // of the API-key test is that the plaintext is not among it.
        if (method === "set" || method === "values") payloads.push(args[0] as Row);
        return chain;
      };
    }
    chain["then"] = (onOk: (rows: Row[]) => unknown, onErr?: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => {
          const name = table ?? "<unknown>";
          calls.push({ op, table: name });
          const queue = queues[op]?.[name];
          return queue && queue.length > 0 ? (queue.shift() as Row[]) : [];
        })
        .then(onOk, onErr);
    return chain;
  }

  const db: Record<string, unknown> = {
    select: () => make("read", null),
    insert: (table: unknown) => make("insert", getTableName(table as never)),
    update: (table: unknown) => make("update", getTableName(table as never)),
    delete: (table: unknown) => make("delete", getTableName(table as never)),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };

  return { db, calls, payloads };
}

const NOW = new Date("2026-03-01T12:00:00.000Z");

// Webhook signing secrets are sealed with the same key as OAuth tokens.
beforeAll(() => {
  process.env.ANALYTICS_ENCRYPTION_KEY = "3f9a1c7e5b2d8f0a4c6e9b1d3f5a7c9e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a";
});

const OWNER: Actor = {
  kind: "user",
  id: "user-ada",
  siteId: "site-1",
  role: "owner",
  scopes: ["site:admin"],
  publishedOnly: false,
};

function servicesOf(fake: FakeDb): CapabilityServices {
  return { db: fake.db, storage: {}, now: () => NOW } as unknown as CapabilityServices;
}

function capability(name: string) {
  const found = settingsCapabilities.find((cap) => cap.name === name);
  if (!found) throw new Error(`No capability named "${name}".`);
  return found;
}

/**
 * Deliberately typed as `unknown`. The registry is heterogeneous, so `invoke`
 * returns a union of every capability's output; each test says which shape it
 * expects rather than the helper guessing.
 */
async function run(
  name: string,
  input: unknown,
  fake: FakeDb,
  actor: Actor = OWNER,
): Promise<unknown> {
  return capability(name).invoke(input, { actor, services: servicesOf(fake) });
}

async function failure(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    if (isCmsError(error)) return { code: error.code, message: error.message };
    throw error;
  }
  throw new Error("Expected the capability to refuse, but it succeeded.");
}

const member = (userId: string, role: string): Row => ({
  membershipId: `m-${userId}`,
  userId,
  role,
  createdAt: NOW,
  email: `${userId}@example.com`,
  name: userId,
});

/* ------------------------------------------------------------------ */

describe("every settings capability is owner-only", () => {
  it("requires the site:admin scope and the owner role", () => {
    for (const cap of settingsCapabilities) {
      expect(cap.scopes, `${cap.name} must require site:admin`).toContain("site:admin");
      expect(cap.role, `${cap.name} must be owner-only`).toBe("owner");
    }
  });

  it("refuses an editor, whatever scopes their credential carries", async () => {
    const editor: Actor = { ...OWNER, role: "editor" };
    const result = await failure(run("list_api_keys", {}, createFakeDb(), editor));
    expect(result.code).toBe("forbidden");
  });

  it("refuses a credential without site:admin, whatever role the holder has", async () => {
    const keyActor: Actor = { ...OWNER, kind: "api_key", scopes: ["content:read"] };
    const result = await failure(run("list_api_keys", {}, createFakeDb(), keyActor));
    expect(result.code).toBe("forbidden");
  });
});

describe("api keys", () => {
  it("returns the plaintext exactly once and stores only its digest", async () => {
    const fake = createFakeDb({
      inserts: {
        api_keys: [
          [
            {
              id: "key-1",
              name: "CI",
              type: "admin",
              keyPrefix: "cms_ak_abcdef",
              scopes: ["content:read"],
              allowedOrigins: [],
              lastUsedAt: null,
              expiresAt: null,
              revokedAt: null,
              createdAt: NOW,
            },
          ],
        ],
      },
    });

    const result = (await run("create_api_key", { name: "CI", type: "admin" }, fake)) as {
      plaintext: string;
      shownOnce: boolean;
      notice: string;
      key: Row;
    };

    expect(result.plaintext.startsWith("cms_ak_")).toBe(true);
    expect(result.shownOnce).toBe(true);
    // The response must say, in words, that this cannot be recovered — an
    // editor who assumes they can come back for it later has already lost it.
    expect(result.notice.toLowerCase()).toContain("only time");
    expect(result.notice.toLowerCase()).toContain("revoke");

    const written = fake.payloads[0];
    expect(written).toBeDefined();
    expect(Object.keys(written as Row)).not.toContain("plaintext");
    expect((written as Row)["keyHash"]).toBe(hashApiKey(result.plaintext));
    expect((written as Row)["keyHash"]).not.toBe(result.plaintext);

    // The returned record carries no secret material of any kind.
    expect(JSON.stringify(result.key)).not.toContain(result.plaintext);
    expect(JSON.stringify(result.key)).not.toContain("keyHash");
  });

  it("never returns a plaintext or a digest from the listing", async () => {
    const fake = createFakeDb({
      reads: {
        api_keys: [
          [
            {
              id: "key-1",
              name: "CI",
              type: "admin",
              keyPrefix: "cms_ak_abcdef",
              scopes: [],
              allowedOrigins: [],
              lastUsedAt: null,
              expiresAt: null,
              revokedAt: null,
              createdAt: NOW,
            },
          ],
        ],
      },
    });

    const result = (await run("list_api_keys", {}, fake)) as { keys: Row[] };
    const serialised = JSON.stringify(result);

    expect(result.keys).toHaveLength(1);
    expect(serialised).not.toContain("keyHash");
    expect(serialised).not.toContain("plaintext");
    expect(result.keys[0]).toHaveProperty("keyPrefix", "cms_ak_abcdef");
  });

  it("excludes revoked keys by default but always says how many there are", async () => {
    const rows = [
      { id: "live", name: "live", type: "read", keyPrefix: "cms_sk_aaaaaa", scopes: [], allowedOrigins: [], lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: NOW },
      { id: "dead", name: "dead", type: "read", keyPrefix: "cms_sk_bbbbbb", scopes: [], allowedOrigins: [], lastUsedAt: null, expiresAt: null, revokedAt: NOW, createdAt: NOW },
    ];

    const hidden = (await run("list_api_keys", {}, createFakeDb({ reads: { api_keys: [rows] } }))) as {
      keys: Row[];
      activeCount: number;
      revokedCount: number;
    };
    expect(hidden.keys.map((key) => key["id"])).toEqual(["live"]);
    expect(hidden.activeCount).toBe(1);
    // Silence about the revoked one would make "I revoked that key" unverifiable.
    expect(hidden.revokedCount).toBe(1);

    const shown = (await run(
      "list_api_keys",
      { includeRevoked: true },
      createFakeDb({ reads: { api_keys: [rows] } }),
    )) as { keys: Row[] };
    expect(shown.keys.map((key) => key["id"])).toEqual(["live", "dead"]);
  });

  it("treats revoking an already-revoked key as a success without writing again", async () => {
    const fake = createFakeDb({
      reads: { api_keys: [[{ id: "dead", revokedAt: NOW, keyPrefix: "cms_sk_bbbbbb" }]] },
    });
    const result = (await run("revoke_api_key", { id: "3f1b6c4e-0000-4000-8000-000000000000" }, fake)) as {
      alreadyRevoked: boolean;
    };
    expect(result.alreadyRevoked).toBe(true);
    expect(fake.calls.filter((call) => call.op === "update")).toHaveLength(0);
  });

  it("reports a missing key as not found rather than silently succeeding", async () => {
    const result = await failure(
      run("revoke_api_key", { id: "3f1b6c4e-0000-4000-8000-000000000000" }, createFakeDb()),
    );
    expect(result.code).toBe("not_found");
  });
});

describe("the last owner cannot be demoted", () => {
  it("refuses to change the only owner's role", async () => {
    const fake = createFakeDb({ reads: { site_members: [[member("user-ada", "owner"), member("user-bo", "editor")]] } });

    const result = await failure(run("update_member_role", { userId: "user-ada", role: "editor" }, fake));

    expect(result.code).toBe("precondition_failed");
    expect(result.message).toContain("only owner");
    // Nothing may have been written on the way to refusing.
    expect(fake.calls.filter((call) => call.op === "update")).toHaveLength(0);
  });

  it("refuses even when the only owner is demoting themselves", async () => {
    const fake = createFakeDb({ reads: { site_members: [[member("user-ada", "owner")]] } });
    const result = await failure(run("update_member_role", { userId: OWNER.id, role: "author" }, fake));
    expect(result.code).toBe("precondition_failed");
  });

  it("allows the demotion once a second owner exists", async () => {
    const fake = createFakeDb({
      reads: { site_members: [[member("user-ada", "owner"), member("user-bo", "owner")]] },
      updates: { site_members: [[{ userId: "user-ada", role: "editor" }]] },
    });

    const result = (await run("update_member_role", { userId: "user-ada", role: "editor" }, fake)) as {
      member: Row;
      selfChanged: boolean;
    };

    expect(result.member["role"]).toBe("editor");
    expect(result.selfChanged).toBe(true);
  });

  it("leaves a non-owner's role change untouched by the rule", async () => {
    const fake = createFakeDb({
      reads: { site_members: [[member("user-ada", "owner"), member("user-bo", "author")]] },
      updates: { site_members: [[{ userId: "user-bo", role: "editor" }]] },
    });
    const result = (await run("update_member_role", { userId: "user-bo", role: "editor" }, fake)) as {
      member: Row;
    };
    expect(result.member["role"]).toBe("editor");
  });

  it("takes a locking read, so two simultaneous demotions cannot both pass", async () => {
    const fake = createFakeDb({
      reads: { site_members: [[member("user-ada", "owner"), member("user-bo", "owner")]] },
      updates: { site_members: [[{ userId: "user-ada", role: "editor" }]] },
    });
    let locked = false;
    const originalSelect = (fake.db as { select: () => Record<string, unknown> }).select;
    (fake.db as { select: () => Record<string, unknown> }).select = () => {
      const chain = originalSelect();
      const original = chain["for"] as (...args: unknown[]) => unknown;
      chain["for"] = (...args: unknown[]) => {
        if (args[0] === "update") locked = true;
        return original(...args);
      };
      return chain;
    };

    await run("update_member_role", { userId: "user-ada", role: "editor" }, fake);
    expect(locked).toBe(true);
  });
});

describe("the last owner cannot be removed", () => {
  it("refuses to remove the only owner", async () => {
    const fake = createFakeDb({ reads: { site_members: [[member("user-ada", "owner"), member("user-bo", "editor")]] } });

    const result = await failure(run("remove_member", { userId: "user-ada" }, fake));

    expect(result.code).toBe("precondition_failed");
    expect(result.message).toContain("only owner");
    expect(fake.calls.filter((call) => call.op === "delete")).toHaveLength(0);
  });

  it("refuses even when the only owner is removing themselves", async () => {
    const fake = createFakeDb({ reads: { site_members: [[member("user-ada", "owner")]] } });
    const result = await failure(run("remove_member", { userId: OWNER.id }, fake));
    expect(result.code).toBe("precondition_failed");
  });

  it("allows the removal once a second owner exists", async () => {
    const fake = createFakeDb({
      reads: { site_members: [[member("user-ada", "owner"), member("user-bo", "owner")]] },
      deletes: { site_members: [[{ userId: "user-bo" }]] },
    });
    const result = (await run("remove_member", { userId: "user-bo" }, fake)) as { removed: boolean };
    expect(result.removed).toBe(true);
  });

  it("reports someone who is not a member as not found", async () => {
    const fake = createFakeDb({ reads: { site_members: [[member("user-ada", "owner")]] } });
    const result = await failure(run("remove_member", { userId: "stranger" }, fake));
    expect(result.code).toBe("not_found");
  });
});

describe("invitations", () => {
  it("cannot mint an owner", async () => {
    // The rule is stated once in @cms/core and bound in three places; this
    // asserts the outermost of them, where untrusted input arrives.
    expect(INVITABLE_ROLES).not.toContain("owner");

    const fake = createFakeDb({ reads: { site_members: [[member("user-ada", "owner")]] } });
    const result = await failure(run("invite_member", { email: "bo@example.com", role: "owner" }, fake));

    expect(result.code).toBe("invalid_input");
    expect(fake.calls.filter((call) => call.op === "insert")).toHaveLength(0);
  });

  it("returns the acceptance link once and stores only the token's digest", async () => {
    const fake = createFakeDb({
      reads: { site_members: [[member("user-ada", "owner")]] },
      inserts: {
        site_invitations: [
          [
            {
              id: "inv-1",
              siteId: "site-1",
              email: "bo@example.com",
              role: "editor",
              expiresAt: new Date("2026-03-04T12:00:00.000Z"),
            },
          ],
        ],
      },
    });

    const result = (await run("invite_member", { email: "bo@example.com", role: "editor" }, fake)) as {
      acceptPath: string;
      shownOnce: boolean;
      invitation: Row;
    };

    const token = result.acceptPath.replace("/accept-invite/", "");
    expect(token.length).toBeGreaterThan(20);
    expect(result.shownOnce).toBe(true);

    const written = fake.payloads[0] as Row;
    expect(written["tokenHash"]).toBeTypeOf("string");
    expect(written["tokenHash"]).not.toBe(token);
    expect(JSON.stringify(written)).not.toContain(token);
    // The response carries no role the invitation could not grant.
    expect(result.invitation["role"]).toBe("editor");
  });

  it("refuses to invite somebody who already has a seat", async () => {
    const fake = createFakeDb({
      reads: { site_members: [[member("user-ada", "owner"), { ...member("user-bo", "author"), email: "BO@example.com" }]] },
    });
    const result = await failure(run("invite_member", { email: "bo@example.com", role: "author" }, fake));
    expect(result.code).toBe("conflict");
  });
});

describe("webhooks", () => {
  it("returns the signing secret when creating and never afterwards", async () => {
    const created = createFakeDb({
      inserts: {
        webhooks: [[{ id: "wh-1", url: "https://site.example/hook", events: ["document.published"], isActive: true, createdAt: NOW }]],
      },
    });

    const result = (await run(
      "upsert_webhook",
      { url: "https://site.example/hook", events: ["document.published"] },
      created,
    )) as { secret: string | undefined; shownOnce: boolean; webhook: Row };

    expect(result.secret).toBeTypeOf("string");
    expect(result.shownOnce).toBe(true);
    expect(JSON.stringify(result.webhook)).not.toContain(result.secret as string);

    const updated = createFakeDb({
      updates: {
        webhooks: [[{ id: "wh-1", url: "https://site.example/hook2", events: ["document.updated"], isActive: true, createdAt: NOW }]],
      },
    });

    const second = (await run(
      "upsert_webhook",
      {
        id: "3f1b6c4e-0000-4000-8000-000000000000",
        url: "https://site.example/hook2",
        events: ["document.updated"],
      },
      updated,
    )) as { secret: string | undefined; shownOnce: boolean };

    // An ordinary edit has no secret to report, and must not read one back.
    expect(second.secret).toBeUndefined();
    expect(second.shownOnce).toBe(false);
    expect(Object.keys(updated.payloads[0] as Row)).not.toContain("secret");
  });

  it("issues a different secret on rotation and says the old one has stopped working", async () => {
    const fake = createFakeDb({
      updates: {
        webhooks: [[{ id: "wh-1", url: "https://site.example/hook", events: ["document.published"], isActive: true, createdAt: NOW }]],
      },
    });

    const result = (await run(
      "upsert_webhook",
      {
        id: "3f1b6c4e-0000-4000-8000-000000000000",
        url: "https://site.example/hook",
        events: ["document.published"],
        rotateSecret: true,
      },
      fake,
    )) as { secret: string | undefined; notice: string | null };

    expect(result.secret).toBeTypeOf("string");
    expect(result.notice ?? "").toContain("stopped working");
    // Sealed at rest: the row holds ciphertext, never the value the caller saw.
    const stored = (fake.payloads[0] as Row)["secret"] as string;
    expect(stored).toMatch(/^enc1:/);
    expect(stored).not.toContain(result.secret as string);
    expect(openWebhookSecret(stored)).toBe(result.secret);
  });

  it("refuses a plaintext-http endpoint, where the signature would be decorative", async () => {
    const result = await failure(
      run("upsert_webhook", { url: "http://site.example/hook", events: ["document.published"] }, createFakeDb()),
    );
    expect(result.code).toBe("invalid_input");
  });

  it("never returns a secret from the listing", async () => {
    const fake = createFakeDb({
      reads: {
        webhooks: [[{ id: "wh-1", url: "https://site.example/hook", events: [], isActive: true, createdAt: NOW }]],
      },
    });
    const result = (await run("list_webhooks", {}, fake)) as { webhooks: Row[] };
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});

describe("webhook destinations", () => {
  it.each([
    ["https://169.254.169.254/latest/meta-data", "literal_private_address"],
    ["https://localhost:3000/api/cron/publish-scheduled", "blocked_hostname"],
    ["https://postgres/", "blocked_hostname"],
    ["https://[::1]/", "literal_private_address"],
    ["https://user:pw@hooks.example/", "credentials_in_url"],
  ])("refuses %s (%s) before writing anything", async (url, problem) => {
    const fake = createFakeDb();
    await expect(run("upsert_webhook", { url, events: ["document.published"] }, fake)).rejects.toMatchObject({
      code: "invalid_input",
      details: { problem },
    });
    expect(fake.payloads).toHaveLength(0);
  });

  it("refuses a hostname that resolves to a private address when a resolver is available", async () => {
    const fake = createFakeDb();
    const services = {
      ...servicesOf(fake),
      net: { resolve: async () => ["93.184.216.34", "10.0.0.5"] },
    } as unknown as CapabilityServices;
    await expect(
      capability("upsert_webhook").invoke({ url: "https://hooks.example/x", events: ["document.published"] }, { actor: OWNER, services }),
    ).rejects.toMatchObject({ code: "invalid_input", details: { problem: "resolves_to_private_address" } });
    expect(fake.payloads).toHaveLength(0);
  });
});

describe("publishable key origins", () => {
  it("defaults an empty allow-list to the site's own origins", async () => {
    const fake = createFakeDb({
      reads: {
        sites: [[{ id: "site-1", baseUrl: "https://blog.example", additionalDomains: ["https://staging.blog.example/"] }]],
      },
      inserts: { api_keys: [[{ id: "k1", name: "web", type: "publishable", keyPrefix: "cms_pk_aaaaaa", scopes: [], allowedOrigins: ["https://blog.example", "https://staging.blog.example"], lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: NOW }]] },
      },
    );
    await run("create_api_key", { name: "web", type: "publishable" }, fake);
    expect((fake.payloads[0] as Row)["allowedOrigins"]).toEqual(["https://blog.example", "https://staging.blog.example"]);
  });

  it("normalises supplied origins and does not consult the site for other key types", async () => {
    const fake = createFakeDb({
      inserts: { api_keys: [[{ id: "k1", name: "ci", type: "admin", keyPrefix: "cms_ak_aaaaaa", scopes: [], allowedOrigins: [], lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: NOW }]] },
    });
    await run("create_api_key", { name: "ci", type: "admin", allowedOrigins: ["https://x.example/path/"] }, fake);
    expect((fake.payloads[0] as Row)["allowedOrigins"]).toEqual(["https://x.example"]);
    expect(fake.calls.some((c) => c.table === "sites")).toBe(false);
  });
});
