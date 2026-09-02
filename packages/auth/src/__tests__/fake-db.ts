/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Database } from "@cms/db";
import * as schema from "@cms/db/schema";

/**
 * A stand-in for the Drizzle database.
 *
 * What these tests are about is the authorization decision — which error comes
 * out, and what the resulting `Actor` contains — not whether Drizzle emits the
 * SQL it has always emitted. A real Postgres would make the suite slow, order
 * dependent and unrunnable in CI without a service container, and it would not
 * catch a single one of the mistakes these tests exist to catch.
 *
 * The `where` callbacks are still invoked, so a query that forgets to build
 * one, or that reaches for an operator the builder does not hand it, fails
 * here rather than in production.
 */

/** Every operator the relational query builder offers, as an inert marker. */
const OPERATORS: any = new Proxy(
  {},
  { get: (_target, name) => (...args: unknown[]) => ({ op: String(name), args }) },
);

function tableName(table: unknown): string {
  for (const [name, value] of Object.entries(schema)) {
    if (value === table) return name;
  }
  return "unknown";
}

export interface CannedRows {
  sites?: unknown[];
  siteMembers?: unknown[];
  siteInvitations?: unknown[];
}

export interface FakeDb {
  db: Database;
  inserts: { table: string; values: any }[];
  updates: { table: string; set: any; where: unknown }[];
  /** Number of `db.transaction(...)` calls entered. */
  transactions: number;
  /** Conditions the query callbacks actually produced. */
  conditions: unknown[];
}

export function createFakeDb(rows: CannedRows = {}): FakeDb {
  const inserts: FakeDb["inserts"] = [];
  const updates: FakeDb["updates"] = [];
  const conditions: unknown[] = [];
  let transactions = 0;
  let nextId = 1;

  const canned = (name: string): unknown[] => (rows as Record<string, unknown[]>)[name] ?? [];

  const queryFor = (name: string) => ({
    findFirst: async (config?: any) => {
      if (config?.where) conditions.push(config.where((schema as any)[name], OPERATORS));
      return canned(name)[0];
    },
    findMany: async (config?: any) => {
      if (config?.where) conditions.push(config.where((schema as any)[name], OPERATORS));
      return canned(name);
    },
  });

  const query = new Proxy({}, { get: (_t, name) => queryFor(String(name)) });

  function thenable<T>(value: T) {
    const self: any = {
      onConflictDoNothing: () => self,
      onConflictDoUpdate: () => self,
      returning: () => self,
      then: (resolve: any, reject: any) => Promise.resolve(value).then(resolve, reject),
    };
    return self;
  }

  const db: any = {
    query,
    insert(table: unknown) {
      const name = tableName(table);
      return {
        values(values: any) {
          inserts.push({ table: name, values });
          return thenable([{ id: `${name}_${nextId++}`, ...values }]);
        },
      };
    },
    update(table: unknown) {
      const name = tableName(table);
      return {
        set(set: any) {
          return {
            where(where: unknown) {
              updates.push({ table: name, set, where });
              return thenable([]);
            },
          };
        },
      };
    },
    async transaction<T>(callback: (tx: any) => Promise<T>): Promise<T> {
      transactions += 1;
      return callback(db);
    },
  };

  return {
    db: db as Database,
    inserts,
    updates,
    conditions,
    get transactions() {
      return transactions;
    },
  };
}

/** A `sites` row with only the columns these tests read. */
export function fakeSite(over: Record<string, unknown> = {}) {
  return { id: "11111111-1111-4111-8111-111111111111", slug: "blog", name: "Blog", ...over };
}
