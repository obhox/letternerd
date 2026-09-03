import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * The cron routes' front door.
 *
 * This endpoint publishes content across every site in the installation, so
 * the interesting cases are all refusals: a wrong secret, a missing header, and
 * — the one that actually bites in production — a deployment where nobody set
 * `CRON_SECRET` at all. The last must refuse, not fall open, because a studio
 * that silently accepts unauthenticated calls to a publish endpoint looks
 * exactly like a studio that is working.
 *
 * The route is imported dynamically after the environment is populated: the
 * studio's `env` module parses `process.env` at import and takes the process
 * down if it is incomplete, which is deliberate and which a test must satisfy
 * rather than work around.
 */

type Handler = (
  request: Request,
  ctx: { params: Promise<{ job: string }> },
) => Promise<Response>;

let GET: Handler;

const SECRET = "a-cron-secret-that-is-long-enough";

beforeAll(async () => {
  process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/cms_test";
  process.env.BETTER_AUTH_SECRET ??= "0123456789abcdef0123456789abcdef0123456789";
  process.env.CMS_STUDIO_URL ??= "http://localhost:3000";

  ({ GET } = (await import("../[job]/route")) as { GET: Handler });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

function call(job: string, authorization?: string): Promise<Response> {
  return GET(
    new Request(`http://localhost:3000/api/cron/${job}`, {
      headers: authorization ? { authorization } : {},
    }),
    { params: Promise.resolve({ job }) },
  );
}

describe("cron authorization", () => {
  it("accepts the configured secret", async () => {
    process.env.CRON_SECRET = SECRET;

    // Asserted against a stub job: it proves the request got past the guard
    // without needing a database behind it.
    const response = await call("retention-gc", `Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      job: "retention-gc",
      status: "not_implemented",
    });
  });

  it("refuses a wrong secret with a bare 401", async () => {
    process.env.CRON_SECRET = SECRET;

    const response = await call("publish-scheduled", "Bearer not-the-secret");

    expect(response.status).toBe(401);
    // No hint about which part was wrong, and nothing echoed back.
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });

  it("refuses a secret of a different length without leaking that it differs", async () => {
    process.env.CRON_SECRET = SECRET;

    // Both sides are hashed before the constant-time compare, so a length
    // mismatch is a plain 401 rather than a thrown RangeError.
    const response = await call("publish-scheduled", "Bearer x");

    expect(response.status).toBe(401);
  });

  it("refuses when CRON_SECRET is unset, rather than defaulting to open", async () => {
    delete process.env.CRON_SECRET;

    // Every plausible caller, including one that guessed an empty secret.
    for (const header of [undefined, "Bearer ", "Bearer anything", "Basic anything"]) {
      const response = await call("publish-scheduled", header);
      expect(response.status, `header: ${String(header)}`).toBe(401);
    }
  });

  it("refuses a request with no Authorization header at all", async () => {
    process.env.CRON_SECRET = SECRET;

    const response = await call("publish-scheduled");
    expect(response.status).toBe(401);
  });

  it("refuses the right secret under the wrong scheme", async () => {
    process.env.CRON_SECRET = SECRET;

    const response = await call("publish-scheduled", SECRET);
    expect(response.status).toBe(401);
  });
});

describe("the job table", () => {
  it("answers every job named in the deploy document, including the unbuilt ones", async () => {
    process.env.CRON_SECRET = SECRET;

    /**
     * 2xx on purpose for the stubs. `infra/DEPLOY.md` schedules these tonight
     * whether or not they exist, and a task that fails every night is an alert
     * nobody reads by the third night — including on the night one of the real
     * ones fails.
     */
    for (const job of ["crawler-rollup", "render-backfill", "link-suggestions", "retention-gc"]) {
      const response = await call(job, `Bearer ${SECRET}`);
      expect(response.status, job).toBe(200);
      expect((await response.json()).status, job).toBe("not_implemented");
    }
  });

  it("404s a job name that is not in the table, because that is a typo worth fixing", async () => {
    process.env.CRON_SECRET = SECRET;

    const response = await call("publsh-scheduled", `Bearer ${SECRET}`);
    expect(response.status).toBe(404);
    expect((await response.json()).jobs).toContain("publish-scheduled");
  });

  it("does not reveal which job names exist to an unauthenticated caller", async () => {
    process.env.CRON_SECRET = SECRET;

    const response = await call("publsh-scheduled", "Bearer wrong");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
  });
});
