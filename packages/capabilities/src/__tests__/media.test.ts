import { getTableName, type Table } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KEY_ROLES, KEY_SCOPES, SCOPES, type Actor, isCmsError } from "@cms/core";
import type { StorageService } from "@cms/media";
import { deleteMedia, listMedia, mediaCapabilities, setAltText, uploadMedia } from "../media";

/**
 * Media capabilities against fakes.
 *
 * No container and no live database, deliberately. What is worth pinning here
 * is the decision-making — dedupe before work, refuse a delete that would break
 * a published page, enforce the scope and the role — and none of that needs
 * Postgres to be true. The queries themselves are exercised by the integration
 * suite; asserting them twice would only mean two things to update when a
 * column moves.
 */

// A 1x1 transparent PNG, so the real pipeline can run without a fixture file.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

interface Recorded {
  op: "select" | "insert" | "update" | "delete";
  table: string;
  payload: unknown;
}

type Resolver = (call: Recorded) => unknown[];

/**
 * The smallest thing that can stand in for drizzle.
 *
 * Every builder method returns the same thenable, and the rows are produced
 * lazily by a per-test resolver keyed on the operation and the table. That is
 * enough because these handlers are being tested for what they decide, not for
 * the SQL they emit — a fake that tried to interpret `where` clauses would be a
 * second, worse query planner to keep correct.
 */
function fakeDb(resolve: Resolver) {
  const calls: Recorded[] = [];

  function chain(op: Recorded["op"], table: Table, payload: () => unknown) {
    const node: Record<string, unknown> = {};
    for (const method of [
      "from",
      "where",
      "orderBy",
      "limit",
      "values",
      "set",
      "onConflictDoNothing",
      "onConflictDoUpdate",
      "returning",
    ]) {
      node[method] = () => node;
    }
    node.then = (
      onFulfilled: (rows: unknown[]) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => {
      const call: Recorded = { op, table: getTableName(table), payload: payload() };
      calls.push(call);
      return Promise.resolve()
        .then(() => resolve(call))
        .then(onFulfilled, onRejected);
    };
    return node;
  }

  const db = {
    calls,
    select: (projection?: Record<string, unknown>) => ({
      from: (table: Table) => chain("select", table, () => ({ projection })),
    }),
    insert: (table: Table) => ({
      values: (values: unknown) => chain("insert", table, () => ({ values })),
    }),
    update: (table: Table) => ({
      set: (values: unknown) => chain("update", table, () => ({ set: values })),
    }),
    delete: (table: Table) => chain("delete", table, () => ({})),
    transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => fn(db),
  };

  return db;
}

function fakeStorage(): StorageService & { puts: string[]; deleted: string[] } {
  const puts: string[] = [];
  const deleted: string[] = [];
  return {
    puts,
    deleted,
    async put(key) {
      puts.push(key);
    },
    async get() {
      throw new Error("not used");
    },
    async delete(keys) {
      deleted.push(...keys);
    },
    publicUrl(key) {
      return `https://cdn.test/${key}`;
    },
  };
}

const SITE = "11111111-1111-4111-8111-111111111111";
const ASSET = "22222222-2222-4222-8222-222222222222";

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    kind: "user",
    id: "user_1",
    siteId: SITE,
    role: "editor",
    scopes: [...SCOPES],
    publishedOnly: false,
    ...overrides,
  };
}

/** What a publishable browser key actually carries, not an invented subset. */
function publishableActor(): Actor {
  return {
    kind: "api_key",
    id: "key_1",
    siteId: SITE,
    role: KEY_ROLES.publishable,
    scopes: KEY_SCOPES.publishable,
    publishedOnly: true,
  };
}

function assetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET,
    key: `sites/${SITE}/media/${ASSET}/original.png`,
    originalFilename: "header.png",
    mimeType: "image/png",
    bytes: 1024,
    width: 1200,
    height: 630,
    blurhash: "LEHV6nWB2yk8",
    dominantColor: "#334455",
    alt: null,
    caption: null,
    credit: null,
    folderId: null,
    checksumSha256: "abc123",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function services(db: unknown, storage: StorageService) {
  return { db, storage, now: () => new Date("2026-02-02T00:00:00.000Z") } as never;
}

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error("expected the capability to refuse, but it resolved");
  } catch (error) {
    if (!isCmsError(error)) throw error;
    return error;
  }
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
});

