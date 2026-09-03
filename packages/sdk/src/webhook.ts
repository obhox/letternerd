import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signature verification for the revalidation webhook.
 *
 * An unauthenticated revalidation endpoint is a denial-of-service primitive
 * with a public URL: anyone who finds it can purge a site's entire ISR cache in
 * a loop and put every request onto the origin. So the endpoint verifies an
 * HMAC-SHA256 the CMS computed with a shared secret, and it does it over the
 * *raw* body — `JSON.parse` followed by `JSON.stringify` is not the same bytes
 * (key order, whitespace, number formatting), and a signature checked against
 * re-serialised JSON is a signature that rejects valid requests and, worse, can
 * be made to accept modified ones.
 *
 * The timestamp is signed alongside the body and checked against a window,
 * because a signature alone is replayable forever: an attacker who captures one
 * valid request can repeat it indefinitely, which is the same purge loop with
 * extra steps.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

export interface VerifyOptions {
  secret: string;
  /** The bytes as received. Never a re-serialisation of the parsed body. */
  rawBody: string;
  /** `t=<unix-seconds>,v1=<hex>`, or a bare `sha256=<hex>` with `timestamp`. */
  signatureHeader: string | null;
  timestampHeader?: string | null;
  toleranceSeconds?: number;
  /** Injected so the window is testable without waiting five minutes. */
  now?: () => number;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: "missing" | "malformed" | "stale" | "mismatch" };

/** The value the CMS sends, and what the tests sign with. */
export function signWebhookPayload(
  secret: string,
  rawBody: string,
  timestampSeconds: number,
): string {
  return `t=${timestampSeconds},v1=${hmacHex(secret, `${timestampSeconds}.${rawBody}`)}`;
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function parseHeader(
  signatureHeader: string,
  timestampHeader: string | null | undefined,
): { timestamp: number; signature: string } | null {
  if (signatureHeader.includes("t=")) {
    let timestamp: number | null = null;
    let signature: string | null = null;
    for (const part of signatureHeader.split(",")) {
      const [name, value] = part.trim().split("=", 2);
      if (name === "t" && value) timestamp = Number(value);
      if ((name === "v1" || name === "sha256") && value) signature = value;
    }
    if (timestamp === null || !Number.isFinite(timestamp) || !signature) return null;
    return { timestamp, signature };
  }

  const signature = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  const timestamp = Number(timestampHeader);
  if (!signature || !timestampHeader || !Number.isFinite(timestamp)) return null;
  return { timestamp, signature };
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on a length mismatch rather than returning false, so
 * the length is checked first — and because both operands are hex SHA-256, a
 * length difference means the header was malformed rather than merely wrong,
 * which leaks nothing an attacker could not determine by counting characters.
 *
 * Both sides are lower-cased first. Hex is case-insensitive and a proxy or a
 * hand-rolled sender may well upper-case it; `toLowerCase` on a fixed-length
 * string reveals nothing about the value, so the comparison stays timing-safe.
 */
function digestsMatch(expected: string, presented: string): boolean {
  const a = expected.toLowerCase();
  const b = presented.toLowerCase();
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export function verifyWebhookSignature(options: VerifyOptions): VerifyResult {
  const {
    secret,
    rawBody,
    signatureHeader,
    timestampHeader = null,
    toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
    now = Date.now,
  } = options;

  if (!signatureHeader) return { ok: false, reason: "missing" };

  const parsed = parseHeader(signatureHeader, timestampHeader);
  if (!parsed) return { ok: false, reason: "malformed" };

  // Both directions. A clock ahead of ours is as much a red flag as one behind,
  // and a far-future timestamp would otherwise be replayable until it arrives.
  const skew = Math.abs(Math.floor(now() / 1000) - parsed.timestamp);
  if (skew > toleranceSeconds) return { ok: false, reason: "stale" };

  const expected = hmacHex(secret, `${parsed.timestamp}.${rawBody}`);
  return digestsMatch(expected, parsed.signature) ? { ok: true } : { ok: false, reason: "mismatch" };
}
