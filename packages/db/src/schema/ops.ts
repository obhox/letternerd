import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth.js";
import { documents } from "./content.js";
import { sites } from "./tenancy.js";

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** markdown | url */
    source: text("source").notNull(),
    /** pending | running | succeeded | failed | dry_run */
    status: text("status").notNull().default("pending"),
    totalItems: integer("total_items").notNull().default(0),
    succeededItems: integer("succeeded_items").notNull().default(0),
    failedItems: integer("failed_items").notNull().default(0),
    /** Per-item outcome, so a dry run is inspectable before committing. */
    report: jsonb("report").notNull().default([]),
    startedByUserId: text("started_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("import_jobs_site_idx").on(t.siteId, t.createdAt.desc())],
);

/**
 * Outbound revalidation hooks.
 *
 * The consuming site verifies an HMAC over the raw body plus a timestamp, so a
 * captured request cannot be replayed. `secret` is per-webhook rather than
 * global, so rotating one site's secret does not disturb another's.
 */
export const webhooks = pgTable(
  "webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    /** document.published, document.updated, document.unpublished, … */
    events: text("events").array().notNull().default([]),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhooks_site_idx").on(t.siteId)],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    webhookId: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull().default({}),
    attempt: smallint("attempt").notNull().default(1),
    statusCode: smallint("status_code"),
    error: text("error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("webhook_deliveries_webhook_idx").on(t.webhookId, t.createdAt.desc())],
);

/**
 * Every capability invocation that changed something.
 *
 * Agents make changes quickly and in bulk, which is exactly why this is not
 * optional. `actorType` distinguishes a person in the studio from an API key
 * from an MCP client, because "who published this" has a materially different
 * answer in each case.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    /** user | api_key | system */
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    /** The capability name, verbatim. */
    capability: text("capability").notNull(),
    /** Transport that dispatched it: studio | rest | mcp | cli | cron. */
    transport: text("transport").notNull().default("rest"),
    targetType: text("target_type"),
    targetId: text("target_id"),
    /** Input with secrets redacted by the dispatcher, never the handler. */
    input: jsonb("input").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_site_time_idx").on(t.siteId, t.createdAt.desc()),
    index("audit_log_target_idx").on(t.targetType, t.targetId),
  ],
);

/** Short-lived, single-document tokens for the unauthenticated preview route. */
export const previewTokens = pgTable(
  "preview_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdByUserId: text("created_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("preview_tokens_hash_uq").on(t.tokenHash)],
);
