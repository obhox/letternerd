import { describe, expect, it } from "vitest";
import { signWebhookPayload, verifyWebhookSignature } from "../webhook";

/**
 * The webhook is a public URL that purges caches, so these tests are about the
 * four ways someone gets in without the secret: no signature, a guessed one, a
 * replayed one, and a valid one over modified bytes.
 */

const SECRET = "whsec_test";
const BODY = JSON.stringify({ event: "document.published", slug: "cash-flow-basics" });
const NOW_MS = 1_800_000_000_000;
const NOW_SECONDS = Math.floor(NOW_MS / 1000);
const now = () => NOW_MS;

describe("verifyWebhookSignature", () => {
  it("accepts a correctly signed request", () => {
    const header = signWebhookPayload(SECRET, BODY, NOW_SECONDS);

    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: BODY, signatureHeader: header, now }),
    ).toEqual({ ok: true });
  });

  it("rejects a request with no signature at all", () => {
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: BODY, signatureHeader: null, now }),
    ).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a signature made with a different secret", () => {
    const header = signWebhookPayload("whsec_wrong", BODY, NOW_SECONDS);

    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: BODY, signatureHeader: header, now }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a body modified after signing", () => {
    const header = signWebhookPayload(SECRET, BODY, NOW_SECONDS);
    const tampered = JSON.stringify({ event: "document.published", slug: "../../../etc" });

    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: tampered, signatureHeader: header, now }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a captured request replayed after the window", () => {
    const header = signWebhookPayload(SECRET, BODY, NOW_SECONDS - 3600);

    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: BODY, signatureHeader: header, now }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a timestamp far in the future as firmly as one in the past", () => {
    const header = signWebhookPayload(SECRET, BODY, NOW_SECONDS + 3600);

    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: BODY, signatureHeader: header, now }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts clock skew inside the tolerance", () => {
    const header = signWebhookPayload(SECRET, BODY, NOW_SECONDS - 120);

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        rawBody: BODY,
        signatureHeader: header,
        toleranceSeconds: 300,
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects a signature that is not the shape of a signature", () => {
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        rawBody: BODY,
        signatureHeader: "t=,v1=",
        now,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a truncated digest without throwing on the length mismatch", () => {
    const header = signWebhookPayload(SECRET, BODY, NOW_SECONDS).slice(0, -10);

    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: BODY, signatureHeader: header, now }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("accepts the split-header form: `sha256=…` plus a timestamp header", () => {
    const combined = signWebhookPayload(SECRET, BODY, NOW_SECONDS);
    const digest = combined.split("v1=")[1] ?? "";

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        rawBody: BODY,
        signatureHeader: `sha256=${digest}`,
        timestampHeader: String(NOW_SECONDS),
        now,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects the split-header form when the timestamp is missing", () => {
    const combined = signWebhookPayload(SECRET, BODY, NOW_SECONDS);
    const digest = combined.split("v1=")[1] ?? "";

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        rawBody: BODY,
        signatureHeader: `sha256=${digest}`,
        timestampHeader: null,
        now,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("accepts a digest that arrived upper-cased", () => {
    // Hex is case-insensitive, and a proxy or a hand-rolled sender may well
    // upper-case it. Rejecting `ABCDEF` for `abcdef` would be a false mismatch.
    const upperHex = (header: string) =>
      header.replace(/v1=([0-9a-f]+)/, (_, hex: string) => `v1=${hex.toUpperCase()}`);
    const header = upperHex(signWebhookPayload(SECRET, BODY, NOW_SECONDS));

    expect(header).toMatch(/v1=[0-9A-F]{64}$/);
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: BODY, signatureHeader: header, now }),
    ).toEqual({ ok: true });

    // Case-folding is not leniency: a wrong digest in upper case is still wrong.
    const wrong = upperHex(signWebhookPayload("whsec_wrong", BODY, NOW_SECONDS));
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: BODY, signatureHeader: wrong, now }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });

  it("verifies the raw bytes, not a re-serialisation of them", () => {
    // The same object, sent with the whitespace the CMS's serialiser produced.
    // A verifier that parsed and re-stringified would compare a different
    // string than the one that was signed, and reject a valid request.
    const signedBytes = '{ "slug": "a", "event": "document.published" }';
    const reserialised = JSON.stringify(JSON.parse(signedBytes));
    const header = signWebhookPayload(SECRET, signedBytes, NOW_SECONDS);

    expect(signedBytes).not.toBe(reserialised);
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: signedBytes, signatureHeader: header, now }),
    ).toEqual({ ok: true });
    expect(
      verifyWebhookSignature({ secret: SECRET, rawBody: reserialised, signatureHeader: header, now }),
    ).toEqual({ ok: false, reason: "mismatch" });
  });
});
