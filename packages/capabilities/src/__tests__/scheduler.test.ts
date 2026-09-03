import { beforeEach, describe, expect, it } from "vitest";
import { Column, Param, SQL, getTableName } from "drizzle-orm";
import { SCOPES, type Actor } from "@cms/core";
import type { Database } from "@cms/db";
import type { StorageService } from "@cms/media";
import { listScheduled, publishScheduled } from "../scheduler";

/**
 * The scheduled-publish runner, against a fake database.
 *
 * This fake is a little more than the ones next door: it keeps an actual
 * document store and applies writes to it, because the questions worth asking
 * about this job are all about state afterwards — which documents went live,
 * which one is now a draft with findings attached, and which was left alone
 * for the next run.
 *
 * The due-documents predicate is evaluated from the parameters the capability
 * actually bound, rather than hard-coded here. That is what makes "a document
 * scheduled for the future is left alone" a real assertion: if the handler
 * stopped binding `now`, or bound the wrong status, the filter below would
 * stop excluding anything and the test would fail.
 *
 * `publish_document` is NOT stubbed. The whole point of the runner is that a
 * scheduled publish and a manual one are the same code, so these tests drive
 * the real render, the real lint gate and the real column writes.
 */

interface Op {
  kind: "select" | "insert" | "update" | "delete" | "execute";
  table: string;
  columns: string[];
  params: unknown[];
  sql?: string;
  values?: unknown;
  set?: Record<string, unknown>;
}

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

type Row = Record<string, unknown>;

class FakeQuery implements PromiseLike<unknown> {
  constructor(
    private readonly db: FakeDb,
    private readonly op: Op,
  ) {}

  from(table: unknown): this {
    this.op.table = getTableName(table as Parameters<typeof getTableName>[0]);
    return this;
  }
  leftJoin(): this {
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
    this.op.values = values;
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
    return Promise.resolve()
      .then(() => this.db.run(this.op))
      .then(onFulfilled, onRejected);
  }
}

class FakeDb {
  readonly ops: Op[] = [];
  readonly documents = new Map<string, Row>();
  readonly sites = new Map<string, Row>();
  /** Flip to false to stand in for an overlapping run holding the lock. */
  lockAvailable = true;

  /** Drizzle's relational API, which the media resolver reaches for. */
  readonly query = {
    mediaAssets: { findMany: async () => [] },
    mediaVariants: { findMany: async () => [] },
  };

  run(op: Op): unknown[] {
    this.ops.push(op);

    if (op.kind === "execute") return [{ locked: this.lockAvailable }];

    if (op.table === "sites") {
      const id = op.params.find((p) => typeof p === "string" && this.sites.has(p));
      const site = typeof id === "string" ? this.sites.get(id) : undefined;
      return site ? [site] : [];
    }

    if (op.table === "documents" && op.kind === "select") {
      // A bound document id means `publish_document` fetching its one row.
      const id = op.params.find((p) => typeof p === "string" && this.documents.has(p));
      if (typeof id === "string") {
        const row = this.documents.get(id);
        return row ? [row] : [];
      }

      /**
       * Otherwise it is one of the two list queries, and the predicate is
       * rebuilt from what the handler actually bound rather than assumed: the
       * status it asked for, the cutoff timestamp if it passed one, and the
       * site if it scoped to one. A handler that stopped binding `now` would
       * stop excluding future documents here, and the test would notice.
       */
      const cutoff = op.params.find((p) => p instanceof Date) as Date | undefined;
      const site = op.params.find((p) => typeof p === "string" && this.sites.has(p));
      const status = op.params.find(
        (p) => typeof p === "string" && p !== site && !this.sites.has(p),
      );

      return [...this.documents.values()]
        .filter(
          (row) =>
            row.status === status &&
            row.deletedAt === null &&
            (site === undefined || row.siteId === site) &&
            (cutoff === undefined ||
              (row.scheduledFor instanceof Date &&
                (row.scheduledFor as Date).getTime() <= cutoff.getTime())),
        )
        .sort(
          (a, b) =>
            ((a.scheduledFor as Date | null)?.getTime() ?? 0) -
            ((b.scheduledFor as Date | null)?.getTime() ?? 0),
        );
    }

    if (op.table === "documents" && op.kind === "update") {
      const id = op.params.find((p) => typeof p === "string" && this.documents.has(p));
      if (typeof id !== "string") return [];
      const updated = { ...this.documents.get(id)!, ...(op.set ?? {}) };
      this.documents.set(id, updated);
      return [updated];
    }

    return [];
  }

