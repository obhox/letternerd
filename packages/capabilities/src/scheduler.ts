import { z } from "zod";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { defineCapability, isCmsError, systemActor } from "@cms/core";
import * as schema from "@cms/db/schema";
import { publishDocument } from "./documents";
import type { Database } from "./services";

/**
 * Scheduled publishing.
 *
 * `documents.scheduledFor` is written by `publish_document` when it is given a
 * future `publishAt`, and until something comes along and acts on it the
 * column means nothing at all — a post scheduled for Tuesday stays `scheduled`
 * forever. This module is that something.
 *
 * It is a capability rather than a script for the same reason everything else
 * is: the cron route, a CLI invocation and an operator poking it through MCP
 * all reach the identical code, with the identical authorization check, and
 * none of them can accumulate its own variant of the publish rules.
 */

/**
 * The advisory-lock key, split as Postgres wants it: a namespace shared by
 * every lock this application takes, and an id for this particular job.
 *
 * Two ints rather than one bigint so a future job can pick a neighbouring id
 * without any risk of colliding with an unrelated application on the same
 * database.
 */
const ADVISORY_NAMESPACE = 4_410_707; // 0x434D53 — "CMS"
const PUBLISH_SCHEDULED_LOCK = 1;

/**
 * What happened to one document, in the batch report.
 *
 * `blocked` is deliberately distinct from `error`. A blocked document has been
 * dealt with — moved to draft, findings recorded — and needs a person; an
 * errored one has not, and will be retried.
 */
export interface ScheduledOutcome {
  documentId: string;
  siteId: string;
  slug: string;
  scheduledFor: string | null;
  outcome: "published" | "blocked" | "error";
  message?: string;
  findings?: unknown[];
}

/**
 * Read the single boolean out of `select pg_try_advisory_xact_lock(...)`.
 *
 * Written defensively because `db.execute` hands back whatever the driver
 * returns — postgres-js gives an array of rows, node-postgres gives
 * `{ rows }` — and a lock check that silently reads `undefined` as "not
 * locked" would disable the protection it exists to provide.
 */
function readLockResult(raw: unknown): boolean {
  const rows = (Array.isArray(raw) ? raw : ((raw as { rows?: unknown[] })?.rows ?? [])) as Array<
    Record<string, unknown>
  >;
  const value = rows[0]?.locked;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "t" || value === "true";
  throw new Error("pg_try_advisory_xact_lock returned no readable result.");
}

