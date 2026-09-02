import { sql } from "drizzle-orm";
import { createDb } from "@cms/db";

/**
 * Liveness plus a database round trip.
 *
 * The container healthcheck hits this. A process that is up but cannot reach
 * Postgres is not healthy in any useful sense — it would serve 500s to every
 * request while the orchestrator reported it fine.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await createDb().execute(sql`select 1`);
    return Response.json({ status: "ok" });
  } catch {
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
