import { beforeEach, describe, expect, it } from "vitest";
import { Column, Param, SQL, getTableName } from "drizzle-orm";
import { SCOPES, type Actor, type Scope } from "@cms/core";
import type { Database } from "@cms/db";
import type { StorageService } from "@cms/media";
import {
  deleteAuthor,
  deleteRedirect,
  detectRedirectChains,
  listAuthors,
  listRedirects,
  listTerms,
  normalisePath,
  tagDocument,
  upsertAuthor,
  upsertRedirect,
  upsertTerm,
  editorialCapabilities,
} from "../editorial";

/**
 * A fake database, not a mocked one.
 *
 * These tests assert on the rules the capabilities enforce — who may call
 * them, what they refuse, what they never write — and none of that needs a
 * live Postgres. What it does need is visibility into the queries that were
 * issued, which is why every operation is recorded with the columns and bound
 * parameters it carried: that is how "scoped to the actor's site" and "never
 * touches slug_history" become assertions rather than hopes.
 *
 * Results are queued per table rather than in one global sequence, so a test
 * that adds a query to an unrelated table does not shuffle every other one.
 */

interface Op {
  kind: "select" | "insert" | "update" | "delete";
  table: string;
  columns: string[];
  params: unknown[];
  values?: unknown;
  set?: Record<string, unknown>;
}

/** Walks a drizzle condition for the columns and values it actually binds. */
function collect(node: unknown, op: Op): void {
  if (node === undefined || node === null) return;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, op);
    return;
  }
  if (node instanceof SQL) {
    collect((node as unknown as { queryChunks: unknown[] }).queryChunks, op);
    return;
  }
  if (node instanceof Column) {
    op.columns.push(node.name);
    return;
  }
  if (node instanceof Param) {
    const value = (node as { value: unknown }).value;
    if (Array.isArray(value)) op.params.push(...value);
    else op.params.push(value);
  }
}

class FakeQuery implements PromiseLike<unknown> {
  private returned = false;

  constructor(
    private readonly db: FakeDb,
    private readonly op: Op,
  ) {}

  from(table: unknown): this {
    this.op.table = getTableName(table as Parameters<typeof getTableName>[0]);
    return this;
  }
  innerJoin(_table: unknown, on: unknown): this {
    collect(on, this.op);
    return this;
  }
  where(condition: unknown): this {
    collect(condition, this.op);
    return this;
  }
  groupBy(): this {
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  values(values: unknown): this {
    this.op.values = values;
    return this;
  }
  set(values: Record<string, unknown>): this {
    this.op.set = values;
    return this;
  }
  onConflictDoNothing(): this {
    return this;
  }
  onConflictDoUpdate(config: { set: Record<string, unknown> }): this {
    this.op.set = { ...this.op.set, ...config.set };
    return this;
  }
  returning(): this {
    this.returned = true;
    return this;
  }

  then<A, B>(
    onFulfilled?: ((value: unknown) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onFulfilled, onRejected);
  }

  private run(): unknown[] {
    this.db.ops.push(this.op);
    const queued = this.db.queued.get(this.op.table);
    if (queued && queued.length > 0) return queued.shift()!;

    // An insert with `returning()` echoes what was written, so a create path
    // does not have to be primed before it can be exercised.
    if (this.op.kind === "insert" && this.returned && this.op.values !== undefined) {
      const rows = Array.isArray(this.op.values) ? this.op.values : [this.op.values];
      return rows.map((row, index) => ({ id: `generated-${index}`, ...(row as object) }));
    }
    return [];
  }
}

class FakeDb {
  readonly ops: Op[] = [];
  readonly queued = new Map<string, unknown[][]>();

  /** Prime the next result set for a table. Call again to queue another. */
  queue(table: string, rows: unknown[]): this {
    const existing = this.queued.get(table) ?? [];
    existing.push(rows);
    this.queued.set(table, existing);
    return this;
  }

