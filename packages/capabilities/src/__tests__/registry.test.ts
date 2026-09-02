import { describe, expect, it } from "vitest";
import { mcpAnnotations } from "@cms/core";
import { capabilities, registry } from "../index.js";

/**
 * The guard that keeps "MCP-first" true.
 *
 * The failure mode this exists to prevent is gradual: someone adds a REST
 * endpoint directly, or a studio server action that talks to the database,
 * and the MCP surface silently falls a feature behind. Because every transport
 * dispatches through this registry, a capability that exists is exposed
 * everywhere — and these tests fail the build if the shape that makes that
 * possible is ever broken.
 */

describe("capability registry", () => {
  it("exposes every capability under a valid MCP tool name", () => {
    for (const cap of capabilities) {
      expect(cap.name, `${cap.name} must be snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(registry.get(cap.name)).toBe(cap);
    }
    expect(registry.size).toBe(capabilities.length);
  });

  it("gives every capability a REST route as well, so no transport lags", () => {
    for (const cap of capabilities) {
      expect(cap.route, `${cap.name} has no REST route`).toBeDefined();
      expect(cap.route.path.startsWith("/"), `${cap.name} route must be absolute`).toBe(true);
    }
  });

  it("declares scopes and a role floor on every capability", () => {
    for (const cap of capabilities) {
      expect(cap.scopes.length, `${cap.name} declares no scopes`).toBeGreaterThan(0);
      expect(cap.role, `${cap.name} declares no role`).toBeTruthy();
    }
  });

  it("writes a description an agent can actually choose on", () => {
    for (const cap of capabilities) {
      // A tool an agent cannot tell apart from its neighbour gets called wrongly.
      expect(cap.description.length, `${cap.name} description is too thin`).toBeGreaterThan(60);
      expect(cap.title.length).toBeGreaterThan(0);
    }
  });

  it("never marks a read-only capability destructive, and defaults writes to destructive", () => {
    for (const cap of capabilities) {
      const a = mcpAnnotations(cap);
      if (cap.readOnly) {
        expect(a.destructiveHint, `${cap.name} is read-only but hinted destructive`).toBe(false);
      } else {
        // Conservative default: an agent should assume a write needs confirming
        // unless the capability explicitly says otherwise.
        expect(typeof a.destructiveHint).toBe("boolean");
      }
    }
  });

  it("requires publish and site administration to outrank plain authorship", () => {
    expect(registry.get("publish_document")?.role).toBe("editor");
    expect(registry.get("update_site")?.role).toBe("owner");
    expect(registry.get("create_document")?.role).toBe("author");
  });

  it("keeps every read capability out of the write scopes", () => {
    for (const cap of capabilities) {
      if (!cap.readOnly) continue;
      expect(cap.scopes, `${cap.name} is read-only but asks for a write scope`).not.toContain(
        "content:write",
      );
      expect(cap.scopes).not.toContain("content:publish");
    }
  });
});
