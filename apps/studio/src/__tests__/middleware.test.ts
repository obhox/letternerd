import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Which paths the middleware may redirect.
 *
 * The regression this guards is not a 401 somebody would notice. Coolify runs
 * the scheduled tasks as `curl -fsS -H "Authorization: Bearer $CRON_SECRET"`;
 * `-f` does not treat a 3xx as an error and curl does not follow one without
 * `-L`, so a redirect on `/api/cron/*` exits 0. Every scheduled task then
 * reports success on schedule while nothing runs and scheduled posts never
 * publish. It reached production once, found only by curling the route by hand
 * inside the container.
 *
 * The bearer-token endpoints are asserted together because they share one
 * argument: each authenticates itself, none can act on a session cookie, and
 * answering any of them with HTML is a failure their callers cannot diagnose.
 */

type Middleware = (request: NextRequest) => Response;

let middleware: Middleware;

beforeAll(async () => {
  ({ middleware } = (await import("../middleware")) as { middleware: Middleware });
});

function get(pathname: string): Response {
  return middleware(new NextRequest(new URL(pathname, "https://cms.example.com")));
}

describe("middleware", () => {
  it.each([
    "/api/cron/publish-scheduled",
    "/api/cron/retention-gc",
    "/api/health",
    "/api/v1/sites",
    "/api/mcp",
    "/api/auth/session",
  ])("lets an unauthenticated request through to %s", (pathname) => {
    expect(get(pathname).status).not.toBe(307);
  });

  it.each(["/sign-in", "/sign-up", "/verify-email", "/accept-invite"])(
    "lets an unauthenticated visitor reach %s",
    (pathname) => {
      expect(get(pathname).status).not.toBe(307);
    },
  );

  it("still sends an unauthenticated visitor from the studio to sign-in", () => {
    const response = get("/sites/example/posts");

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("redirect")).toBe("/sites/example/posts");
  });

  it("hardens the redirect it issues, which no next.config header covers", () => {
    const headers = get("/sites/example/posts").headers;

    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
