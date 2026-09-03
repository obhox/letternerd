import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `env.ts` parses at import, so each case builds an environment, resets the
 * module registry and imports fresh. `NODE_ENV` is what switches the secret
 * strength rule on; vitest sets it to `test`, which counts as development.
 */

const BASE = {
  DATABASE_URL: "postgres://u:p@localhost:5432/x",
  BETTER_AUTH_SECRET: "k9Q2mV7xR4tB8nL1pW6cZ3yH0sJ5dF2aG7eN4uT1",
  CMS_STUDIO_URL: "http://localhost:3000",
};

const ORIGINAL = { ...process.env };

async function load(overrides: Record<string, string | undefined>, nodeEnv = "test") {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ORIGINAL, BASE, overrides);
  // vitest freezes NODE_ENV as a const in some builds; assign defensively.
  (process.env as Record<string, string>).NODE_ENV = nodeEnv;
  vi.resetModules();
  return import("../env");
}

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, ORIGINAL);
  vi.resetModules();
});

describe("secret strength", () => {
  it("accepts the .env.example placeholders outside production", async () => {
    const { env } = await load({ CRON_SECRET: "dev-cron-secret" });
    expect(env.CRON_SECRET).toBe("dev-cron-secret");
  });

  it("refuses the .env.example CRON_SECRET in production, naming the variable", async () => {
    await expect(load({ CRON_SECRET: "dev-cron-secret" }, "production")).rejects.toThrow(/CRON_SECRET/);
  });

  it("refuses the example BETTER_AUTH_SECRET in production even though it is long", async () => {
    await expect(
      load({ BETTER_AUTH_SECRET: "dev-only-secret-replace-me-with-openssl-rand-base64-48" }, "production"),
    ).rejects.toThrow(/BETTER_AUTH_SECRET/);
  });

  it("refuses a short or monotonous production secret", async () => {
    await expect(load({ ANALYTICS_ENCRYPTION_KEY: "short" }, "production")).rejects.toThrow(/ANALYTICS_ENCRYPTION_KEY/);
    await expect(load({ CRON_SECRET: "a".repeat(40) }, "production")).rejects.toThrow(/CRON_SECRET/);
  });

  it("accepts generated secrets in production", async () => {
    const { env } = await load(
      { CRON_SECRET: "3f9a1c7e5b2d8f0a4c6e9b1d3f5a7c9e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a" },
      "production",
    );
    expect(env.CRON_SECRET).toHaveLength(64);
  });
});

describe("cronSecret()", () => {
  it("treats a weak production value as unset, so the endpoint refuses rather than accepts", async () => {
    // Boot with a good value, then simulate the environment being edited.
    const good = "3f9a1c7e5b2d8f0a4c6e9b1d3f5a7c9e2b4d6f8a0c1e3b5d7f9a2c4e6b8d0f1a";
    const { cronSecret } = await load({ CRON_SECRET: good }, "production");
    expect(cronSecret()).toBe(good);
    process.env.CRON_SECRET = "dev-cron-secret";
    expect(cronSecret()).toBeNull();
    delete process.env.CRON_SECRET;
    expect(cronSecret()).toBeNull();
  });
});

describe("policy defaults", () => {
  it("opens sign-up in development and closes it in production", async () => {
    expect((await load({})).env.CMS_ALLOW_SIGNUP).toBe(true);
    expect((await load({}, "production")).env.CMS_ALLOW_SIGNUP).toBe(false);
    expect((await load({ CMS_ALLOW_SIGNUP: "true" }, "production")).env.CMS_ALLOW_SIGNUP).toBe(true);
    expect((await load({ CMS_ALLOW_SIGNUP: "off" })).env.CMS_ALLOW_SIGNUP).toBe(false);
  });

  it("requires a second factor for owners in production unless told otherwise", async () => {
    expect((await load({})).env.CMS_REQUIRE_2FA_ROLE).toBeNull();
    expect((await load({}, "production")).env.CMS_REQUIRE_2FA_ROLE).toBe("owner");
    expect((await load({ CMS_REQUIRE_2FA_ROLE: "none" }, "production")).env.CMS_REQUIRE_2FA_ROLE).toBeNull();
    expect((await load({ CMS_REQUIRE_2FA_ROLE: "editor" })).env.CMS_REQUIRE_2FA_ROLE).toBe("editor");
    await expect(load({ CMS_REQUIRE_2FA_ROLE: "admin" })).rejects.toThrow(/CMS_REQUIRE_2FA_ROLE/);
  });

  it("normalises the client IP header and rejects a value that is not a header name", async () => {
    expect((await load({})).env.CMS_CLIENT_IP_HEADER).toBe("x-forwarded-for");
    expect((await load({ CMS_CLIENT_IP_HEADER: "CF-Connecting-IP" })).env.CMS_CLIENT_IP_HEADER).toBe("cf-connecting-ip");
    await expect(load({ CMS_CLIENT_IP_HEADER: "x forwarded" })).rejects.toThrow(/CMS_CLIENT_IP_HEADER/);
  });
});
