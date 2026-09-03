import { createHash, timingSafeEqual } from "node:crypto";
import { registry } from "@cms/capabilities";
import { HTTP_STATUS, createLogger, isCmsError, systemActor } from "@cms/core";

const log = createLogger("cron");
import { cronSecret } from "@/env";
import { db, storage, now } from "@/server/services";
import { RULES, clientIp, rateLimit, rateLimitedResponse } from "@/server/rate-limit";

/**
 * The scheduled-task entry points.
 *
 * There is no worker container. Coolify's Scheduled Tasks curl these routes on
 * the studio itself (see `infra/DEPLOY.md`), which is why the job name is a
 * path segment rather than five near-identical files: the deploy document
 * lists five names, and one handler that knows all five cannot drift from it
 * one route at a time.
 *
 * Nothing here contains job logic. `publish-scheduled` resolves a capability
 * and invokes it, exactly as the REST and MCP transports do, so the sweep a
 * cron runs is the same code an operator can run by hand.
 */

export const dynamic = "force-dynamic";
/** A minute's backlog of renders. The default 15s would truncate a real run. */
export const maxDuration = 300;

/**
 * The jobs `infra/DEPLOY.md` schedules, and whether they exist yet.
 *
 * The four unimplemented ones are listed rather than left to 404 on purpose. A
 * scheduled task that fails every night at 03:17 is an alert nobody reads by
 * the third night, and by then it is also hiding the failure that matters. A
 * name in this table is a name the deploy document promises; a name absent
 * from it is a typo in the crontab, and *that* is worth a 404.
 */
const JOBS = {
  "publish-scheduled": "publish_scheduled",
  "crawler-rollup": null,
  "render-backfill": null,
  "link-suggestions": null,
  "retention-gc": null,
} as const;

type JobName = keyof typeof JOBS;

function isJobName(value: string): value is JobName {
  return Object.prototype.hasOwnProperty.call(JOBS, value);
}

/**
 * Bearer-token check against `CRON_SECRET`.
 *
 * This endpoint publishes content. An unauthenticated caller could push every
 * scheduled draft live on every site in the system, so:
 *
 * - An unset or blank `CRON_SECRET` refuses everything. Defaulting to open
 *   when configuration is missing is how a staging misconfiguration becomes a
 *   public write endpoint, and the failure mode of refusing is a job that
 *   visibly does not run.
 * - Both sides are hashed before comparison. `timingSafeEqual` throws on a
 *   length mismatch, so comparing the raw strings would either leak the
 *   secret's length through that error or need a length check that leaks it
 *   through timing. Two SHA-256 digests are always 32 bytes.
 * - Failure is answered with a bare 401. Which of "no header", "wrong scheme"
 *   and "wrong secret" applies is information for an attacker only.
 *
 * `cronSecret()` reads the value at call time and applies the production
 * strength rule: a placeholder or a short secret is treated as no secret at
 * all, so the endpoint refuses everything rather than accepting a credential
 * that has been published in `.env.example`. The studio still boots without
 * one — serving pages, letting people write — and loses only its scheduled
 * jobs, which this route then says plainly.
 */
function authorized(request: Request): boolean {
  const secret = cronSecret();
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) return false;

  const presented = header.slice("Bearer ".length).trim();
  if (presented.length === 0) return false;

  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(secret));
}

const unauthorized = () => Response.json({ error: "unauthenticated" }, { status: 401 });

interface PublishScheduledReport {
  lockAcquired: boolean;
  claimed: number;
  published: number;
  blocked: number;
  errored: number;
  durationMs: number;
  results: Array<Record<string, unknown>>;
}

