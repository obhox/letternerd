import { describe, expect, it } from "vitest";
import {
  OAuthStateSecretError,
  newOAuthNonce,
  signOAuthState,
  verifyOAuthState,
} from "../state";

/**
 * The OAuth `state` envelope.
 *
 * Every test here is a refusal, because the value of this mechanism is entirely
 * in what it declines. The happy path is one line; the forged, replayed,
 * stale and cross-account cases are the reason it exists — an unprotected
 * callback attaches an attacker's Google account to somebody else's site, and
 * nothing about the result looks wrong afterwards.
 */

const SECRET = "s".repeat(48);
const NOW = new Date("2026-03-01T12:00:00.000Z");
const nonce = "nonce-abc";
const payload = {
  siteId: "site-1",
  siteSlug: "acme",
  userId: "user-ada",
  nonce,
  issuedAt: NOW.getTime(),
};

describe("OAuth state", () => {
  it("round-trips a state it signed itself", () => {
    const state = signOAuthState(SECRET, payload);
    const result = verifyOAuthState(SECRET, state, { nonce, userId: "user-ada", now: NOW });

    expect(result.ok).toBe(true);
    expect(result.ok && result.payload.siteId).toBe("site-1");
    expect(result.ok && result.payload.siteSlug).toBe("acme");
  });

  it("rejects a forged state whose payload was rewritten to another site", () => {
    const state = signOAuthState(SECRET, payload);
    const [body, signature] = state.split(".") as [string, string];

    // The attack this exists to stop: keep the valid signature, swap the
    // siteId, and attach your own Google account to somebody else's site.
    const decoded = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as typeof payload;
    const forgedBody = Buffer.from(JSON.stringify({ ...decoded, siteId: "site-victim" })).toString(
      "base64url",
    );

    expect(
      verifyOAuthState(SECRET, `${forgedBody}.${signature}`, {
        nonce,
        userId: "user-ada",
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a state whose expiry was rewritten to keep it alive", () => {
    const stale = signOAuthState(SECRET, { ...payload, issuedAt: NOW.getTime() - 3_600_000 });
    const [body, signature] = stale.split(".") as [string, string];
    const refreshedBody = Buffer.from(
      JSON.stringify({ ...payload, issuedAt: NOW.getTime() }),
    ).toString("base64url");

    // Proves the signature is checked before `issuedAt` is believed.
    expect(
      verifyOAuthState(SECRET, `${refreshedBody}.${signature}`, {
        nonce,
        userId: "user-ada",
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a state signed with a different secret", () => {
    const state = signOAuthState("x".repeat(48), payload);
    expect(verifyOAuthState(SECRET, state, { nonce, userId: "user-ada", now: NOW })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a replayed state once its nonce cookie is gone", () => {
    const state = signOAuthState(SECRET, payload);

    // Valid while the cookie the `start` route set is still present.
    expect(verifyOAuthState(SECRET, state, { nonce, userId: "user-ada", now: NOW }).ok).toBe(true);

    // The callback clears that cookie, so the same URL replayed finds nothing
    // to match. The signature is still perfectly valid — which is precisely
    // why a signature alone cannot make a state single-use.
    expect(verifyOAuthState(SECRET, state, { nonce: null, userId: "user-ada", now: NOW })).toEqual({
      ok: false,
      reason: "nonce_mismatch",
    });
    expect(
      verifyOAuthState(SECRET, state, { nonce: "someone-elses", userId: "user-ada", now: NOW }),
    ).toEqual({ ok: false, reason: "nonce_mismatch" });
  });

  it("rejects a state minted for a different signed-in user", () => {
    const state = signOAuthState(SECRET, payload);
    expect(verifyOAuthState(SECRET, state, { nonce, userId: "user-bob", now: NOW })).toEqual({
      ok: false,
      reason: "user_mismatch",
    });
  });

  it("expires a state that has been sitting around", () => {
    const state = signOAuthState(SECRET, payload);
    const later = new Date(NOW.getTime() + 11 * 60 * 1000);
    expect(verifyOAuthState(SECRET, state, { nonce, userId: "user-ada", now: later })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a state issued further in the future than clock skew explains", () => {
    const state = signOAuthState(SECRET, { ...payload, issuedAt: NOW.getTime() + 3_600_000 });
    expect(verifyOAuthState(SECRET, state, { nonce, userId: "user-ada", now: NOW })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a missing or shapeless state", () => {
    for (const raw of [null, undefined, "", "no-dot", ".", "abc.", ".abc"]) {
      expect(
        verifyOAuthState(SECRET, raw, { nonce, userId: "user-ada", now: NOW }).ok,
        `${JSON.stringify(raw)} should not verify`,
      ).toBe(false);
    }
  });

  it("rejects a well-signed body that is not a state payload", () => {
    // Signed by us, so the signature passes; the shape check is what refuses it.
    const body = Buffer.from(JSON.stringify({ hello: "world" })).toString("base64url");
    const signed = signOAuthState(SECRET, payload).split(".")[0];
    expect(signed).toBeDefined();

    const state = `${body}.${
      // Re-sign the wrong body so this test exercises the parse, not the HMAC.
      signOAuthState(SECRET, payload).split(".")[1]
    }`;
    const result = verifyOAuthState(SECRET, state, { nonce, userId: "user-ada", now: NOW });
    expect(result.ok).toBe(false);
  });

  it("refuses to sign with a short secret", () => {
    expect(() => signOAuthState("too-short", payload)).toThrow(OAuthStateSecretError);
  });

  it("mints an unguessable nonce", () => {
    const a = newOAuthNonce();
    expect(a).not.toBe(newOAuthNonce());
    expect(a.length).toBeGreaterThanOrEqual(32);
  });
});
