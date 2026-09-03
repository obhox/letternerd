import { sql } from "drizzle-orm";
import { createDb } from "@cms/db";
import { RULES, clientIp, rateLimit, rateLimitedResponse } from "@/server/rate-limit";

/**
 * Liveness by default; readiness on request.
 *
 * The bare path answers from the process alone. The container healthcheck
 * asks for `?deep=1`, which adds a database round trip — a process that is up
 * but cannot reach Postgres is not healthy in any useful sense, and would
 * serve 500s to every request while the orchestrator reported it fine.
 *
 * The two are split because this route is unauthenticated: a database query
 * that anyone on the internet can trigger by fetching a URL is a small but
 * free amplifier against the ten-connection pool. The bare path costs nothing,
 * and the deep path is budgeted per source address.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const budget = rateLimit(RULES.health, clientIp(request));
  if (!budget.allowed) return rateLimitedResponse(budget, RULES.health);

  const deep = new URL(request.url).searchParams.get("deep");
  if (!deep) return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });

  try {
    await createDb().execute(sql`select 1`);
    return Response.json({ status: "ok", database: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "degraded", database: "unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
