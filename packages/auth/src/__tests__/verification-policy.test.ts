import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "../index.js";

/**
 * The boot-time half of the invitation escalation.
 *
 * `acceptInvitation` refuses an unverified account, but that check only helps
 * if accounts can become verified at all. An install that requires
 * verification and has no way to send it would lock every new user out, and
 * the tempting fix — quietly not requiring it — is the fail-open default this
 * package exists to avoid. So the combination is refused at construction.
 */

const baseConfig = {
  baseURL: "http://localhost:3000",
  connectionString: "postgres://localhost:5432/cms",
  secret: "test-secret-value-long-enough-to-be-plausible",
  trustedOrigins: ["http://localhost:3000"],
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verification policy", () => {
  it("refuses to start when verification is required and nothing can send it", () => {
    expect(() => createAuth({ ...baseConfig, requireEmailVerification: true })).toThrow(
      /sendVerificationEmail/,
    );
  });

  it("requires verification by default in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => createAuth({ ...baseConfig })).toThrow(/sendVerificationEmail/);
  });

  it("accepts an explicit opt-out, so an operator can choose it in so many words", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() =>
      createAuth({ ...baseConfig, requireEmailVerification: false }),
    ).not.toThrow();
  });

  it("does not require verification outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(() => createAuth({ ...baseConfig })).not.toThrow();
  });
});
