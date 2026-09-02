/**
 * The cache key for a rendered document.
 *
 * `PIPELINE_VERSION` is inside the hash rather than beside it so that a change
 * to the pipeline invalidates every cached render by construction. Stored
 * separately, the backfill would depend on somebody remembering to compare
 * both, and the failure mode is a site serving a mix of old and new markup with
 * no signal that anything is wrong.
 */

import { createHash } from "node:crypto";
import { PIPELINE_VERSION } from "./types.js";

/**
 * NUL, which a markdown body will not contain.
 *
 * A printable separator would let a document whose body began with the right
 * characters hash identically to the same content at a different version.
 */
const SEPARATOR = "\u0000";

export function contentHash(markdown: string): string {
  return createHash("sha256")
    .update(`${PIPELINE_VERSION}${SEPARATOR}${markdown}`, "utf8")
    .digest("hex");
}
