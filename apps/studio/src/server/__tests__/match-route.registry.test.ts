import { describe, expect, it } from "vitest";
import { registry } from "@cms/capabilities";
import { matchRoute } from "../rest";

/**
 * The same matcher, against the registry the app actually ships.
 *
 * The compiled table is built at import from `registry.values()`, so a change
 * to the registry's shape — a capability that stops declaring `route`, a path
 * written without its leading slash — would not throw. It would produce a
 * table that matches nothing, and every REST request would 404. Resolving a
 * handful of real routes is what makes that loud.
 */
describe("matchRoute against the shipped registry", () => {
  it.each([
    ["GET", ["documents"], "search_content"],
    ["POST", ["documents"], "create_document"],
  ] as const)("resolves %s /%s", (method, path, expected) => {
    expect(matchRoute(method, [...path])?.capability.name).toBe(expected);
  });

  it("resolves every registered route to the capability that declared it", () => {
    // Exhaustive rather than a sample: this is cheap, and it is the check that
    // catches a *new* capability whose path collides with an existing one —
    // the pair would both be reachable in the registry and only one reachable
    // over HTTP, which no per-capability test would notice.
    for (const capability of registry.values()) {
      const segments = capability.route.path.split("/").filter(Boolean);
      // Substitute a value for each parameter so the concrete path is one a
      // client could actually send.
      const concrete = segments.map((segment) =>
        segment.startsWith(":") ? "01hqzsamplevalue" : segment,
      );

      const matched = matchRoute(capability.route.method, concrete);
      expect(matched, `no route matched ${capability.route.method} ${capability.route.path}`).not.toBeNull();
      expect(matched?.capability.name, `${capability.route.method} ${capability.route.path}`).toBe(
        capability.name,
      );
    }
  });

  it("has at least one route to resolve", () => {
    // Guards the loop above: an empty registry would make it vacuously true.
    expect(registry.size).toBeGreaterThan(10);
  });
});