  opsOn(table: string): Op[] {
    return this.ops.filter((op) => op.table === table);
  }

  writesTo(table: string): Op[] {
    return this.opsOn(table).filter((op) => op.kind !== "select");
  }

  select(): FakeQuery {
    return new FakeQuery(this, { kind: "select", table: "?", columns: [], params: [] });
  }
  insert(table: unknown): FakeQuery {
    return new FakeQuery(this, {
      kind: "insert",
      table: getTableName(table as Parameters<typeof getTableName>[0]),
      columns: [],
      params: [],
    });
  }
  update(table: unknown): FakeQuery {
    return new FakeQuery(this, {
      kind: "update",
      table: getTableName(table as Parameters<typeof getTableName>[0]),
      columns: [],
      params: [],
    });
  }
  delete(table: unknown): FakeQuery {
    return new FakeQuery(this, {
      kind: "delete",
      table: getTableName(table as Parameters<typeof getTableName>[0]),
      columns: [],
      params: [],
    });
  }
  async transaction<T>(fn: (tx: FakeDb) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const SITE = "11111111-1111-4111-8111-111111111111";
const OTHER_SITE = "22222222-2222-4222-8222-222222222222";
const AUTHOR_ID = "33333333-3333-4333-8333-333333333333";
const REPLACEMENT_ID = "44444444-4444-4444-8444-444444444444";
const DOC_ID = "55555555-5555-4555-8555-555555555555";
const TAG_ID = "66666666-6666-4666-8666-666666666666";
const REDIRECT_ID = "77777777-7777-4777-8777-777777777777";

let db: FakeDb;

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    kind: "user",
    id: "user-1",
    siteId: SITE,
    role: "editor",
    scopes: [...SCOPES],
    publishedOnly: false,
    ...overrides,
  };
}

function ctx(who: Actor = actor()) {
  return {
    actor: who,
    services: {
      db: db as unknown as Database,
      storage: { publicUrl: (key: string) => `https://cdn.test/${key}` } as StorageService,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    },
  };
}

/** The shape every failure assertion wants: the code, not the message. */
async function failure(promise: Promise<unknown>): Promise<{ code: string; details: unknown }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; details?: unknown };
    return { code: e.code ?? "none", details: e.details };
  }
  throw new Error("Expected the call to fail, but it resolved.");
}

function authorRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AUTHOR_ID,
    siteId: SITE,
    userId: null,
    slug: "ada-lovelace",
    name: "Ada Lovelace",
    jobTitle: null,
    bioMd: null,
    avatarAssetId: null,
    email: null,
    url: null,
    sameAs: [],
    knowsAbout: [],
    credentials: {},
    isActive: true,
    ...overrides,
  };
}

beforeEach(() => {
  db = new FakeDb();
});

