import { describe, expect, it } from "vitest";
import { createLogger, isSensitiveKey, redactForLog } from "../logger";

function capture(level: "debug" | "info" | "warn" | "error" = "info") {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger("t", {
    level,
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
  return { logger, lines };
}

describe("redaction", () => {
  it.each([
    ["authorization", true],
    ["Authorization", true],
    ["api_key", true],
    ["apiKey", true],
    ["keyPrefix", true],
    ["refreshToken", true],
    ["client_secret", true],
    ["DATABASE_URL", true],
    ["password", true],
    ["monkey", false],
    ["siteId", false],
    ["message", false],
  ])("%s → sensitive=%s", (key, expected) => {
    expect(isSensitiveKey(key)).toBe(expected);
  });

  it("masks nested credentials and keeps everything else", () => {
    const out = redactForLog({
      siteId: "s1",
      headers: { authorization: "Bearer x", accept: "json" },
      list: [{ token: "t" }],
    }) as Record<string, unknown>;
    expect(out).toEqual({
      siteId: "s1",
      headers: { authorization: "<redacted>", accept: "json" },
      list: [{ token: "<redacted>" }],
    });
  });

  it("serialises errors without a stack unless debugging", () => {
    const err = new Error("boom");
    expect(redactForLog(err, "info")).toEqual({ name: "Error", message: "boom" });
    expect(redactForLog(err, "debug")).toHaveProperty("stack");
  });

  it("survives cycles and truncates long strings", () => {
    const a: Record<string, unknown> = { s: "x".repeat(5000) };
    a.self = a;
    const out = redactForLog(a) as Record<string, unknown>;
    expect(out.self).toBe("<cycle>");
    expect(String(out.s)).toContain("<5000 chars>");
  });
});

describe("logger", () => {
  it("emits one JSON line at or above the configured level", () => {
    const { logger, lines } = capture("warn");
    logger.info("hidden");
    logger.warn("shown", { code: "abc", n: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "warn", logger: "t", message: "shown", code: "<redacted>", n: 1 });
  });

  it("names children hierarchically", () => {
    const { logger, lines } = capture();
    logger.child("cron").error("x");
    expect(lines[0]?.logger).toBe("t.cron");
  });
});
