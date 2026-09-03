import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { isCmsError, type Actor, type CapabilityServices } from "@cms/core";
import {
  EncryptionKeyError,
  TokenDecryptionError,
  connectionsCapabilities,
  createTokenCipher,
  parseEncryptionKey,
  resolveProviderForSite,
} from "../connections";

/**
 * Analytics credential storage.
 *
 * Two things are worth testing here and they are both about refusal rather than
 * about happy paths. The first is that a stored token is genuinely encrypted —
 * that a tampered row fails loudly instead of decrypting into something that
 * gets posted to Google, and that a wrong-length key is rejected before any
 * ciphertext exists. The second is that nothing that reads these rows ever
 * hands a token back out, and that the thing insights depends on
 * (`resolveProviderForSite`) degrades to null rather than taking a page down.
 *
 * The OAuth `state` envelope is tested next to the routes that mint and read
 * it, in `apps/studio/src/app/api/oauth/google/__tests__/state.test.ts`.
 *
 * The database is the same hand-rolled drizzle stub `settings.test.ts` uses,
 * for the same reason: the interesting states — a connection whose access token
 * expired forty minutes ago, a row whose ciphertext was edited — are one line
 * to arrange here and awkward to arrange against live Postgres.
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
    "catch",
  ];

  function make(op: string, initialTable: string | null): Record<string, unknown> {
    let table = initialTable;
    const chain: Record<string, unknown> = {};
    for (const method of CHAIN_METHODS) {
      chain[method] = (...args: unknown[]) => {
        if (method === "from") table = getTableName(args[0] as never);
        // Captured so a test can assert on what was actually written — the
        // point of the encryption tests is that the plaintext is not among it.
        if (method === "set" || method === "values") payloads.push(args[0] as Row);
        if (method === "onConflictDoUpdate") {
          const arg = args[0] as { set?: Row } | undefined;
          if (arg?.set) payloads.push(arg.set);
        }
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

/** 32 bytes as hex, which is what `openssl rand -hex 32` produces. */
const HEX_KEY = "a".repeat(64);
/** The same length expressed the other way an operator might generate it. */
const BASE64_KEY = Buffer.alloc(32, 7).toString("base64");

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
  const found = connectionsCapabilities.find((cap) => cap.name === name);
  if (!found) throw new Error(`No capability named "${name}".`);
  return found;
}

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

