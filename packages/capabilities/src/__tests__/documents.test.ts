import { beforeEach, describe, expect, it } from "vitest";
import { Column, Param, SQL, getTableName } from "drizzle-orm";
import { SCOPES, type Actor } from "@cms/core";
import type { Database } from "@cms/db";
import type { StorageService } from "@cms/media";
import { restoreRevision } from "../documents";

/**
 * Revision restore, against a fake database.
 *
 * What is worth pinning here is the ordering and the omissions — that the
 * current text is captured *before* it is overwritten, that the publishing
 * columns are not in the `set` at all, and that a document belonging to
 * another tenant is indistinguishable from one that does not exist. None of
 * that needs Postgres to be true; all of it needs visibility into the queries
 * that were issued and the order they were issued in, which is what this fake
 * provides and a mocked drizzle would not.
 */

interface Op {
  kind: "select" | "insert" | "update" | "delete";
  table: string;
  columns: string[];
  params: unknown[];
  values?: Record<string, unknown>;
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
  constructor(
    private readonly db: FakeDb,
    private readonly op: Op,
  ) {}

  from(table: unknown): this {
    this.op.table = getTableName(table as Parameters<typeof getTableName>[0]);
    return this;
  }
  where(condition: unknown): this {
    collect(condition, this.op);
    return this;
  }
  orderBy(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  values(values: unknown): this {
    this.op.values = values as Record<string, unknown>;
    return this;
  }
  set(values: Record<string, unknown>): this {
    this.op.set = values;
    return this;
  }
  returning(): this {
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
    return queued && queued.length > 0 ? queued.shift()! : [];
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
const DOC = "22222222-2222-4222-8222-222222222222";
const REVISION = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-03-01T12:00:00.000Z");

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
      now: () => NOW,
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    return { code: e.code ?? "none", message: e.message ?? "" };
  }
  throw new Error("Expected the call to fail, but it resolved.");
}

/** A published document, mid-edit: the live HTML is older than the markdown. */
function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC,
    siteId: SITE,
    type: "post",
    status: "published",
    slug: "current-slug",
    title: "The title as it stands now",
    description: "The description as it stands now.",
    bodyMd: "# Now\n\nThe current paragraph.\n",
    bodyHtml: "<h1>Now</h1>",
    seoOverrides: { ogTitle: "Current OG title" },
    publishedAt: new Date("2026-01-05T09:00:00.000Z"),
    firstPublishedAt: new Date("2026-01-05T09:00:00.000Z"),
    dateModified: new Date("2026-02-01T09:00:00.000Z"),
    createdBy: "user-1",
    deletedAt: null,
    ...overrides,
  };
}

function revisionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REVISION,
    documentId: DOC,
    revisionNumber: 2,
    title: "The title as it was",
    description: "The description as it was.",
    bodyMd: "# Then\n\nThe older paragraph.\n",
    snapshot: {
      slug: "an-older-slug",
      status: "draft",
      seoOverrides: { ogTitle: "Older OG title" },
    },
    note: null,
    createdAt: new Date("2026-02-10T09:00:00.000Z"),
    ...overrides,
  };
}

/** Prime the four reads a successful restore makes, in the order it makes them. */
function primeRestore(doc = documentRow(), revision = revisionRow(), nextNumber = 4) {
  db.queue("documents", [doc]);
  db.queue("document_revisions", [revision]);
  db.queue("document_revisions", [{ next: nextNumber }]);
  db.queue("documents", [{ ...doc, bodyMd: revision.bodyMd }]);
}

beforeEach(() => {
  db = new FakeDb();
});