describe("authors are bylines, not accounts", () => {
  it("creates a guest byline with no user account at all", async () => {
    await upsertAuthor.invoke(
      {
        slug: "ada-lovelace",
        name: "Ada Lovelace",
        jobTitle: "Mathematician",
        sameAs: ["https://example.com/ada"],
        knowsAbout: ["analytical engines"],
      },
      ctx(),
    );

    const [insert] = db.writesTo("authors");
    const values = insert?.values as Record<string, unknown>;
    expect(insert?.kind).toBe("insert");
    // Written explicitly rather than left to the column default: the guest
    // case is the common one and should be visible in the row that lands.
    expect(values.userId).toBeNull();
    expect(values.siteId).toBe(SITE);
    expect(values.sameAs).toEqual(["https://example.com/ada"]);
    expect(values.knowsAbout).toEqual(["analytical engines"]);
    // Nobody asked about site membership, because no account was involved.
    expect(db.opsOn("site_members")).toHaveLength(0);
  });

  it("links a user account only after confirming they are a member here", async () => {
    db.queue("site_members", [{ userId: "user-9" }]);

    await upsertAuthor.invoke(
      { slug: "grace-hopper", name: "Grace Hopper", userId: "user-9" },
      ctx(),
    );

    const [membership] = db.opsOn("site_members");
    expect(membership?.params).toContain(SITE);
    expect((db.writesTo("authors")[0]?.values as Record<string, unknown>).userId).toBe("user-9");
  });

  it("refuses to link a user who is not a member of this site", async () => {
    // Nothing queued: the membership lookup finds no row.
    const { code } = await failure(
      upsertAuthor.invoke(
        { slug: "stranger", name: "Stranger", userId: "user-from-another-site" },
        ctx(),
      ),
    );
    expect(code).toBe("invalid_input");
    expect(db.writesTo("authors")).toHaveLength(0);
  });

  it("detaches a departed employee's account while keeping the byline", async () => {
    db.queue("authors", [authorRow({ userId: null })]);

    await upsertAuthor.invoke(
      { id: AUTHOR_ID, slug: "ada-lovelace", name: "Ada Lovelace", userId: null },
      ctx(),
    );

    const [update] = db.writesTo("authors");
    expect(update?.kind).toBe("update");
    // The account link is cleared; the Person data is not.
    expect(update?.set?.userId).toBeNull();
    expect(update?.set?.name).toBe("Ada Lovelace");
    expect(update?.params).toContain(SITE);
  });

  it("answers an author id from another site as not found, never forbidden", async () => {
    // The row exists — for another tenant — so the site-scoped query matches
    // nothing. A `forbidden` here would confirm the id is real.
    const { code } = await failure(
      upsertAuthor.invoke({ id: AUTHOR_ID, slug: "x", name: "X" }, ctx(actor({ siteId: OTHER_SITE }))),
    );
    expect(code).toBe("not_found");
    expect(db.writesTo("authors")[0]?.params).toContain(OTHER_SITE);
  });

  it("reports how many documents each byline carries", async () => {
    db.queue("authors", [authorRow()]);
    db.queue("documents", [{ key: AUTHOR_ID, n: 4 }]);
    db.queue("document_authors", [{ key: AUTHOR_ID, n: 2 }]);

    const result = (await listAuthors.invoke({}, ctx())) as {
      authors: Array<{ references: { asPrimary: number; asByline: number } }>;
    };

    expect(result.authors[0]?.references).toEqual({ asPrimary: 4, asByline: 2 });
  });
});

describe("deleting an author cannot silently orphan a document", () => {
  it("refuses while live documents still credit them, and says how many", async () => {
    db.queue("authors", [authorRow()]);
    db.queue("documents", [{ key: AUTHOR_ID, n: 12 }]);
    db.queue("document_authors", [{ key: AUTHOR_ID, n: 1 }]);

    const { code, details } = await failure(deleteAuthor.invoke({ id: AUTHOR_ID }, ctx()));

    expect(code).toBe("precondition_failed");
    expect(details).toMatchObject({ references: { asPrimary: 12, asByline: 1 } });
    expect(db.writesTo("authors")).toHaveLength(0);
    expect(db.writesTo("documents")).toHaveLength(0);
  });

  it("deletes an author nobody is credited to", async () => {
    db.queue("authors", [authorRow()]);

    const result = (await deleteAuthor.invoke({ id: AUTHOR_ID }, ctx())) as { id: string };

    expect(result.id).toBe(AUTHOR_ID);
    const [remove] = db.writesTo("authors");
    expect(remove?.kind).toBe("delete");
    expect(remove?.params).toContain(SITE);
  });

  it("moves every credit to the replacement before deleting", async () => {
    db.queue("authors", [authorRow()]);
    db.queue("documents", [{ key: AUTHOR_ID, n: 3 }]);
    db.queue("document_authors", [{ key: AUTHOR_ID, n: 1 }]);
    db.queue("authors", [{ id: REPLACEMENT_ID }]);
    db.queue("document_authors", [{ documentId: DOC_ID }]);

    const result = (await deleteAuthor.invoke(
      { id: AUTHOR_ID, reassignToId: REPLACEMENT_ID },
      ctx(),
    )) as { reassignedTo: string | null };

    expect(result.reassignedTo).toBe(REPLACEMENT_ID);
    const reinsert = db.writesTo("document_authors").find((op) => op.kind === "insert");
    expect(reinsert?.values).toEqual([{ documentId: DOC_ID, authorId: REPLACEMENT_ID }]);
    const repoint = db.writesTo("documents").find((op) => op.kind === "update");
    expect(repoint?.set?.primaryAuthorId).toBe(REPLACEMENT_ID);
    expect(db.writesTo("authors").some((op) => op.kind === "delete")).toBe(true);
  });

  it("answers a replacement from another site as not found", async () => {
    db.queue("authors", [authorRow()]);
    db.queue("documents", [{ key: AUTHOR_ID, n: 1 }]);
    db.queue("document_authors", []);
    // No second authors result: the replacement lookup matches nothing.

    const { code } = await failure(
      deleteAuthor.invoke({ id: AUTHOR_ID, reassignToId: REPLACEMENT_ID }, ctx()),
    );
    expect(code).toBe("not_found");
    expect(db.writesTo("authors")).toHaveLength(0);
  });
});