const connectionRow = (over: Row = {}): Row => ({
  id: "conn-1",
  provider: "search_console",
  propertyUrl: "sc-domain:example.com",
  scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
  accessTokenExpiresAt: new Date(NOW.getTime() + 3_000_000),
  connectedByUserId: "user-ada",
  lastSyncedAt: null,
  lastError: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

/* ------------------------------------------------------------------ */
/* Encryption                                                          */
/* ------------------------------------------------------------------ */

describe("token encryption", () => {
  it("round-trips a refresh token through iv:authTag:ciphertext", () => {
    const cipher = createTokenCipher(HEX_KEY);
    const token = "1//0gL8xexample-refresh-token-with-slashes/and+plus";

    const stored = cipher.encrypt(token);

    expect(stored.split(":")).toHaveLength(3);
    // The whole point: the stored form contains none of the input.
    expect(stored).not.toContain(token);
    expect(cipher.decrypt(stored)).toBe(token);
  });

  it("produces a different ciphertext every time, because the IV is fresh", () => {
    const cipher = createTokenCipher(HEX_KEY);
    const a = cipher.encrypt("same-token");
    const b = cipher.encrypt("same-token");

    // Equal ciphertexts would mean a reused (key, IV) pair, which is the one
    // mistake that breaks GCM outright.
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe("same-token");
    expect(cipher.decrypt(b)).toBe("same-token");
  });

  it("accepts a base64 key as well as a hex one", () => {
    const cipher = createTokenCipher(BASE64_KEY);
    expect(cipher.decrypt(cipher.encrypt("token"))).toBe("token");
  });

  it("derives the same 32 bytes from a hex key regardless of case or padding", () => {
    expect(parseEncryptionKey(`  ${HEX_KEY.toUpperCase()}  `)).toEqual(
      parseEncryptionKey(HEX_KEY),
    );
  });

  it("fails authentication on a tampered ciphertext rather than returning garbage", () => {
    const cipher = createTokenCipher(HEX_KEY);
    const stored = cipher.encrypt("refresh-token");
    const [iv, tag, body] = stored.split(":") as [string, string, string];

    // Flip a character in the ciphertext body, keeping it valid base64.
    const flipped = `${body[0] === "A" ? "B" : "A"}${body.slice(1)}`;

    expect(() => cipher.decrypt(`${iv}:${tag}:${flipped}`)).toThrow(TokenDecryptionError);
  });

  it("rejects a swapped auth tag", () => {
    const cipher = createTokenCipher(HEX_KEY);
    const first = cipher.encrypt("token-one").split(":") as [string, string, string];
    const second = cipher.encrypt("token-two").split(":") as [string, string, string];

    expect(() => cipher.decrypt(`${first[0]}:${second[1]}:${first[2]}`)).toThrow(
      TokenDecryptionError,
    );
  });

  it("rejects ciphertext encrypted under a different key", () => {
    const stored = createTokenCipher(HEX_KEY).encrypt("token");
    const other = createTokenCipher("b".repeat(64));

    expect(() => other.decrypt(stored)).toThrow(TokenDecryptionError);
  });

  it("rejects a payload that is not three parts", () => {
    const cipher = createTokenCipher(HEX_KEY);
    // A bare token in the column — what a "fall back to plaintext" bug leaves
    // behind — must not read back as a usable value.
    expect(() => cipher.decrypt("plain-refresh-token")).toThrow(TokenDecryptionError);
  });

  it("refuses a wrong-length key at construction, before any ciphertext exists", () => {
    // 16 bytes: AES-128's key, and a plausible copy-paste.
    expect(() => createTokenCipher("a".repeat(32))).toThrow(EncryptionKeyError);
    // 48 bytes, from `openssl rand -base64 48` — the auth-secret recipe.
    expect(() => createTokenCipher(Buffer.alloc(48, 1).toString("base64"))).toThrow(
      EncryptionKeyError,
    );
    expect(() => createTokenCipher(Buffer.alloc(31, 1).toString("base64"))).toThrow(
      EncryptionKeyError,
    );
  });

  it("refuses a missing or blank key rather than storing plaintext", () => {
    expect(() => createTokenCipher(undefined)).toThrow(EncryptionKeyError);
    expect(() => createTokenCipher(null)).toThrow(EncryptionKeyError);
    expect(() => createTokenCipher("   ")).toThrow(EncryptionKeyError);
  });

  it("names the length it actually got, so an operator knows which flag was wrong", () => {
    expect(() => parseEncryptionKey(Buffer.alloc(24, 1).toString("base64"))).toThrow(
      /decoded to 24/,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Capability surface                                                  */
/* ------------------------------------------------------------------ */

describe("every connection capability is owner-only", () => {
  it("requires the site:admin scope and the owner role", () => {
    for (const cap of connectionsCapabilities) {
      expect(cap.scopes, `${cap.name} must require site:admin`).toContain("site:admin");
      expect(cap.role, `${cap.name} must be owner-only`).toBe("owner");
    }
  });

  it("marks disconnect_connection destructive", () => {
    expect(capability("disconnect_connection").destructive).toBe(true);
  });

  it("refuses an editor", async () => {
    const editor: Actor = { ...OWNER, role: "editor" };
    const result = await failure(run("list_connections", {}, createFakeDb(), editor));
    expect(result.code).toBe("forbidden");
  });

  it("refuses a credential without site:admin", async () => {
    const keyActor: Actor = { ...OWNER, kind: "api_key", scopes: ["content:read"] };
    const result = await failure(run("list_connections", {}, createFakeDb(), keyActor));
    expect(result.code).toBe("forbidden");
  });
});

describe("list_connections", () => {
  it("never returns a token field, encrypted or otherwise", async () => {
    const fake = createFakeDb({
      reads: { site_analytics_connections: [[connectionRow()]] },
    });

    const result = (await run("list_connections", {}, fake)) as {
      connections: Record<string, unknown>[];
    };

    const [connection] = result.connections;
    expect(connection).toBeDefined();

    /**
     * An exact key allowlist rather than a "does it look secret" regex.
     *
     * `accessTokenExpiresAt` is a perfectly safe column whose name contains
     * "token", so a pattern match would either fail on it or be loosened until
     * it stopped catching anything. Naming the permitted keys means a column
     * added to the select later fails this test until someone decides it
     * belongs in a response.
     */
    expect(Object.keys(connection as Record<string, unknown>).sort()).toEqual([
      "accessTokenExpiresAt",
      "connectedByUserId",
      "createdAt",
      "expiresInSeconds",
      "id",
      "lastError",
      "lastSyncedAt",
      "propertyUrl",
      "provider",
      "scopes",
      "updatedAt",
    ]);

    // And nothing anywhere in the serialised response is a ciphertext column
    // or looks like one.
    const serialised = JSON.stringify(result);
    expect(serialised).not.toContain("Encrypted");
    expect(serialised).not.toMatch(/[A-Za-z0-9+/=]{16,}:[A-Za-z0-9+/=]{20,}:/);
  });

  it("reports the access token's remaining life, including when it has lapsed", async () => {
    const fake = createFakeDb({
      reads: {
        site_analytics_connections: [
          [
            connectionRow({ id: "a", accessTokenExpiresAt: new Date(NOW.getTime() + 600_000) }),
            connectionRow({
              id: "b",
              provider: "falorb",
              accessTokenExpiresAt: new Date(NOW.getTime() - 60_000),
            }),
            connectionRow({ id: "c", accessTokenExpiresAt: null }),
          ],
        ],
      },
    });

    const result = (await run("list_connections", {}, fake)) as {
      connections: { id: string; expiresInSeconds: number | null }[];
    };

    expect(result.connections.map((c) => c.expiresInSeconds)).toEqual([600, -60, null]);
  });

  it("names the insight rules a search connection unlocks", async () => {
    const fake = createFakeDb({ reads: { site_analytics_connections: [[]] } });
    const result = (await run("list_connections", {}, fake)) as {
      searchRulesUnlocked: string[];
    };

    expect(result.searchRulesUnlocked).toEqual([
      "low-ctr-high-impressions",
      "near-miss-ranking",
      "decaying-content",
    ]);
  });
});

describe("connect_search_console", () => {
  it("writes ciphertext, never the token it was given", async () => {
    process.env["ANALYTICS_ENCRYPTION_KEY"] = HEX_KEY;
    const fake = createFakeDb({
      inserts: { site_analytics_connections: [[connectionRow()]] },
    });

    await run(
      "connect_search_console",
      {
        propertyUrl: "sc-domain:example.com",
        refreshToken: "1//super-secret-refresh",
        accessToken: "ya29.super-secret-access",
        expiresInSeconds: 3600,
        scopes: ["https://www.googleapis.com/auth/webmasters.readonly"],
      },
      fake,
    );

    const written = JSON.stringify(fake.payloads);
    expect(written).not.toContain("1//super-secret-refresh");
    expect(written).not.toContain("ya29.super-secret-access");

    const insert = fake.payloads[0] as Record<string, unknown>;
    expect(typeof insert["refreshTokenEncrypted"]).toBe("string");
    expect(String(insert["refreshTokenEncrypted"]).split(":")).toHaveLength(3);
    // Expiry is stored as an absolute time derived from the injected clock.
    expect(insert["accessTokenExpiresAt"]).toEqual(new Date(NOW.getTime() + 3_600_000));
  });

  it("refuses a connection carrying neither token", async () => {
    process.env["ANALYTICS_ENCRYPTION_KEY"] = HEX_KEY;
    const result = await failure(
      run("connect_search_console", { propertyUrl: "sc-domain:example.com" }, createFakeDb()),
    );
    expect(result.code).toBe("invalid_input");
  });

  it("does not blank a stored refresh token when a re-consent omits one", async () => {
    process.env["ANALYTICS_ENCRYPTION_KEY"] = HEX_KEY;
    const fake = createFakeDb({
      inserts: { site_analytics_connections: [[connectionRow()]] },
    });

    await run(
      "connect_search_console",
      {
        propertyUrl: "sc-domain:example.com",
        accessToken: "ya29.only-an-access-token",
        expiresInSeconds: 3600,
      },
      fake,
    );

    // The upsert's `set` clause is the second captured payload.
    const conflictSet = fake.payloads.at(-1) as Record<string, unknown>;
    expect(conflictSet).not.toHaveProperty("refreshTokenEncrypted");
  });
});

describe("disconnect_connection", () => {
  it("deletes the row and reports what went", async () => {
    const fake = createFakeDb({
      deletes: {
        site_analytics_connections: [
          [{ id: "conn-1", provider: "search_console", propertyUrl: "sc-domain:example.com" }],
        ],
      },
    });

    const result = (await run(
      "disconnect_connection",
      { provider: "search_console" },
      fake,
    )) as { disconnected: boolean; propertyUrl: string };

    expect(result.disconnected).toBe(true);
    expect(result.propertyUrl).toBe("sc-domain:example.com");
  });

  it("is a not_found when the provider was never connected", async () => {
    const result = await failure(
      run("disconnect_connection", { provider: "falorb" }, createFakeDb()),
    );
    expect(result.code).toBe("not_found");
  });
});

/* ------------------------------------------------------------------ */
/* resolveProviderForSite                                              */
/* ------------------------------------------------------------------ */

describe("resolveProviderForSite", () => {
  const google = { clientId: "client-id", clientSecret: "client-secret" };

  it("returns null with no connection, and does not throw", async () => {
    const fake = createFakeDb({ reads: { site_analytics_connections: [[]] } });

    await expect(
      resolveProviderForSite(fake.db as never, "site-1", {
        cipher: createTokenCipher(HEX_KEY),
        google,
        now: () => NOW,
      }),
    ).resolves.toBeNull();
  });

  it("returns null rather than throwing when no encryption key is configured", async () => {
    delete process.env["ANALYTICS_ENCRYPTION_KEY"];
    const fake = createFakeDb({
      reads: { site_analytics_connections: [[{ ...connectionRow(), id: "conn-1" }]] },
    });

    await expect(
      resolveProviderForSite(fake.db as never, "site-1", { google, now: () => NOW }),
    ).resolves.toBeNull();
  });

  it("returns null when Google is not configured, leaving the row untouched", async () => {
    const fake = createFakeDb({
      reads: { site_analytics_connections: [[connectionRow()]] },
    });

    await expect(
      resolveProviderForSite(fake.db as never, "site-1", {
        cipher: createTokenCipher(HEX_KEY),
        google: null,
        now: () => NOW,
      }),
    ).resolves.toBeNull();
  });

  it("uses a live access token without refreshing", async () => {
    const cipher = createTokenCipher(HEX_KEY);
    const fake = createFakeDb({
      reads: {
        site_analytics_connections: [
          [
            {
              id: "conn-1",
              provider: "search_console",
              propertyUrl: "sc-domain:example.com",
              accessTokenEncrypted: cipher.encrypt("ya29.still-good"),
              refreshTokenEncrypted: cipher.encrypt("1//refresh"),
              accessTokenExpiresAt: new Date(NOW.getTime() + 3_000_000),
            },
          ],
        ],
      },
    });

    let called = false;
    const provider = await resolveProviderForSite(fake.db as never, "site-1", {
      cipher,
      google,
      now: () => NOW,
      fetch: async () => {
        called = true;
        return new Response("{}", { status: 200 });
      },
    });

    expect(provider).not.toBeNull();
    expect(provider?.capabilities.search).toBe(true);
    expect(called, "no HTTP call should be made just to resolve a provider").toBe(false);
    // No refresh means no write.
    expect(fake.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("refreshes an expired access token and persists the new one, encrypted", async () => {
    const cipher = createTokenCipher(HEX_KEY);
    const fake = createFakeDb({
      reads: {
        site_analytics_connections: [
          [
            {
              id: "conn-1",
              provider: "search_console",
              propertyUrl: "sc-domain:example.com",
              accessTokenEncrypted: cipher.encrypt("ya29.expired"),
              refreshTokenEncrypted: cipher.encrypt("1//the-refresh-token"),
              // Forty minutes ago.
              accessTokenExpiresAt: new Date(NOW.getTime() - 2_400_000),
            },
          ],
        ],
      },
    });

    const requests: { url: string; body: string }[] = [];

    const provider = await resolveProviderForSite(fake.db as never, "site-1", {
      cipher,
      google,
      now: () => NOW,
      fetch: async (url, init) => {
        requests.push({ url, body: String(init?.body ?? "") });
        return new Response(
          JSON.stringify({ access_token: "ya29.freshly-minted", expires_in: 3599 }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    expect(provider).not.toBeNull();

    // The refresh token was replayed to Google — which is the whole reason it
    // could not be hashed.
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("oauth2.googleapis.com/token");
    expect(requests[0]?.body).toContain(encodeURIComponent("1//the-refresh-token"));

    // And the new access token was written back, encrypted, with its expiry.
    const update = fake.payloads.at(-1) as Record<string, unknown>;
    expect(String(update["accessTokenEncrypted"]).split(":")).toHaveLength(3);
    expect(cipher.decrypt(String(update["accessTokenEncrypted"]))).toBe("ya29.freshly-minted");
    expect(update["accessTokenExpiresAt"]).toEqual(new Date(NOW.getTime() + 3_599_000));
    expect(update["lastError"]).toBeNull();
  });

  it("records the failure and returns null when Google revokes the refresh token", async () => {
    const cipher = createTokenCipher(HEX_KEY);
    const fake = createFakeDb({
      reads: {
        site_analytics_connections: [
          [
            {
              id: "conn-1",
              provider: "search_console",
              propertyUrl: "sc-domain:example.com",
              accessTokenEncrypted: null,
              refreshTokenEncrypted: cipher.encrypt("1//revoked"),
              accessTokenExpiresAt: null,
            },
          ],
        ],
      },
    });

    const provider = await resolveProviderForSite(fake.db as never, "site-1", {
      cipher,
      google,
      now: () => NOW,
      fetch: async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    });

    // Null, not a throw: the insights screen still renders its first-party rules.
    expect(provider).toBeNull();

    const update = fake.payloads.at(-1) as Record<string, unknown>;
    expect(String(update["lastError"])).toMatch(/invalid_grant|reconnect/i);
  });

  it("returns null when the stored ciphertext will not authenticate", async () => {
    const cipher = createTokenCipher(HEX_KEY);
    const fake = createFakeDb({
      reads: {
        site_analytics_connections: [
          [
            {
              id: "conn-1",
              provider: "search_console",
              propertyUrl: "sc-domain:example.com",
              accessTokenEncrypted: null,
              // Written under a different key — a rotation nobody re-encrypted for.
              refreshTokenEncrypted: createTokenCipher("c".repeat(64)).encrypt("1//refresh"),
              accessTokenExpiresAt: null,
            },
          ],
        ],
      },
    });

    await expect(
      resolveProviderForSite(fake.db as never, "site-1", { cipher, google, now: () => NOW }),
    ).resolves.toBeNull();

    const update = fake.payloads.at(-1) as Record<string, unknown>;
    expect(String(update["lastError"])).toMatch(/failed authentication/i);
  });

  it("skips a Falorb row rather than building a provider that cannot work", async () => {
    const cipher = createTokenCipher(HEX_KEY);
    const fake = createFakeDb({
      reads: {
        site_analytics_connections: [
          [
            {
              id: "conn-2",
              provider: "falorb",
              propertyUrl: "my-project",
              accessTokenEncrypted: cipher.encrypt("falorb-key"),
              refreshTokenEncrypted: null,
              accessTokenExpiresAt: null,
            },
          ],
        ],
      },
    });

    await expect(
      resolveProviderForSite(fake.db as never, "site-1", { cipher, google, now: () => NOW }),
    ).resolves.toBeNull();
  });
});