export const publishScheduled = defineCapability({
  name: "publish_scheduled",
  title: "Publish scheduled documents",
  description:
    "Cron entry point, not a person-facing action: it runs every minute as a system actor and " +
    "sweeps EVERY site, so the calling credential's own site is irrelevant to what it does. " +
    "Publishes each document whose scheduledFor has passed, through the same publish path and " +
    "the same lint gate as a manual publish. A document that fails the gate is moved to draft " +
    "with its findings recorded and the batch continues; the return value reports every " +
    "document individually. Safe to call twice — a Postgres advisory lock makes a second " +
    "concurrent run a no-op rather than a double publish.",
  input: z.object({
    /**
     * A ceiling on one run, not a page size.
     *
     * The lock is held for the whole batch and the job fires again in sixty
     * seconds, so a backlog of a thousand documents should drain over several
     * runs rather than pin a connection and a lock for minutes.
     */
    limit: z.number().int().min(1).max(500).default(100),
  }),
  scopes: ["content:publish"],
  /**
   * `owner`, because there is no site this runs "on". A cron sweep crossing
   * every tenant is the most privileged thing in the system, and the role
   * floor should say so even though the only actor that ever satisfies it is
   * `systemActor`.
   */
  role: "owner",
  route: { method: "POST", path: "/jobs/publish-scheduled" },
  handler: async (input, { services }) => {
    const startedAt = Date.now();

    /**
     * One transaction wraps the whole run, and the first thing it does is take
     * a transaction-scoped advisory lock.
     *
     * The job runs every minute and a slow run must not overlap itself: two
     * invocations both selecting the same due document would both render it
     * and both write it, and on a document whose publish has side effects
     * beyond its own row that is a duplicate, not a no-op.
     *
     * `pg_try_advisory_xact_lock` rather than the session-level
     * `pg_advisory_lock` for two reasons. It never waits, so a slow run causes
     * the next tick to skip rather than to queue up behind it and pile on. And
     * it is released by the transaction ending — including by the process
     * being killed mid-run — whereas a session lock in a pooled connection can
     * be taken on one connection and unlocked on another, which leaks the lock
     * until that connection is recycled and wedges the job permanently.
     */
    return services.db.transaction(async (tx) => {
      const locked = readLockResult(
        await tx.execute(
          sql`select pg_try_advisory_xact_lock(${ADVISORY_NAMESPACE}, ${PUBLISH_SCHEDULED_LOCK}) as locked`,
        ),
      );

      if (!locked) {
        // Not an error. The previous run is still going; it owns these rows.
        return {
          lockAcquired: false,
          claimed: 0,
          published: 0,
          blocked: 0,
          errored: 0,
          durationMs: Date.now() - startedAt,
          results: [] as ScheduledOutcome[],
        };
      }

      const now = services.now();

      /**
       * The scheduler's only query, and the one `documents_scheduled_idx` was
       * built for. No site predicate: this is the one code path in the CMS
       * that is deliberately cross-tenant.
       */
      const due = await tx
        .select({
          id: schema.documents.id,
          siteId: schema.documents.siteId,
          slug: schema.documents.slug,
          scheduledFor: schema.documents.scheduledFor,
        })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.status, "scheduled"),
            isNull(schema.documents.deletedAt),
            lte(schema.documents.scheduledFor, now),
          ),
        )
        .orderBy(asc(schema.documents.scheduledFor))
        .limit(input.limit);

      const results: ScheduledOutcome[] = [];
      let published = 0;
      let blocked = 0;
      let errored = 0;

      for (const doc of due) {
        const base = {
          documentId: doc.id,
          siteId: doc.siteId,
          slug: doc.slug,
          scheduledFor: doc.scheduledFor ? doc.scheduledFor.toISOString() : null,
        };

        try {
          /**
           * The existing publish path, reused rather than reimplemented.
           *
           * Rendering, the lint gate, the qa_blocks rewrite, `contentHash`,
           * `dateModified` and `firstPublishedAt` are all a dozen decisions
           * that a scheduled publish must make identically to a manual one. A
           * second copy of them here would drift, and the way anyone would
           * find out is a scheduled post rendering differently from the same
           * post published by hand.
           *
           * `publish_document` opens its own transaction, which nests as a
           * SAVEPOINT inside this one. That is what makes a failure survivable:
           * a document that throws rolls back to its savepoint and leaves this
           * transaction usable, so the rest of the batch still publishes.
           *
           * The actor is minted per document against that document's own site,
           * so every scoping check inside the publish path still applies —
           * this job is cross-tenant, but nothing it calls is.
           */
          await publishDocument.invoke(
            { id: doc.id },
            {
              actor: systemActor(doc.siteId, "publish-scheduled"),
              services: {
                ...services,
                // drizzle's transaction handle is the same query surface minus
                // the raw driver handle, which nothing on this path touches.
                db: tx as unknown as Database,
              },
            },
          );

          published++;
          results.push({ ...base, outcome: "published" });
        } catch (error) {
          /**
           * A blocked document is moved OUT of `scheduled`, into `draft`.
           *
           * Leaving it scheduled would mean the job picks it up again in sixty
           * seconds and fails on it again, forever, while the author sees a
           * post that says "scheduled" and never goes live and nobody is told
           * anything. Draft plus the findings on `lintReport` puts it back in
           * front of a person with the reason attached — the studio already
           * renders that badge — and takes it out of the sweep.
           *
           * Only the gate does this. An unexpected failure (the database went
           * away mid-batch) is transient and is deliberately left `scheduled`
           * so the next run retries it; demoting a post to draft because a
           * connection blipped would be its own kind of lost work.
           */
          if (isCmsError(error) && error.code === "precondition_failed") {
            const findings = Array.isArray(error.details.findings)
              ? (error.details.findings as unknown[])
              : [];

            await tx
              .update(schema.documents)
              .set({
                status: "draft",
                scheduledFor: null,
                lintReport: {
                  findings,
                  checkedAt: now.toISOString(),
                  // Names why this document is suddenly a draft again. Without
                  // it the author's only clue is a status that changed itself.
                  blockedBy: "publish-scheduled",
                },
                updatedAt: now,
              })
              .where(eq(schema.documents.id, doc.id));

            blocked++;
            results.push({
              ...base,
              outcome: "blocked",
              message: error.message,
              findings,
            });
            continue;
          }

          errored++;
          results.push({
            ...base,
            outcome: "error",
            message: isCmsError(error)
              ? `${error.code}: ${error.message}`
              : error instanceof Error
                ? error.message
                : "Unknown error.",
          });
        }
      }

      return {
        lockAcquired: true,
        claimed: due.length,
        published,
        blocked,
        errored,
        durationMs: Date.now() - startedAt,
        results,
      };
    });
  },
});

export const listScheduled = defineCapability({
  name: "list_scheduled",
  title: "List scheduled documents",
  description:
    "What is queued to go live on this site, soonest first, with whether each one is already " +
    "overdue. Read-only and scoped to the caller's site — unlike publish_scheduled, which is the " +
    "cron sweep and crosses every site. Use this to show a queue; use publish_document with " +
    "`publishAt` to add to it.",
  input: z.object({ limit: z.number().int().min(1).max(200).default(50) }),
  scopes: ["content:read"],
  role: "author",
  readOnly: true,
  idempotent: true,
  route: { method: "GET", path: "/scheduled" },
  handler: async (input, { actor, services }) => {
    const now = services.now();

    const rows = await services.db
      .select({
        id: schema.documents.id,
        type: schema.documents.type,
        slug: schema.documents.slug,
        title: schema.documents.title,
        scheduledFor: schema.documents.scheduledFor,
        updatedAt: schema.documents.updatedAt,
        lintReport: schema.documents.lintReport,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.siteId, actor.siteId),
          eq(schema.documents.status, "scheduled"),
          isNull(schema.documents.deletedAt),
        ),
      )
      .orderBy(asc(schema.documents.scheduledFor))
      .limit(input.limit);

    return {
      /**
       * `overdue` is computed rather than left to the caller.
       *
       * A row still sitting here with a time in the past means the runner is
       * not running — the single most useful thing this list can tell an
       * operator, and the thing a screen would otherwise have to know to
       * derive for itself.
       */
      documents: rows.map((row) => ({
        ...row,
        overdue: row.scheduledFor !== null && row.scheduledFor.getTime() <= now.getTime(),
      })),
      checkedAt: now,
    };
  },
});

export const schedulerCapabilities = [publishScheduled, listScheduled];