describe("slug history is a record, not a setting", () => {
  it("is read but never written by any editorial capability", async () => {
    db.queue("sites", [{ id: SITE, blogBasePath: "/blog", baseUrl: "https://example.com" }]);
    db.queue("redirects", [
      { id: REDIRECT_ID, source: "/old", destination: "/new", statusCode: 301 },
    ]);
    db.queue("slug_history", [
      {
        id: "history-1",
        oldSlug: "first-draft",
        newSlug: "final",
        statusCode: 301,
        createdAt: new Date(),
        documentId: DOC_ID,
        documentTitle: "Final",
        documentSlug: "final",
        documentStatus: "published",
      },
    ]);

    await listRedirects.invoke({}, ctx());
    await upsertRedirect.invoke({ source: "/a", destination: "/b" }, ctx());
    db.queue("redirects", [{ id: REDIRECT_ID, source: "/a", destination: "/b" }]);
    await deleteRedirect.invoke({ id: REDIRECT_ID }, ctx());
    db.queue("authors", [authorRow()]);
    await deleteAuthor.invoke({ id: AUTHOR_ID }, ctx());

    expect(db.opsOn("slug_history")).not.toHaveLength(0);
    expect(db.writesTo("slug_history")).toHaveLength(0);
  });

  it("shows the history entry alongside the document it belongs to", async () => {
    db.queue("sites", [{ id: SITE, blogBasePath: "/blog", baseUrl: "https://example.com" }]);
    db.queue("redirects", []);
    db.queue("slug_history", [
      {
        id: "history-1",
        oldSlug: "first-draft",
        newSlug: "final",
        statusCode: 301,
        createdAt: new Date(),
        documentId: DOC_ID,
        documentTitle: "Final",
        documentSlug: "final",
        documentStatus: "published",
      },
    ]);

    const result = (await listRedirects.invoke({}, ctx())) as {
      slugHistory: Array<{ documentTitle: string }>;
      redirects: unknown[];
    };

    expect(result.slugHistory[0]?.documentTitle).toBe("Final");
    expect(result.redirects).toHaveLength(0);
  });
});

