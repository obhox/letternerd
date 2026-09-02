import {
  bigserial,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { documents } from "./content.js";
import { sites } from "./tenancy.js";

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