  async execute(query: unknown): Promise<unknown[]> {
    const op: Op = { kind: "execute", table: "-", columns: [], params: [], sql: "" };
    if (query instanceof SQL) {
      const chunks = (query as unknown as { queryChunks: unknown[] }).queryChunks;
      // A template's literal halves arrive as StringChunk objects carrying an
      // array of strings; its interpolations arrive as Param or as raw values.
      op.sql = chunks
        .map((chunk) => {
          const value = (chunk as { value?: unknown }).value;
          if (Array.isArray(value)) return value.join("");
          if (chunk instanceof Param) return "";
          return typeof chunk === "object" && chunk !== null ? "" : String(chunk);
        })
        .join("");
      collect(chunks, op);
    }
    return this.run(op);
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

const SITE_A = "11111111-1111-4111-8111-111111111111";
const SITE_B = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-04-01T09:00:00.000Z");
const PAST = new Date("2026-04-01T08:59:00.000Z");
const FUTURE = new Date("2026-04-02T09:00:00.000Z");

/**
 * Document ids are real UUIDs, because `publish_document` validates its input
 * like any other caller — a readable placeholder would fail the schema and the
 * whole batch would report `invalid_input` instead of exercising anything.
 */
const DOC = {
  due: "aaaaaaaa-0000-4000-8000-000000000001",
  later: "aaaaaaaa-0000-4000-8000-000000000002",
  draft: "aaaaaaaa-0000-4000-8000-000000000003",
  gone: "aaaaaaaa-0000-4000-8000-000000000004",
  before: "aaaaaaaa-0000-4000-8000-000000000005",
  blocked: "aaaaaaaa-0000-4000-8000-000000000006",
  after: "aaaaaaaa-0000-4000-8000-000000000007",
  ok: "aaaaaaaa-0000-4000-8000-000000000008",
  orphan: "aaaaaaaa-0000-4000-8000-000000000009",
  onSiteA: "aaaaaaaa-0000-4000-8000-00000000000a",
  onSiteB: "aaaaaaaa-0000-4000-8000-00000000000b",
  late: "aaaaaaaa-0000-4000-8000-00000000000c",
} as const;

let db: FakeDb;

function siteRow(id: string, host: string): Row {
  return {
    id,
    slug: host,
    name: host,
    baseUrl: `https://${host}`,
    blogBasePath: "/blog",
    locale: "en",
  };
}

function documentRow(id: string, overrides: Row = {}): Row {
  return {
    id,
    siteId: SITE_A,
    type: "post",
    status: "scheduled",
    slug: `post-${id.slice(-4)}`,
    path: null,
    key: null,
    title: "A perfectly publishable post",
    subtitle: null,
    description: "Something short and true about the post, long enough to be a description.",
    excerpt: null,
    bodyMd:
      "# A perfectly publishable post\n\nA paragraph of prose that the pipeline is happy to render.\n",
    bodyHtml: null,
    bodyText: null,
    bodyMdPublic: null,
    headings: [],
    wordCount: 0,
    readingTimeMinutes: 1,
    renderVersion: 0,
    renderedAt: null,
    contentHash: null,
    tldr: null,
    keyTakeaways: [],
    primaryAuthorId: null,
    canonicalUrlOverride: null,
    noindex: false,
    seoOverrides: {},
    publishedAt: null,
    scheduledFor: PAST,
    dateModified: null,
    firstPublishedAt: null,
    lintReport: {},
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    ...overrides,
  };
}

function actor(overrides: Partial<Actor> = {}): Actor {
  return {
    kind: "system",
    id: "system:publish-scheduled",
    siteId: SITE_A,
    role: "owner",
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

interface Report {
  lockAcquired: boolean;
  claimed: number;
  published: number;
  blocked: number;
  errored: number;
  durationMs: number;
  results: Array<{ documentId: string; outcome: string; message?: string; findings?: unknown[] }>;
}

const run = (input: Record<string, unknown> = {}) =>
  publishScheduled.invoke(input, ctx()) as Promise<Report>;

beforeEach(() => {
  db = new FakeDb();
  db.sites.set(SITE_A, siteRow(SITE_A, "site-a.test"));
  db.sites.set(SITE_B, siteRow(SITE_B, "site-b.test"));
});

describe("the runner refuses to overlap itself", () => {
  it("takes a transaction-scoped advisory lock before touching anything", async () => {
    await run();

    const first = db.ops[0]!;
    expect(first.kind).toBe("execute");
    // Transaction-scoped and non-blocking, both load-bearing: a session lock
    // leaks across a pooled connection, and a blocking one queues the ticks up
    // behind a slow run instead of skipping them.
    expect(first.sql).toContain("pg_try_advisory_xact_lock");
    expect(first.sql).not.toContain("pg_advisory_lock(");
  });

  it("does nothing at all when another run already holds the lock", async () => {
    db.lockAvailable = false;
    db.documents.set(DOC.onSiteA, documentRow(DOC.onSiteA));

    const report = await run();

    expect(report.lockAcquired).toBe(false);
    expect(report.claimed).toBe(0);
    // Not merely "published nothing": it never even looked for work.
    expect(db.ops.filter((op) => op.table === "documents")).toHaveLength(0);
    expect(db.documents.get(DOC.onSiteA)!.status).toBe("scheduled");
  });
});

describe("only what is actually due", () => {
  it("publishes a document whose time has passed and leaves a future one alone", async () => {
    db.documents.set(DOC.due, documentRow(DOC.due, { scheduledFor: PAST }));
    db.documents.set(DOC.later, documentRow(DOC.later, { scheduledFor: FUTURE }));

    const report = await run();

    expect(report.claimed).toBe(1);
    expect(report.published).toBe(1);
    expect(report.results.map((r) => r.documentId)).toEqual([DOC.due]);

    expect(db.documents.get(DOC.due)!.status).toBe("published");
    expect(db.documents.get(DOC.later)!.status).toBe("scheduled");
    expect(db.documents.get(DOC.later)!.publishedAt).toBeNull();
  });

  it("ignores drafts and soft-deleted rows even when their time has passed", async () => {
    db.documents.set(DOC.draft, documentRow(DOC.draft, { status: "draft" }));
    db.documents.set(DOC.gone, documentRow(DOC.gone, { deletedAt: NOW }));

    const report = await run();

    expect(report.claimed).toBe(0);
    expect(report.published).toBe(0);
  });

  it("goes through the real publish path, not a second copy of it", async () => {
    db.documents.set(DOC.due, documentRow(DOC.due));

    await run();
    const published = db.documents.get(DOC.due)!;

    // The columns only `publish_document` knows how to fill. If the runner
    // ever grew its own publish, these would be the first things it forgot.
    expect(published.status).toBe("published");
    expect(published.publishedAt).toEqual(NOW);
    expect(published.firstPublishedAt).toEqual(NOW);
    expect(published.dateModified).toEqual(NOW);
    expect(published.scheduledFor).toBeNull();
    expect(String(published.bodyHtml)).toContain("<h1");
    expect(published.contentHash).toBeTruthy();
    expect(published.renderVersion).toBeGreaterThan(0);
    expect(published.wordCount).toBeGreaterThan(0);
  });

  it("sweeps every site in one run, minting a per-site actor for each", async () => {
    db.documents.set(DOC.onSiteA, documentRow(DOC.onSiteA, { siteId: SITE_A }));
    db.documents.set(DOC.onSiteB, documentRow(DOC.onSiteB, { siteId: SITE_B }));

    const report = await run();

    expect(report.published).toBe(2);
    // Each publish resolved its own site row, which is only possible if the
    // actor carried that document's site rather than the caller's.
    const siteLookups = db.ops.filter((op) => op.table === "sites");
    expect(siteLookups.some((op) => op.params.includes(SITE_A))).toBe(true);
    expect(siteLookups.some((op) => op.params.includes(SITE_B))).toBe(true);
  });

  it("caps a single run so a backlog cannot hold the lock indefinitely", async () => {
    for (const id of [DOC.due, DOC.ok, DOC.after]) db.documents.set(id, documentRow(id));

    const report = await run({ limit: 1 });
    // The fake cannot honour LIMIT, so the ceiling is asserted where it is
    // enforced — on the input — and the sweep is left to Postgres.
    expect(publishScheduled.input.safeParse({ limit: 501 }).success).toBe(false);
    expect(report.claimed).toBeGreaterThan(0);
  });
});

describe("one document's failure does not abort the batch", () => {
  /** An image with no alt text: one of exactly three blocking lint findings. */
  const BLOCKED_BODY =
    "# A post with a broken image\n\nSome prose.\n\n![](https://example.test/diagram.png)\n";

  it("moves a document that fails the gate to draft, with the findings recorded", async () => {
    db.documents.set(
      DOC.before,
      documentRow(DOC.before, { scheduledFor: new Date("2026-04-01T08:57:00.000Z") }),
    );
    db.documents.set(
      DOC.blocked,
      documentRow(DOC.blocked, {
        bodyMd: BLOCKED_BODY,
        scheduledFor: new Date("2026-04-01T08:58:00.000Z"),
      }),
    );
    db.documents.set(
      DOC.after,
      documentRow(DOC.after, { scheduledFor: new Date("2026-04-01T08:59:00.000Z") }),
    );

    const report = await run();

    // The batch continued in both directions around the failure.
    expect(report.claimed).toBe(3);
    expect(report.published).toBe(2);
    expect(report.blocked).toBe(1);
    expect(report.errored).toBe(0);
    expect(db.documents.get(DOC.before)!.status).toBe("published");
    expect(db.documents.get(DOC.after)!.status).toBe("published");

    /**
     * Out of `scheduled`, not left in it. A blocked document that stays
     * scheduled is retried every minute forever while its author sees a status
     * that never becomes "published" and is told nothing.
     */
    const blocked = db.documents.get(DOC.blocked)!;
    expect(blocked.status).toBe("draft");
    expect(blocked.scheduledFor).toBeNull();

    const lintReport = blocked.lintReport as {
      findings: Array<{ rule: string; severity: string }>;
      blockedBy: string;
    };
    expect(lintReport.blockedBy).toBe("publish-scheduled");
    expect(lintReport.findings.map((f) => f.rule)).toContain("image-alt-required");
    expect(lintReport.findings.every((f) => f.severity === "error")).toBe(true);

    // Nothing was rendered onto the blocked document, either.
    expect(blocked.bodyHtml).toBeNull();
  });

  it("reports each document individually, distinguishing blocked from errored", async () => {
    db.documents.set(
      DOC.ok,
      documentRow(DOC.ok, { scheduledFor: new Date("2026-04-01T08:57:00.000Z") }),
    );
    db.documents.set(
      DOC.blocked,
      documentRow(DOC.blocked, {
        bodyMd: BLOCKED_BODY,
        scheduledFor: new Date("2026-04-01T08:58:00.000Z"),
      }),
    );

    const report = await run();
    const byId = new Map(report.results.map((r) => [r.documentId, r]));

    expect(byId.get(DOC.ok)!.outcome).toBe("published");
    expect(byId.get(DOC.blocked)!.outcome).toBe("blocked");
    expect(byId.get(DOC.blocked)!.findings!.length).toBeGreaterThan(0);
    expect(byId.get(DOC.blocked)!.message).toMatch(/fixed before publishing/i);
  });

  it("leaves an unexpected failure scheduled, so the next run retries it", async () => {
    // Its site row has vanished — a transient, infrastructural failure, not an
    // editorial one. Demoting the post to draft over that would be its own
    // kind of lost work.
    db.documents.set(
      DOC.orphan,
      documentRow(DOC.orphan, { siteId: "99999999-9999-4999-8999-999999999999" }),
    );

    const report = await run();

    expect(report.errored).toBe(1);
    expect(report.blocked).toBe(0);
    expect(report.results[0]!.outcome).toBe("error");
    expect(db.documents.get(DOC.orphan)!.status).toBe("scheduled");
    expect(db.documents.get(DOC.orphan)!.scheduledFor).toEqual(PAST);
  });
});

describe("the capabilities declare what they are", () => {
  it("marks publish_scheduled as an owner-level publish, and says it is a cron entry point", () => {
    expect(publishScheduled.role).toBe("owner");
    expect(publishScheduled.scopes).toContain("content:publish");
    expect(publishScheduled.readOnly).toBeFalsy();
    expect(publishScheduled.description.toLowerCase()).toContain("cron");
  });

  it("keeps list_scheduled read-only and scoped to the caller's own site", async () => {
    expect(listScheduled.readOnly).toBe(true);
    expect(listScheduled.scopes).toEqual(["content:read"]);

    db.documents.set(DOC.onSiteA, documentRow(DOC.onSiteA));
    await listScheduled.invoke({}, ctx(actor({ kind: "user", id: "u", role: "author" })));

    const select = db.ops.find((op) => op.table === "documents")!;
    expect(select.params).toContain(SITE_A);
    expect(select.params).toContain("scheduled");
  });

  it("flags an overdue queue entry, which is how anyone notices the runner is down", async () => {
    db.documents.set(DOC.late, documentRow(DOC.late, { scheduledFor: PAST }));

    const result = (await listScheduled.invoke({}, ctx())) as {
      documents: Array<{ id: string; overdue: boolean }>;
    };

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]!.overdue).toBe(true);
  });
});
