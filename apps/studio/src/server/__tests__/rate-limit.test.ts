import { afterEach, describe, expect, it } from "vitest";
import {
  RULES,
  clientIp,
  rateLimit,
  rateLimitedResponse,
  resetRateLimits,
  type RateLimitRule,
} from "../rate-limit";

const rule: RateLimitRule = { name: "test", limit: 3, windowMs: 1000 };

afterEach(() => {
  resetRateLimits();
  delete process.env.CMS_RATE_LIMIT;
});

describe("rateLimit", () => {
  it("allows up to the limit and then refuses within the window", () => {
    expect(rateLimit(rule, "a", 0).allowed).toBe(true);
    expect(rateLimit(rule, "a", 10).allowed).toBe(true);
    expect(rateLimit(rule, "a", 20).allowed).toBe(true);
    const refused = rateLimit(rule, "a", 30);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBe(1);
  });

  it("keys buckets independently", () => {
    for (let i = 0; i < 3; i++) rateLimit(rule, "a", 0);
    expect(rateLimit(rule, "a", 0).allowed).toBe(false);
    expect(rateLimit(rule, "b", 0).allowed).toBe(true);
    expect(rateLimit({ ...rule, name: "other" }, "a", 0).allowed).toBe(true);
  });

  it("resets when the window elapses", () => {
    for (let i = 0; i < 4; i++) rateLimit(rule, "a", 0);
    expect(rateLimit(rule, "a", 999).allowed).toBe(false);
    expect(rateLimit(rule, "a", 1000).allowed).toBe(true);
  });

  it("reports remaining budget on the way down", () => {
    expect(rateLimit(rule, "a", 0).remaining).toBe(2);
    expect(rateLimit(rule, "a", 0).remaining).toBe(1);
    expect(rateLimit(rule, "a", 0).remaining).toBe(0);
  });

  it("is off only when CMS_RATE_LIMIT is explicitly 'off'", () => {
    process.env.CMS_RATE_LIMIT = "off";
    for (let i = 0; i < 10; i++) expect(rateLimit(rule, "a", 0).allowed).toBe(true);
    process.env.CMS_RATE_LIMIT = "false";
    resetRateLimits();
    for (let i = 0; i < 3; i++) rateLimit(rule, "a", 0);
    expect(rateLimit(rule, "a", 0).allowed).toBe(false);
  });

  it("has budgets for every metered surface", () => {
    for (const r of Object.values(RULES)) {
      expect(r.limit).toBeGreaterThan(0);
      expect(r.windowMs).toBeGreaterThan(0);
    }
    expect(RULES.analyticsWrite.limit).toBeLessThan(RULES.v1Write.limit);
    expect(RULES.v1Write.limit).toBeLessThan(RULES.v1Read.limit);
  });
});

describe("rateLimitedResponse", () => {
  it("answers 429 with Retry-After and the RateLimit headers", async () => {
    const decision = { allowed: false, limit: 3, remaining: 0, retryAfterSeconds: 7 };
    const response = rateLimitedResponse(decision, rule);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("7");
    expect(response.headers.get("ratelimit-limit")).toBe("3");
    expect(response.headers.get("ratelimit-remaining")).toBe("0");
    expect(response.headers.get("ratelimit-policy")).toBe("3;w=1");
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://x", { headers });

  it("takes the first forwarded address", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
  });

  it("reads the configured header", () => {
    expect(clientIp(req({ "cf-connecting-ip": "198.51.100.4", "x-forwarded-for": "1.1.1.1" }), "cf-connecting-ip")).toBe(
      "198.51.100.4",
    );
  });

  it("falls back to a shared bucket when nothing usable is present", () => {
    expect(clientIp(req({}))).toBe("unknown");
    expect(clientIp(req({ "x-forwarded-for": "" }))).toBe("unknown");
    expect(clientIp(req({ "x-forwarded-for": "x".repeat(100) }))).toBe("unknown");
  });
});