describe("redirects", () => {
  it("refuses a redirect that points at its own source", async () => {
    const { code } = await failure(
      upsertRedirect.invoke({ source: "/pricing", destination: "/pricing" }, ctx()),
    );
    expect(code).toBe("invalid_input");
    expect(db.writesTo("redirects")).toHaveLength(0);
  });

  it("refuses one that is self-referential only after normalisation", async () => {
    const { code } = await failure(
      upsertRedirect.invoke(
        { source: "https://example.com/pricing/", destination: "/pricing" },
        ctx(),
      ),
    );
    expect(code).toBe("invalid_input");
  });

  it("warns when a new rule inherits an existing destination", async () => {
    db.queue("redirects", [{ id: REDIRECT_ID, source: "/very-old", destination: "/old" }]);

    const result = (await upsertRedirect.invoke(
      { source: "/old", destination: "/new" },
      ctx(),
    )) as { warnings: Array<{ code: string }> };

    expect(result.warnings.map((w) => w.code)).toEqual(["chain_inbound"]);
  });

  it("warns when the destination itself redirects onwards", async () => {
    db.queue("redirects", [{ id: REDIRECT_ID, source: "/new", destination: "/newest" }]);

    const result = (await upsertRedirect.invoke(
      { source: "/old", destination: "/new" },
      ctx(),
    )) as { warnings: Array<{ code: string }> };

    expect(result.warnings.map((w) => w.code)).toEqual(["chain_outbound"]);
    // A chain is reported, not refused: two hops still resolve, and only the
    // caller knows whether the middle rule is about to go away.
    expect(db.writesTo("redirects")).toHaveLength(1);
  });

  it("stores an absolute destination as external and keeps the source a path", async () => {
    const result = (await upsertRedirect.invoke(
      { source: "/docs/", destination: "https://docs.example.com/guide", statusCode: 308 },
      ctx(),
    )) as { redirect: { source: string; destination: string; isExternal: boolean } };

    expect(result.redirect.source).toBe("/docs");
    expect(result.redirect.isExternal).toBe(true);
    expect(result.redirect.destination).toBe("https://docs.example.com/guide");
  });

  it("answers a redirect id from another site as not found", async () => {
    const { code } = await failure(
      upsertRedirect.invoke({ id: REDIRECT_ID, source: "/a", destination: "/b" }, ctx()),
    );
    expect(code).toBe("not_found");
  });

  it("detects chains across manual rules and slug history alike", () => {
    const chains = detectRedirectChains([
      { id: "r1", source: "/a", destination: "/b", origin: "manual" },
      { id: "h1", source: "/b", destination: "/c", origin: "slug_history" },
      { id: "r2", source: "/z", destination: "/unrelated", origin: "manual" },
    ]);

    expect(chains).toHaveLength(1);
    expect(chains[0]?.from.id).toBe("r1");
    expect(chains[0]?.to.origin).toBe("slug_history");
  });

  it("normalises the spellings of one URL to a single form", () => {
    expect(normalisePath("/a/")).toBe("/a");
    expect(normalisePath("a")).toBe("/a");
    expect(normalisePath("https://example.com/a/b/")).toBe("/a/b");
    expect(normalisePath("/")).toBe("/");
    expect(normalisePath("//a//b")).toBe("/a/b");
  });
});

