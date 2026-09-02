import type { JsonLdObject } from "../types";

/** Every top-level node carries this; embedded nodes must not repeat it. */
export const SCHEMA_CONTEXT = "https://schema.org";

/**
 * Drops keys whose value is absent or empty.
 *
 * Builders are written as one object literal with every possible property, so
 * the shape of the output is readable in one glance. That only works if the
 * properties a given document has nothing to say about disappear rather than
 * serialising as `null` — a JSON-LD node with `"author": null` is worse than
 * one without an author, because validators read it as a stated absence.
 */
export function prune(node: JsonLdObject): JsonLdObject {
  const out: JsonLdObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

/** `undefined` rather than an empty array, so `prune` can remove the property. */
export function listOrUndefined<T>(items: T[] | null | undefined): T[] | undefined {
  return items && items.length > 0 ? items : undefined;
}