describe("restore_revision keeps what it replaces", () => {
  it("writes the current state as a new revision before overwriting it", async () => {
    primeRestore();

    const result = (await restoreRevision.invoke(
      { documentId: DOC, revisionNumber: 2 },
      ctx(),
    )) as { restoredFrom: number; undoRevisionNumber: number };

    const writes = db.ops.filter((op) => op.kind !== "select");
    expect(writes.map((op) => `${op.kind}:${op.table}`)).toEqual([
      // The safety copy first. Reversed, there is a window in which the old
      // text is gone and nothing has recorded it.
      "insert:document_revisions",
      "update:documents",
    ]);

    const snapshot = writes[0]!.values!;
    expect(snapshot).toMatchObject({
      documentId: DOC,
      revisionNumber: 4,
      title: "The title as it stands now",
      description: "The description as it stands now.",
      bodyMd: "# Now\n\nThe current paragraph.\n",
    });
    expect(snapshot.snapshot).toEqual({
      slug: "current-slug",
      status: "published",
      seoOverrides: { ogTitle: "Current OG title" },
    });

    // The report tells the caller how to undo the restore it just performed.
    expect(result.restoredFrom).toBe(2);
    expect(result.undoRevisionNumber).toBe(4);
  });

  it("puts the revision's text back, and its SEO overrides with it", async () => {
    primeRestore();

    await restoreRevision.invoke({ documentId: DOC, revisionNumber: 2 }, ctx());

    const update = db.opsOn("documents").find((op) => op.kind === "update")!;
    expect(update.set).toMatchObject({
      title: "The title as it was",
      description: "The description as it was.",
      bodyMd: "# Then\n\nThe older paragraph.\n",
      seoOverrides: { ogTitle: "Older OG title" },
      updatedAt: NOW,
      updatedBy: "user-1",
    });
  });

  it("changes nothing that decides what a reader sees", async () => {
    primeRestore();

    await restoreRevision.invoke({ documentId: DOC, revisionNumber: 2 }, ctx());

    const update = db.opsOn("documents").find((op) => op.kind === "update")!;
    const written = Object.keys(update.set!);

    /**
     * The load-bearing assertion of this whole capability. Restoring is an
     * editing action: it must not publish, unpublish, re-date or re-render
     * anything. The revision's snapshot carries `status: "draft"` on a
     * published document precisely so that a regression here shows up as an
     * unpublished live page.
     */
    for (const column of [
      "status",
      "publishedAt",
      "firstPublishedAt",
      "dateModified",
      "bodyHtml",
      "bodyText",
      "bodyMdPublic",
      "contentHash",
      "renderVersion",
      "renderedAt",
      "slug",
    ]) {
      expect(written, `restore must not write "${column}"`).not.toContain(column);
    }
  });

  it("keeps the current title when an old revision has none", async () => {
    primeRestore(documentRow(), revisionRow({ title: null }));

    await restoreRevision.invoke({ documentId: DOC, revisionNumber: 2 }, ctx());

    const update = db.opsOn("documents").find((op) => op.kind === "update")!;
    // `documents.title` is NOT NULL; blanking it would be a worse outcome than
    // leaving a title the restore was never asked to change.
    expect(update.set!.title).toBe("The title as it stands now");
  });

  it("leaves seoOverrides alone when the revision predates that snapshot field", async () => {
    primeRestore(documentRow(), revisionRow({ snapshot: { slug: "old", status: "draft" } }));

    await restoreRevision.invoke({ documentId: DOC, revisionNumber: 2 }, ctx());

    const update = db.opsOn("documents").find((op) => op.kind === "update")!;
    expect(Object.keys(update.set!)).not.toContain("seoOverrides");
  });
});

describe("restore_revision authorization", () => {
  it("refuses an author restoring a document somebody else created", async () => {
    db.queue("documents", [documentRow({ createdBy: "someone-else" })]);

    const result = await failure(
      restoreRevision.invoke(
        { documentId: DOC, revisionNumber: 2 },
        ctx(actor({ role: "author", id: "user-1" })),
      ),
    );

    expect(result.code).toBe("forbidden");
    // The refusal happens before anything is written, and before the revision
    // is even looked up.
    expect(db.ops.filter((op) => op.kind !== "select")).toHaveLength(0);
    expect(db.opsOn("document_revisions")).toHaveLength(0);
  });

  it("lets an author restore a document they created", async () => {
    primeRestore(documentRow({ createdBy: "user-1" }));

    await expect(
      restoreRevision.invoke(
        { documentId: DOC, revisionNumber: 2 },
        ctx(actor({ role: "author", id: "user-1" })),
      ),
    ).resolves.toBeTruthy();
  });

  it("answers a document on another site as not found, never as forbidden", async () => {
    // The document lookup carries the actor's own site, so a cross-tenant id
    // simply returns no rows — the fake returns nothing because nothing was
    // queued, which is exactly what Postgres would do.
    const result = await failure(
      restoreRevision.invoke({ documentId: DOC, revisionNumber: 2 }, ctx()),
    );

    expect(result.code).toBe("not_found");
    expect(result.code).not.toBe("forbidden");

    const lookup = db.opsOn("documents")[0]!;
    expect(lookup.params).toContain(SITE);
  });

  it("answers a revision number from another document as not found", async () => {
    db.queue("documents", [documentRow()]);
    // No revision queued: the number exists somewhere, but not under this
    // document. A `forbidden` here would confirm that it exists at all.
    const result = await failure(
      restoreRevision.invoke({ documentId: DOC, revisionNumber: 99 }, ctx()),
    );

    expect(result.code).toBe("not_found");
    expect(db.ops.filter((op) => op.kind !== "select")).toHaveLength(0);
  });

  it("is declared as a write, not a read", () => {
    expect(restoreRevision.scopes).toContain("content:write");
    expect(restoreRevision.readOnly).toBeFalsy();
    expect(restoreRevision.role).toBe("author");
  });
});
