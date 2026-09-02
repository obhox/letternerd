import { eq } from "drizzle-orm";
import { createDb, closeDb } from "@cms/db";
import * as schema from "@cms/db/schema";
import { auth } from "../src/lib/auth";

/**
 * Create a studio account that can actually sign in, and put it on a site.
 *
 * Deliberately goes through better-auth's own sign-up rather than inserting a
 * user row directly: the password hash format, its parameters and the account
 * row that carries it are better-auth's to define, and a hand-rolled hash is a
 * login that fails only when someone tries it. Seeding a user without a
 * credential — which the database seed does — produces exactly that.
 *
 *   pnpm --filter @cms/studio create-account
 *   pnpm --filter @cms/studio create-account -- you@example.com 'a-long-password' spendtab owner
 */

const [emailArg, passwordArg, siteArg, roleArg] = process.argv.slice(2);

const email = emailArg ?? "test@example.com";
const password = passwordArg ?? "test-password-1234";
const siteSlug = siteArg ?? "spendtab";
const role = (roleArg ?? "owner") as "owner" | "editor" | "author";

async function main() {
  if (password.length < 10) {
    throw new Error("Password must be at least 10 characters — @cms/auth enforces this.");
  }

  const db = createDb();

  const [site] = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.slug, siteSlug))
    .limit(1);

  if (!site) {
    throw new Error(
      `No site with slug "${siteSlug}". Run \`pnpm db:seed\` first, or pass an existing slug.`,
    );
  }

  const existing = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
    .limit(1);

  let userId = existing[0]?.id;

  if (userId) {
    console.log(`[account] ${email} already exists; leaving its password alone.`);
  } else {
    const result = await auth.api.signUpEmail({
      body: { email, password, name: email.split("@")[0] ?? "Test User" },
    });
    userId = result.user.id;
    console.log(`[account] created ${email}`);
  }

  /**
   * Mark it verified directly.
   *
   * Verification exists to prove someone controls an address before an
   * invitation binds a seat to it. A local test account has no invitation and
   * no mail provider, so requiring the round trip would only mean the account
   * cannot be used. This script is for development; nothing calls it in
   * production.
   */
  await db
    .update(schema.user)
    .set({ emailVerified: true })
    .where(eq(schema.user.id, userId!));

  await db
    .insert(schema.siteMembers)
    .values({ siteId: site.id, userId: userId!, role })
    // Re-running must not silently demote an owner to whatever the default is.
    .onConflictDoNothing();

  const [membership] = await db
    .select({ role: schema.siteMembers.role })
    .from(schema.siteMembers)
    .where(eq(schema.siteMembers.userId, userId!))
    .limit(1);

  console.log("");
  console.log("  Sign in at  http://localhost:3000/sign-in");
  console.log(`  Email       ${email}`);
  console.log(`  Password    ${password}`);
  console.log(`  Site        ${site.name} (${site.slug})`);
  console.log(`  Role        ${membership?.role ?? role}`);
  console.log("");

  await closeDb();
}

main().catch(async (err) => {
  console.error("[account] failed:", err instanceof Error ? err.message : err);
  await closeDb().catch(() => {});
  process.exit(1);
});
