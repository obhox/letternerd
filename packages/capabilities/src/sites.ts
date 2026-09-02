import { z } from "zod";
import { eq } from "drizzle-orm";
import { defineCapability } from "@cms/core";
import * as schema from "@cms/db/schema";
import { requireSiteRow } from "./shared";

/**
 * Site capabilities.
 *
 * There is no `create_site` here yet: creating a site is an operator action
 * that also provisions a Coolify DNS entry and an object-storage prefix, and
 * exposing it to an API key would let a leaked credential mint tenants.
 */

export const getSite = defineCapability({
  name: "get_site",
  title: "Get site",
  description:
    "The current site's configuration: its canonical origin, blog base path, locale, " +
    "Organization structured-data fields and llms.txt intro. Every absolute URL the CMS " +
    "emits is built from `baseUrl`.",
  input: z.object({}),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/site" },
  handler: async (_input, { actor, services }) => requireSiteRow(services.db, actor.siteId),
});

export const updateSite = defineCapability({
  name: "update_site",
  title: "Update site settings",
  description:
    "Change this site's settings. Changing `baseUrl` rewrites every canonical URL, sitemap " +
    "entry and feed link the site emits, so it is an owner-only action.",
  input: z.object({
    name: z.string().min(1).max(200).optional(),
    baseUrl: z.string().url().optional(),
    blogBasePath: z.string().regex(/^\/[a-z0-9/-]*$/).optional(),
    locale: z.string().min(2).max(35).optional(),
    orgName: z.string().max(200).nullable().optional(),
    orgLogoUrl: z.string().url().nullable().optional(),
    orgSameAs: z.array(z.string().url()).optional(),
    twitterHandle: z.string().max(50).nullable().optional(),
    feedTitle: z.string().max(200).nullable().optional(),
    feedDescription: z.string().max(500).nullable().optional(),
    robotsExtra: z.string().max(4000).nullable().optional(),
    llmsIntro: z.string().max(2000).nullable().optional(),
  }),
  scopes: ["site:admin"],
  role: "owner",
  route: { method: "PATCH", path: "/site" },
  handler: async (input, { actor, services }) => {
    const [updated] = await services.db
      .update(schema.sites)
      .set({
        ...input,
        // Stored without a trailing slash so every URL builder can concatenate
        // without producing a double slash.
        ...(input.baseUrl && { baseUrl: input.baseUrl.replace(/\/+$/, "") }),
        updatedAt: services.now(),
      })
      .where(eq(schema.sites.id, actor.siteId))
      .returning();
    return updated!;
  },
});

export const siteCapabilities = [getSite, updateSite];
