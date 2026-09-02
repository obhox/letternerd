import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { SITE_ROLES } from "@cms/core/roles";
import { user } from "./auth.js";

export const siteRoleEnum = pgEnum("site_role", SITE_ROLES);
export const apiKeyTypeEnum = pgEnum("api_key_type", ["publishable", "read", "admin"]);

/**
 * A site is a consuming domain, not a CMS URL.
 *
 * `baseUrl` is the origin of the site that will *render* this content, and
 * every absolute URL the CMS emits — canonical, sitemap `<loc>`, OG image
 * reference, RSS link — is built from it. The CMS's own hostname appears in
 * none of them. Getting this backwards points every canonical signal at the
 * wrong host, which is the single most expensive mistake available here.
 */
export const sites = pgTable(
  "sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Studio URL segment. Not user-visible on the consuming site. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),

    baseUrl: text("base_url").notNull(),
    blogBasePath: text("blog_base_path").notNull().default("/blog"),
    /** Extra origins allowed to serve this content, e.g. a staging domain. */
    additionalDomains: text("additional_domains").array().notNull().default([]),

    /** BCP-47. Drives `og:locale`, `inLanguage` and hreflang. */
    locale: text("locale").notNull().default("en"),
    timeZone: text("time_zone").notNull().default("UTC"),

    // --- Organization JSON-LD, emitted once per page by the SDK -------------
    orgName: text("org_name"),
    orgLogoUrl: text("org_logo_url"),
    orgSameAs: text("org_same_as").array().notNull().default([]),
    twitterHandle: text("twitter_handle"),

    defaultAuthorId: uuid("default_author_id"),
    defaultOgAssetId: uuid("default_og_asset_id"),
    /** Background, fonts, logo and accent for generated OG cards. */
    ogTemplate: jsonb("og_template").notNull().default({}),

    feedTitle: text("feed_title"),
    feedDescription: text("feed_description"),
    /** Appended verbatim to the generated robots.txt. */
    robotsExtra: text("robots_extra"),
    /** The blockquote summary at the head of llms.txt. */
    llmsIntro: text("llms_intro"),

    /**
     * Bumped when the markdown pipeline changes. The nightly backfill
     * re-renders documents whose own renderVersion is behind this one.
     */
    renderVersion: integer("render_version").notNull().default(1),

    settings: jsonb("settings").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sites_slug_uq").on(t.slug),
    // Two sites claiming one origin would make canonical URLs ambiguous.
    uniqueIndex("sites_base_url_uq").on(t.baseUrl),
  ],
);

export const siteMembers = pgTable(
  "site_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: siteRoleEnum("role").notNull().default("author"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("site_members_site_user_uq").on(t.siteId, t.userId),
    // "which sites can I see" runs on every studio page load.
    index("site_members_user_idx").on(t.userId),
  ],
);

export const siteInvitations = pgTable(
  "site_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: siteRoleEnum("role").notNull().default("author"),
    /** The token is never stored in the clear; the link carries the plaintext. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    invitedByUserId: text("invited_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("site_invitations_token_uq").on(t.tokenHash),
    index("site_invitations_site_idx").on(t.siteId),
  ],
);

/**
 * Credentials for machines: consuming sites, CI, and MCP clients.
 *
 * A key belongs to exactly one site, which is why no API path carries a site
 * identifier — there is no code path where a caller chooses its own tenant.
 * Stored as a SHA-256 digest; the plaintext is shown once and is unrecoverable.
 */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: apiKeyTypeEnum("type").notNull(),
    keyHash: text("key_hash").notNull(),
    /** Enough to recognise a key in a list without being enough to use it. */
    keyPrefix: text("key_prefix").notNull(),
    scopes: text("scopes").array().notNull().default([]),
    /** Origin allowlist. Enforced for publishable keys only. */
    allowedOrigins: text("allowed_origins").array().notNull().default([]),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("api_keys_hash_uq").on(t.keyHash),
    index("api_keys_site_idx").on(t.siteId),
  ],
);