async function runPublishScheduled(startedAt: number): Promise<Response> {
  const capability = registry.get("publish_scheduled");

  if (!capability) {
    /**
     * The capability is registered in `@cms/capabilities`' index, not here. If
     * that wiring is ever removed the honest answer is "this deployment cannot
     * run the job", not a silent success that lets scheduled posts rot.
     */
    return Response.json(
      {
        job: "publish-scheduled",
        status: "unavailable",
        message: "The publish_scheduled capability is not registered in this build.",
        durationMs: Date.now() - startedAt,
      },
      { status: 503 },
    );
  }

  try {
    const report = (await capability.invoke(
      {},
      {
        /**
         * The sweep crosses every site, so the actor's own `siteId` is
         * meaningless to it — the capability mints a per-site actor for each
         * document it touches. The nil UUID is used rather than an arbitrary
         * real site so that anything which did read it would read something
         * obviously wrong instead of quietly acting on a tenant at random.
         */
        actor: systemActor("00000000-0000-0000-0000-000000000000", "publish-scheduled"),
        services: { db, storage, now },
      },
    )) as PublishScheduledReport;

    /**
     * A run with any failure answers non-2xx.
     *
     * The Coolify task log is the only place anyone looks at this, and it
     * records success or failure from the exit status of `curl -fsS`. A 200
     * carrying `"errored": 3` in its body is a green tick in the scheduler UI
     * over three posts that did not go live. Blocked documents count too: they
     * have been demoted to draft and are waiting on a person who does not yet
     * know that.
     */
    const failures = report.errored + report.blocked;

    return Response.json(
      {
        job: "publish-scheduled",
        status: failures > 0 ? "completed_with_failures" : "ok",
        ...report,
        // Wall-clock including dispatch, not just the transaction.
        totalMs: Date.now() - startedAt,
      },
      { status: failures > 0 ? 500 : 200 },
    );
  } catch (error) {
    // The whole sweep failed — the lock query, the due-documents select, or
    // something below them. One line the task log can act on.
    const body = isCmsError(error)
      ? { error: error.code, message: error.message, ...error.details }
      : { error: "internal", message: "The scheduled publish run failed." };

    if (!isCmsError(error)) log.error("publish-scheduled sweep failed", { error });

    return Response.json(
      { job: "publish-scheduled", status: "failed", ...body, totalMs: Date.now() - startedAt },
      { status: isCmsError(error) ? HTTP_STATUS[error.code] : 500 },
    );
  }
}

async function handle(request: Request, jobParam: string): Promise<Response> {
  const startedAt = Date.now();

  // A budget per source address ahead of the secret check, so a loop of wrong
  // guesses costs the guesser a 429 rather than costing this process a hash
  // per attempt. The scheduler runs once a minute; thirty a minute is generous.
  const budget = rateLimit(RULES.cron, clientIp(request));
  if (!budget.allowed) return rateLimitedResponse(budget, RULES.cron);

  // Authorization before the job name is even looked at: whether a given job
  // exists is not something an unauthenticated caller gets to probe for.
  if (!authorized(request)) return unauthorized();

  if (!isJobName(jobParam)) {
    return Response.json(
      {
        error: "not_found",
        message: "No such job.",
        jobs: Object.keys(JOBS),
      },
      { status: 404 },
    );
  }

  if (jobParam === "publish-scheduled") return runPublishScheduled(startedAt);

  /**
   * Not implemented, and answered 200 on purpose.
   *
   * The body says plainly that nothing ran, so a person reading the task log
   * finds out immediately. The status code is 2xx so that `curl -fsS` succeeds
   * and the nightly task does not sit permanently red — a scheduler UI where
   * four of five entries are always failing is one where the fifth failure is
   * invisible. When one of these is built, it moves into the table above and
   * starts reporting real outcomes with real status codes.
   */
  return Response.json(
    {
      job: jobParam,
      status: "not_implemented",
      message: `The "${jobParam}" job is scheduled but not implemented yet; nothing ran.`,
      durationMs: Date.now() - startedAt,
    },
    { status: 200 },
  );
}

export async function GET(request: Request, ctx: { params: Promise<{ job: string }> }) {
  return handle(request, (await ctx.params).job);
}

/**
 * POST as well as GET.
 *
 * `infra/DEPLOY.md` specifies a plain `curl`, which is a GET — and a GET that
 * publishes is not something to be proud of, but the alternative is a deploy
 * document and a route that disagree, which is worse. POST is accepted so that
 * anything invoking these properly does not have to know that.
 */
export async function POST(request: Request, ctx: { params: Promise<{ job: string }> }) {
  return handle(request, (await ctx.params).job);
}