describe("list_media", () => {
  it("returns a page with each asset's ladder and the site-wide missing-alt count", async () => {
    const db = fakeDb((call) => {
      if (call.table === "media_variants") {
        return [{ id: "v1", assetId: ASSET, key: "k/320.avif", width: 320, height: 168, format: "avif", bytes: 900 }];
      }
      const projection = (call.payload as { projection?: Record<string, unknown> }).projection;
      if (projection && "missingAlt" in projection) return [{ missingAlt: 7 }];
      return [assetRow()];
    });

    const result = await listMedia.invoke({}, { actor: actor(), services: services(db, storage) });

    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.ref).toBe(`media://${ASSET}`);
    expect(result.assets[0]!.variants).toHaveLength(1);
    // Counted across the site, not across the page — the page holds one asset.
    expect(result.missingAltCount).toBe(7);
    expect(result.nextCursor).toBeNull();
  });

  it("counts the missing-alt debt even while filtered to it", async () => {
    const db = fakeDb((call) => {
      if (call.table === "media_variants") return [];
      const projection = (call.payload as { projection?: Record<string, unknown> }).projection;
      if (projection && "missingAlt" in projection) return [{ missingAlt: 3 }];
      return [assetRow(), assetRow({ id: "33333333-3333-4333-8333-333333333333" })];
    });

    const result = await listMedia.invoke(
      { missingAltOnly: true, limit: 2 },
      { actor: actor(), services: services(db, storage) },
    );

    expect(result.assets).toHaveLength(2);
    expect(result.missingAltCount).toBe(3);
  });

  it("refuses a credential without the media:read scope", async () => {
    const db = fakeDb(() => []);
    const error = await failure(
      listMedia.invoke({}, { actor: actor({ scopes: ["content:read"] }), services: services(db, storage) }),
    );
    expect(error.code).toBe("forbidden");
    expect(db.calls).toHaveLength(0);
  });
});