describe("taxonomy and tagging", () => {
  it("creates an entity with the fields an answer engine reconciles on", async () => {
    const result = (await upsertTerm.invoke(
      {
        kind: "entity",
        slug: "postgresql",
        name: "PostgreSQL",
        type: "SoftwareApplication",
        wikidataId: "Q192490",
        sameAs: ["https://www.postgresql.org"],
      },
      ctx(),
    )) as { term: Record<string, unknown> };

    expect(result.term.wikidataId).toBe("Q192490");
    expect((db.writesTo("entities")[0]?.values as Record<string, unknown>).siteId).toBe(SITE);
  });

  it("rejects a Wikidata id that is not a Q-number", async () => {
    const { code } = await failure(
      upsertTerm.invoke(
        { kind: "entity", slug: "postgresql", name: "PostgreSQL", wikidataId: "postgres" },
        ctx(),
      ),
    );
    expect(code).toBe("invalid_input");
  });

  it("lists terms of one kind with their usage counts", async () => {
    db.queue("tags", [{ id: TAG_ID, siteId: SITE, slug: "seo", name: "SEO", description: null }]);
    db.queue("document_tags", [{ key: TAG_ID, n: 7 }]);

    const result = (await listTerms.invoke({ kind: "tag" }, ctx())) as {
      terms: Array<{ documentCount: number }>;
    };

    expect(result.terms[0]?.documentCount).toBe(7);
  });

  it("answers a tag from another site as not found rather than forbidden", async () => {
    db.queue("documents", [{ id: DOC_ID, createdBy: "user-1" }]);
    // No tags result: the site-scoped lookup finds none of the ids.
    const { code } = await failure(
      tagDocument.invoke({ id: DOC_ID, tagIds: [TAG_ID] }, ctx()),
    );
    expect(code).toBe("not_found");
    expect(db.writesTo("document_tags")).toHaveLength(0);
  });

  it("refuses more than one primary entity on a document", async () => {
    const { code } = await failure(
      tagDocument.invoke(
        {
          id: DOC_ID,
          entities: [
            { id: TAG_ID, isPrimary: true },
            { id: REDIRECT_ID, isPrimary: true },
          ],
        },
        ctx(),
      ),
    );
    expect(code).toBe("invalid_input");
  });

  it("replaces rather than merges, so an empty array clears", async () => {
    db.queue("documents", [{ id: DOC_ID, createdBy: "user-1" }]);

    await tagDocument.invoke({ id: DOC_ID, tagIds: [] }, ctx());

    const writes = db.writesTo("document_tags");
    expect(writes).toHaveLength(1);
    expect(writes[0]?.kind).toBe("delete");
  });
});

describe("authorization is enforced before any handler runs", () => {
  it("refuses a credential without the taxonomy:write scope", async () => {
    const readOnly = actor({
      scopes: SCOPES.filter((s) => s !== "taxonomy:write") as Scope[],
    });
    const { code } = await failure(
      upsertAuthor.invoke({ slug: "ada", name: "Ada" }, ctx(readOnly)),
    );
    expect(code).toBe("forbidden");
    expect(db.ops).toHaveLength(0);
  });

  it("refuses an author-role session on an editor-only capability", async () => {
    const { code } = await failure(
      deleteAuthor.invoke({ id: AUTHOR_ID }, ctx(actor({ role: "author" }))),
    );
    expect(code).toBe("forbidden");
    expect(db.ops).toHaveLength(0);
  });

  it("lets an author tag their own document but not someone else's", async () => {
    db.queue("documents", [{ id: DOC_ID, createdBy: "user-1" }]);
    await tagDocument.invoke({ id: DOC_ID, tagIds: [] }, ctx(actor({ role: "author" })));

    db = new FakeDb();
    db.queue("documents", [{ id: DOC_ID, createdBy: "someone-else" }]);
    const { code } = await failure(
      tagDocument.invoke({ id: DOC_ID, tagIds: [] }, ctx(actor({ role: "author" }))),
    );
    expect(code).toBe("forbidden");
  });
});

describe("the editorial set is registry-ready", () => {
  it("declares a route, scopes, a role and a usable description on each", () => {
    expect(editorialCapabilities.length).toBeGreaterThan(0);
    for (const cap of editorialCapabilities) {
      expect(cap.name, `${cap.name} must be snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(cap.route.path.startsWith("/"), `${cap.name} route must be absolute`).toBe(true);
      expect(cap.scopes.length, `${cap.name} declares no scopes`).toBeGreaterThan(0);
      expect(cap.role, `${cap.name} declares no role`).toBeTruthy();
      expect(cap.description.length, `${cap.name} description is too thin`).toBeGreaterThan(60);
      if (cap.readOnly) {
        expect(cap.scopes).not.toContain("content:write");
        expect(cap.scopes).not.toContain("taxonomy:write");
      }
    }
  });

  it("has no duplicate capability names", () => {
    const names = editorialCapabilities.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
