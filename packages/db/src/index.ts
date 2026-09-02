import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index";

export * as schema from "./schema/index";
export { schema as tables };

/**
 * One pool per process.
 *
 * better-auth opens its own small pool in `@cms/auth` rather than sharing this
 * one — it manages its own transactions and connection lifetime, and coupling
 * the two means a migration or a long report can starve sign-in.
 */
let client: postgres.Sql | undefined;

export function createDb(connectionString?: string) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  client ??= postgres(url, {
    max: 10,
    // Drizzle handles its own type parsing; leave dates as-is.
    transform: { undefined: null },
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof createDb>;

/** For scripts and tests that must close cleanly. */
export async function closeDb(): Promise<void> {
  await client?.end({ timeout: 5 });
  client = undefined;
}
