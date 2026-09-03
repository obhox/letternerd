import { and, eq, sql } from "drizzle-orm";
import { createDb, closeDb } from "@cms/db";
import * as schema from "@cms/db/schema";

/**
 * Give every publishable key with no origin allow-list its site's origins.
 *
 * `originAllowed` used to treat an empty list as "any origin", which made the
 * default publishable key usable from every page on the internet. It now
 * treats an empty list as a refusal, and `create_api_key` fills the list with
 * the site's own origins. Keys created before that change would stop working
 * in the browser on deploy; this writes the same default onto them so the
 * change is invisible to a correctly deployed site and only shuts out the
 * pages that were never meant to hold the key.
 *
 *   pnpm --filter @cms/studio backfill-key-origins
 *
 * Idempotent: keys that already list an origin are untouched.
 */

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

async function main() {
  const db = createDb();
  const keys = await db
    .select({ id: schema.apiKeys.id, siteId: schema.apiKeys.siteId, name: schema.apiKeys.name })
    .from(schema.apiKeys)
    .where(and(eq(schema.apiKeys.type, "publishable"), sql`cardinality(${schema.apiKeys.allowedOrigins}) = 0`));

  let updated = 0;
  for (const key of keys) {
    const [site] = await db
      .select({ baseUrl: schema.sites.baseUrl, additionalDomains: schema.sites.additionalDomains })
      .from(schema.sites)
      .where(eq(schema.sites.id, key.siteId))
      .limit(1);
    if (!site) continue;
    const origins = [...new Set([site.baseUrl, ...site.additionalDomains].map(originOf))];
    await db.update(schema.apiKeys).set({ allowedOrigins: origins }).where(eq(schema.apiKeys.id, key.id));
    console.log(`[backfill-key-origins] ${key.name}: ${origins.join(", ")}`);
    updated += 1;
  }

  console.log(`[backfill-key-origins] updated ${updated} of ${keys.length} publishable keys with no origins.`);
  await closeDb();
}

main().catch(async (error) => {
  console.error("[backfill-key-origins] failed:", error instanceof Error ? error.message : error);
  await closeDb().catch(() => {});
  process.exit(1);
});
