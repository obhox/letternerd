import {
  bigserial,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { documents } from "./content";
import { sites } from "./tenancy";

/**
 * Which crawlers actually fetched what, and when.
 *
 * The question this exists to answer is not "how much traffic" — it is
 * "has ClaudeBot ever fetched this post, and how long after publish". That
 * latency is the only direct evidence that sitemap `lastmod` and on-demand
 * revalidation are doing their job.
 *
 * IPs are stored only as a salted daily hash, so the table cannot be turned
 * into a visitor log.
 */
export const crawlerHits = pgTable(
  "crawler_hits",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    botName: text("bot_name").notNull(),
    /** ai | search | social | other */
    botCategory: text("bot_category").notNull().default("other"),
    userAgent: text("user_agent"),
    path: text("path").notNull(),
    statusCode: smallint("status_code"),
    referer: text("referer"),
    ipHash: text("ip_hash"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("crawler_hits_site_time_idx").on(t.siteId, t.occurredAt.desc()),
    index("crawler_hits_site_bot_time_idx").on(t.siteId, t.botName, t.occurredAt.desc()),
    index("crawler_hits_doc_idx").on(t.documentId, t.occurredAt.desc()),
  ],
);

/**
 * Raw hits are pruned after 90 days by the nightly job; this rollup is kept
 * indefinitely, because year-over-year AI-crawler behaviour is the interesting
 * series and it costs almost nothing to retain.
 */
export const crawlerHitsDaily = pgTable(
  "crawler_hits_daily",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    botName: text("bot_name").notNull(),
    hits: integer("hits").notNull().default(0),
    uniquePaths: integer("unique_paths").notNull().default(0),
  },
  (t) => [uniqueIndex("crawler_hits_daily_pk").on(t.siteId, t.day, t.botName)],
);

/**
 * Per-site credentials for the external analytics providers.
 *
 * ## Why these columns are encrypted rather than hashed
 *
 * Every other secret in this system is stored as a SHA-256 digest (see
 * `api_keys.key_hash`, `site_invitations.token_hash`), and that is the right
 * shape for them: the CMS only ever needs to *verify* a presented value, so it
 * never needs the value back, and a stolen database yields nothing usable.
 *
 * An OAuth refresh token is the opposite problem. The CMS has to *replay* it to
 * Google's token endpoint to mint access tokens, which means it must be
 * recoverable, which rules hashing out entirely. Encryption is not a weaker
 * choice made for convenience here — it is the only construction that satisfies
 * the requirement. The consequence is that the security of these rows is
 * exactly the security of `ANALYTICS_ENCRYPTION_KEY`: a database dump without
 * the key is inert, and a database dump *with* the key is a live Google
 * credential for every connected site. Keep the key out of the database, out of
 * backups, and rotatable.
 *
 * Ciphertext lives in `*_encrypted` columns whose names say so, because the one
 * thing worse than a plaintext token is a plaintext token in a column everybody
 * assumes is encrypted. The format is `iv:authTag:ciphertext` (AES-256-GCM);
 * `packages/capabilities/src/connections.ts` owns it.
 *
 * ## One connection per provider per site
 *
 * The unique index is what makes "reconnect" an upsert rather than a slow leak
 * of stale rows. Two Search Console rows for one site would mean two refresh
 * tokens, one of which is silently unused and never revoked, and no answer to
 * "which property are these numbers from".
 */
export const analyticsProviderEnum = pgEnum("analytics_provider", [
  "search_console",
  "falorb",
]);

export const siteAnalyticsConnections = pgTable(
  "site_analytics_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    provider: analyticsProviderEnum("provider").notNull(),

    /**
     * Nullable: a connection is legitimate with only a refresh token. Access
     * tokens expire in an hour, so an empty column means "mint one", not
     * "broken".
     */
    accessTokenEncrypted: text("access_token_encrypted"),
    /**
     * Also nullable, because Google issues a refresh token only on the first
     * consent — `prompt=consent` is what forces one on every re-authorisation,
     * and a row that arrives without one can still read until its access token
     * expires. The connection screen reports that state rather than hiding it.
     */
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),

    /**
     * The Search Console property exactly as Google names it
     * (`https://example.com/` or `sc-domain:example.com`), or a Falorb project
     * slug. Stored verbatim: it is path-encoded into request URLs, and
     * "normalising" it is how a domain property becomes an unresolvable URL
     * prefix property.
     */
    propertyUrl: text("property_url").notNull(),
    /** What the grant actually covers, as Google reported it back. */
    scopes: text("scopes").array().notNull().default([]),

    connectedByUserId: text("connected_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),

    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    /**
     * The last failure, in words, or null after a success.
     *
     * Kept on the row rather than only in a log because the person who has to
     * act on "Google refused the refresh token" is the site owner looking at
     * the settings screen, not an operator reading stderr.
     */
    lastError: text("last_error"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("site_analytics_connections_site_provider_uq").on(t.siteId, t.provider),
  ],
);
