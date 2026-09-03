import { describe, expect, it } from "vitest";
import { generateApiKey, hashApiKey, keyTypeOf, originAllowed, type VerifiedKey } from "../api-keys";

const base: VerifiedKey = {
  id: "k",
  siteId: "s",
  type: "publishable",
  role: "author",
  scopes: ["content:read"],
  allowedOrigins: ["https://blog.example"],
  publishedOnly: true,
};

describe("generateApiKey", () => {
  it("issues a prefixed 256-bit secret, stored only as a digest", () => {
    const key = generateApiKey("read");
    expect(key.plaintext).toMatch(/^cms_sk_[A-Za-z0-9_-]{43}$/);
    expect(key.keyHash).toBe(hashApiKey(key.plaintext));
    expect(key.keyPrefix).toBe(key.plaintext.slice(0, 13));
    expect(keyTypeOf(key.plaintext)).toBe("read");
    expect(keyTypeOf("nope")).toBeNull();
  });
});

describe("originAllowed", () => {
  it("refuses every non-publishable key from any origin", () => {
    for (const type of ["read", "admin"] as const) {
      expect(originAllowed({ ...base, type, allowedOrigins: [] }, "https://blog.example")).toBe(false);
      expect(originAllowed({ ...base, type, allowedOrigins: ["https://blog.example"] }, "https://blog.example")).toBe(false);
    }
  });

  it("treats an empty allow-list as a refusal, never as a wildcard", () => {
    expect(originAllowed({ ...base, allowedOrigins: [] }, "https://blog.example")).toBe(false);
    expect(originAllowed({ ...base, allowedOrigins: [] }, null)).toBe(false);
  });

  it("matches on origin, tolerating a path or trailing slash in the stored value", () => {
    expect(originAllowed(base, "https://blog.example")).toBe(true);
    expect(originAllowed({ ...base, allowedOrigins: ["https://blog.example/"] }, "https://blog.example")).toBe(true);
    expect(originAllowed({ ...base, allowedOrigins: ["https://blog.example/blog"] }, "https://blog.example")).toBe(true);
    expect(originAllowed(base, "https://blog.example.evil")).toBe(false);
    expect(originAllowed(base, "http://blog.example")).toBe(false);
    expect(originAllowed(base, "https://sub.blog.example")).toBe(false);
    expect(originAllowed(base, null)).toBe(false);
  });
});
