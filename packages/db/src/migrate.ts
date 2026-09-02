import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Apply migrations, once, even if two deploys race.
 *
 * Compose starts this as its own service that must complete before the studio
 * boots, so no process ever queries a schema that does not exist yet. The
 * advisory lock covers the other half: two simultaneous deploys both running
 * this would otherwise both try to apply the same migration.
 *
 * Never `drizzle-kit push` against production — it diffs and drops.
 */

// Arbitrary but fixed. Any other process taking this same lock is us.
const LOCK_ID = 0x636d735f6d6967n; // "cms_mig"

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");

  // max: 1 — the migrator must not interleave across connections.
  const client = postgres(url, { max: 1 });
  const db = drizzle(client);
  const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");

  try {
    await db.execute(sql`select pg_advisory_lock(${LOCK_ID})`);
    console.log("[migrate] lock acquired, applying migrations…");
    await migrate(db, { migrationsFolder });
    console.log("[migrate] up to date");
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${LOCK_ID})`).catch(() => {});
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
