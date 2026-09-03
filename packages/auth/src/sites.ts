import { conflict, invalidInput } from "@cms/core";
import type { Database } from "@cms/db";
import * as schema from "@cms/db/schema";

/**
 * Self-serve site creation: the one way a `sites` row and its first `owner`
 * membership come into existence outside `pnpm db:seed`.
 *
 * This deliberately does not go through `@cms/capabilities`. Every capability
 * there is invoked against an `Actor` that already carries a `siteId` — see
 * `requireSite` in `site-scope.ts` — because the whole system is built on the
 * invariant that a site is resolved in exactly one place before any handler
 * runs. Creating a site is the one action that cannot have a `siteId` yet, so
 * it lives here instead, alongside `invitations.ts`, which is the same shape
 * of problem: an action authorized by "you are a signed-in person," not by
 * membership on the site it concerns.
 */

/** Studio URL segments that a site slug would collide with or shadow. */
const RESERVED_SLUGS = new Set([
  "sign-in",
  "sign-up",
  "two-factor",
  "verify-email",
  "accept-invite",
  "api",
  "sites",
  "new",
]);

const MAX_SLUG_ATTEMPTS = 20;

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export interface CreateSiteArgs {
  db: Database;
  userId: string;
  name: string;
  baseUrl: string;
}

export interface CreatedSite {
  id: string;
  slug: string;
  name: string;
  baseUrl: string;
}

export async function createSite(args: CreateSiteArgs): Promise<CreatedSite> {
  const { db, userId } = args;

  const name = args.name.trim();
  if (name.length === 0) throw invalidInput("A site needs a name.", { name: args.name });
  if (name.length > 200) throw invalidInput("That name is too long.", { name: args.name });

  let parsed: URL;
  try {
    parsed = new URL(args.baseUrl.trim());
  } catch {
    throw invalidInput("Base URL must be a full address, including https://.", {
      baseUrl: args.baseUrl,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidInput("Base URL must use http or https.", { baseUrl: args.baseUrl });
  }
  // Stored without a trailing slash, matching `updateSite` — so every URL
  // builder downstream can concatenate without producing a double slash.
  const baseUrl = parsed.toString().replace(/\/+$/, "");

  // A friendly message in the common case. The insert below is still the real
  // guard — this is a best-effort precheck, not the source of truth.
  const existingByBaseUrl = await db.query.sites.findFirst({
    where: (s, { eq }) => eq(s.baseUrl, baseUrl),
    columns: { id: true },
  });
  if (existingByBaseUrl) {
    throw conflict("A site with that base URL already exists.", { baseUrl });
  }

  const base = slugify(name);
  if (base.length === 0) {
    throw invalidInput(
      "That name does not produce a usable URL segment. Try adding a letter or number.",
      { name },
    );
  }

  try {
    return await db.transaction(async (tx) => {
      let site: typeof schema.sites.$inferSelect | undefined;

      for (let attempt = 0; attempt < MAX_SLUG_ATTEMPTS && !site; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
        if (RESERVED_SLUGS.has(slug)) continue;

        [site] = await tx
          .insert(schema.sites)
          .values({ slug, name, baseUrl })
          // Targeted at the slug only: a slug collision retries silently
          // below with the next candidate, but a base URL collision must
          // surface as a real conflict rather than vanish into a retry loop
          // that keeps minting slugs nobody asked for.
          .onConflictDoNothing({ target: schema.sites.slug })
          .returning();
      }

      if (!site) {
        throw conflict(
          "Could not find an available URL segment for that name. Try a more distinct name.",
          { name },
        );
      }

      await tx.insert(schema.siteMembers).values({ siteId: site.id, userId, role: "owner" });

      return { id: site.id, slug: site.slug, name: site.name, baseUrl: site.baseUrl };
    });
  } catch (error) {
    // The precheck above has a benign race: two concurrent requests for the
    // same base URL can both pass it. This is the backstop for that case.
    if (isUniqueViolation(error)) {
      throw conflict("That site could not be created — its base URL is already in use.", {
        baseUrl,
      });
    }
    throw error;
  }
}
