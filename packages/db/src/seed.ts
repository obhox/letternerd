import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { KEY_SCOPES } from "@cms/core";
import { createDb, closeDb } from "./index";
import { generateApiKey } from "./api-keys";
import * as schema from "./schema/index";

/**
 * A development seed with two sites.
 *
 * Two, not one, deliberately: almost every tenant-isolation bug is invisible
 * against a single-site database, and the point of seeding is to make those
 * bugs reproducible on a laptop rather than in production.
 */

async function main() {
  const db = createDb();

  const existing = await db.select().from(schema.sites).limit(1);
  if (existing.length > 0 && !process.argv.includes("--force")) {
    console.log("[seed] sites already exist; pass --force to add anyway.");
    await closeDb();
    return;
  }

  const ownerId = randomUUID();
  const editorId = randomUUID();
  const authorId = randomUUID();

  await db.insert(schema.user).values([
    { id: ownerId, name: "Dev Owner", email: "owner@example.com", emailVerified: true },
    { id: editorId, name: "Dev Editor", email: "editor@example.com", emailVerified: true },
    { id: authorId, name: "Dev Author", email: "author@example.com", emailVerified: true },
  ]);

  const sites = await db
    .insert(schema.sites)
    .values([
      {
        slug: "spendtab",
        name: "SpendTab",
        baseUrl: "https://spendtab.com",
        blogBasePath: "/blog",
        locale: "en",
        orgName: "SpendTab",
        llmsIntro: "SpendTab is budgeting and cash-flow software for small businesses.",
      },
      {
        slug: "falorb",
        name: "Falorb",
        baseUrl: "https://falorb.com",
        blogBasePath: "/blog",
        locale: "en-GB",
        orgName: "Falorb",
        llmsIntro: "Falorb is self-hosted product analytics.",
      },
    ])
    .returning();

  const [spendtab, falorb] = sites;
  if (!spendtab || !falorb) throw new Error("seed: site insert returned nothing");

  // The owner is on both sites; the other two only on the first, so that a
  // cross-site access attempt is expressible without editing the seed.
  await db.insert(schema.siteMembers).values([
    { siteId: spendtab.id, userId: ownerId, role: "owner" },
    { siteId: spendtab.id, userId: editorId, role: "editor" },
    { siteId: spendtab.id, userId: authorId, role: "author" },
    { siteId: falorb.id, userId: ownerId, role: "owner" },
  ]);

  const authors = await db
    .insert(schema.authors)
    .values([
      {
        siteId: spendtab.id,
        userId: editorId,
        slug: "dev-editor",
        name: "Dev Editor",
        jobTitle: "Finance Writer",
        bioMd: "Writes about small-business cash flow.",
        sameAs: ["https://example.com/@deveditor"],
        knowsAbout: ["cash flow", "budgeting"],
      },
      {
        siteId: falorb.id,
        slug: "guest",
        name: "Guest Contributor",
        jobTitle: "Analytics Engineer",
      },
    ])
    .returning();

  await db
    .update(schema.sites)
    .set({ defaultAuthorId: authors[0]?.id })
    .where(eq(schema.sites.id, spendtab.id));

  await db.insert(schema.categories).values([
    { siteId: spendtab.id, slug: "guides", name: "Guides" },
    { siteId: spendtab.id, slug: "product", name: "Product" },
  ]);
  await db.insert(schema.tags).values([
    { siteId: spendtab.id, slug: "cash-flow", name: "Cash flow" },
    { siteId: spendtab.id, slug: "invoicing", name: "Invoicing" },
    { siteId: spendtab.id, slug: "seo", name: "SEO" },
  ]);

  // One key per type, so every auth path can be exercised immediately.
  const issued: { label: string; plaintext: string }[] = [];
  for (const type of ["publishable", "read", "admin"] as const) {
    const key = generateApiKey(type);
    await db.insert(schema.apiKeys).values({
      siteId: spendtab.id,
      name: `dev ${type}`,
      type,
      keyHash: key.keyHash,
      keyPrefix: key.keyPrefix,
      scopes: [...KEY_SCOPES[type]],
      createdByUserId: ownerId,
    });
    issued.push({ label: type, plaintext: key.plaintext });
  }

  console.log("[seed] done.");
  console.log(`  sites:  ${spendtab.slug} (${spendtab.id}), ${falorb.slug} (${falorb.id})`);
  console.log("  users:  owner@example.com, editor@example.com, author@example.com");
  console.log("  keys (shown once — they are stored hashed):");
  for (const k of issued) console.log(`    ${k.label.padEnd(12)} ${k.plaintext}`);

  await closeDb();
}

main().catch(async (err) => {
  console.error("[seed] failed:", err);
  await closeDb().catch(() => {});
  process.exit(1);
});