describe("upload_media", () => {
  it("returns the existing asset for known bytes without touching storage", async () => {
    const existing = assetRow({ alt: "A dog." });
    const db = fakeDb((call) =>
      call.table === "media_variants"
        ? [{ id: "v1", assetId: ASSET, key: "k/320.avif", width: 320, height: 168, format: "avif", bytes: 900 }]
        : [existing],
    );

    const result = await uploadMedia.invoke(
      { filename: "again.png", contentBase64: PNG_1X1 },
      { actor: actor(), services: services(db, storage) },
    );

    expect(result.deduped).toBe(true);
    expect(result.asset.id).toBe(ASSET);
    expect(result.asset.alt).toBe("A dog.");
    // The whole point of hashing first: nothing was encoded and nothing stored.
    expect(storage.puts).toEqual([]);
    expect(db.calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("processes and writes the asset with its variants when the bytes are new", async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = fakeDb((call) => {
      if (call.op === "select") return [];
      const { values } = call.payload as { values: unknown };
      inserted.push({ table: call.table, values });
      if (call.table === "media_assets") {
        return [assetRow({ ...(values as Record<string, unknown>) })];
      }
      return (values as Record<string, unknown>[]).map((v, i) => ({ id: `v${i}`, ...v }));
    });

    const result = await uploadMedia.invoke(
      { filename: "pixel.png", contentBase64: PNG_1X1, alt: "One pixel." },
      { actor: actor(), services: services(db, storage) },
    );

    expect(result.deduped).toBe(false);
    expect(result.asset.alt).toBe("One pixel.");
    expect(result.asset.variants.length).toBeGreaterThan(0);
    // Original plus every rendition, all written before the rows were created.
    expect(storage.puts.length).toBe(result.asset.variants.length + 1);
    expect(inserted.map((i) => i.table)).toEqual(["media_assets", "media_variants"]);
  });

  it("rejects an oversized upload from the encoded length, before decoding it", async () => {
    const db = fakeDb(() => []);
    const decode = vi.spyOn(Buffer, "from");

    const error = await failure(
      uploadMedia.invoke(
        // 40 MB of base64 is ~30 MB decoded, over the 25 MB ceiling.
        { filename: "huge.png", contentBase64: "A".repeat(40 * 1024 * 1024) },
        { actor: actor(), services: services(db, storage) },
      ),
    );

    expect(error.code).toBe("invalid_input");
    expect(decode).not.toHaveBeenCalled();
    expect(storage.puts).toEqual([]);
    decode.mockRestore();
  });

  it("refuses a publishable key, which can read media but never write it", async () => {
    const db = fakeDb(() => []);
    const error = await failure(
      uploadMedia.invoke(
        { filename: "x.png", contentBase64: PNG_1X1 },
        { actor: publishableActor(), services: services(db, storage) },
      ),
    );
    expect(error.code).toBe("forbidden");
    expect(error.message).toContain("media:write");
    expect(storage.puts).toEqual([]);
  });
});

describe("set_alt_text", () => {
  it("writes alt, caption and credit and returns the paste-able ref", async () => {
    let written: Record<string, unknown> | undefined;
    const db = fakeDb((call) => {
      written = (call.payload as { set: Record<string, unknown> }).set;
      return [assetRow({ alt: "A red bicycle.", caption: "Outside the shop.", credit: "J. Oguntona" })];
    });

    const result = await setAltText.invoke(
      { id: ASSET, alt: "A red bicycle.", caption: "Outside the shop.", credit: "J. Oguntona" },
      { actor: actor({ role: "author" }), services: services(db, storage) },
    );

    expect(result.alt).toBe("A red bicycle.");
    expect(result.ref).toBe(`media://${ASSET}`);
    expect(written).toMatchObject({ alt: "A red bicycle.", credit: "J. Oguntona" });
  });

  it("reads a cross-tenant or unknown id as missing rather than forbidden", async () => {
    const db = fakeDb(() => []);
    const error = await failure(
      setAltText.invoke(
        { id: ASSET, alt: "Anything." },
        { actor: actor(), services: services(db, storage) },
      ),
    );
    expect(error.code).toBe("not_found");
  });

  it("does not accept whitespace as alt text", async () => {
    const db = fakeDb(() => [assetRow()]);
    const error = await failure(
      setAltText.invoke({ id: ASSET, alt: "   " }, { actor: actor(), services: services(db, storage) }),
    );
    expect(error.code).toBe("invalid_input");
  });

  it("refuses a publishable key", async () => {
    const db = fakeDb(() => []);
    const error = await failure(
      setAltText.invoke(
        { id: ASSET, alt: "Anything." },
        { actor: publishableActor(), services: services(db, storage) },
      ),
    );
    expect(error.code).toBe("forbidden");
  });
});

describe("delete_media", () => {
  function deleteDb(referencing: Record<string, unknown>[]) {
    return fakeDb((call) => {
      if (call.op === "select" && call.table === "media_assets") return [assetRow()];
      if (call.op === "select" && call.table === "documents") return referencing;
      if (call.op === "delete" && call.table === "media_variants") {
        return [{ key: "k/320.avif" }, { key: "k/640.avif" }];
      }
      return [];
    });
  }

  it("refuses while documents still reference it, and names how many", async () => {
    const db = deleteDb([
      { id: "d1", title: "Launch post", slug: "launch", status: "published", total: 3 },
      { id: "d2", title: "Roadmap", slug: "roadmap", status: "draft", total: 3 },
    ]);

    const error = await failure(
      deleteMedia.invoke({ id: ASSET }, { actor: actor(), services: services(db, storage) }),
    );

    expect(error.code).toBe("conflict");
    expect(error.message).toContain("3 documents");
    expect(error.details.referenceCount).toBe(3);
    expect(error.details.documents).toHaveLength(2);
    // The whole refusal is pointless if the bytes went anyway.
    expect(storage.deleted).toEqual([]);
    expect(db.calls.some((c) => c.op === "delete")).toBe(false);
  });

  it("says '1 document' rather than '1 documents'", async () => {
    const db = deleteDb([{ id: "d1", title: "Only", slug: "only", status: "published", total: 1 }]);
    const error = await failure(
      deleteMedia.invoke({ id: ASSET }, { actor: actor(), services: services(db, storage) }),
    );
    expect(error.message).toContain("1 document still uses");
  });

  it("deletes the rows and every stored object once nothing references it", async () => {
    const db = deleteDb([]);

    const result = await deleteMedia.invoke(
      { id: ASSET },
      { actor: actor(), services: services(db, storage) },
    );

    expect(result).toEqual({ id: ASSET, deletedObjects: 3 });
    expect(storage.deleted).toEqual([
      "k/320.avif",
      "k/640.avif",
      `sites/${SITE}/media/${ASSET}/original.png`,
    ]);
    const deletes = db.calls.filter((c) => c.op === "delete").map((c) => c.table);
    // Variants before the asset: the other order trips the foreign key.
    expect(deletes).toEqual(["media_variants", "media_assets"]);
  });

  it("requires an editor — an author may upload media but not destroy it", async () => {
    const db = deleteDb([]);
    const error = await failure(
      deleteMedia.invoke({ id: ASSET }, { actor: actor({ role: "author" }), services: services(db, storage) }),
    );
    expect(error.code).toBe("forbidden");
    expect(error.message).toContain("editor");
    expect(db.calls).toHaveLength(0);
  });
});

describe("the exported set", () => {
  it("declares the annotations and descriptions the registry test will check", () => {
    expect(mediaCapabilities.map((c) => c.name)).toEqual([
      "list_media",
      "upload_media",
      "set_alt_text",
      "delete_media",
    ]);
    for (const cap of mediaCapabilities) {
      expect(cap.description.length, `${cap.name} description is too thin`).toBeGreaterThan(60);
      expect(cap.route.path.startsWith("/")).toBe(true);
      expect(cap.scopes.length).toBeGreaterThan(0);
    }
    expect(listMedia.readOnly).toBe(true);
    expect(deleteMedia.destructive).toBe(true);
  });
});
