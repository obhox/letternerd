import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AnyCapability } from "@cms/core";
import { coerceQuery } from "../rest";

/** Only `input` is read, so a whole capability is more than this needs. */
function withInput(input: z.ZodTypeAny): AnyCapability {
  return { input } as unknown as AnyCapability;
}

/**
 * `coerceQuery` sits between "HTTP has no types" and "the domain does".
 *
 * Two failure modes matter and they pull in opposite directions. Coerce too
 * little and `?limit=20` fails a `z.number()` with a 422 telling the caller
 * their correct request was invalid. Coerce too much and a value the schema
 * was going to reject with a useful message arrives as something else
 * entirely — or, worse, a string field silently becomes a number.
 */
describe("coerceQuery", () => {
  describe("numbers", () => {
    const capability = withInput(z.object({ limit: z.number(), q: z.string() }));

    it("converts a numeric string for a field the schema types as a number", () => {
      expect(coerceQuery(capability, { limit: "20" })).toEqual({ limit: 20 });
    });

    it("leaves a string field alone even when its value looks numeric", () => {
      // A search for "2024" is a search for a string. Converting it here would
      // hand the schema a number and produce a type error on valid input.
      expect(coerceQuery(capability, { q: "2024" })).toEqual({ q: "2024" });
    });

    it.each([
      ["a word", "twenty"],
      ["a partial number", "20abc"],
      ["an empty value", ""],
      ["whitespace", "   "],
      ["a non-finite word", "Infinity"],
    ])("passes %s through untouched so the schema produces the error", (_label, raw) => {
      // Deliberately not turned into NaN or 0: the caller should be told
      // "expected number, received string", which is actionable, rather than
      // "expected number, received nan", which is this function's fault.
      expect(coerceQuery(capability, { limit: raw })).toEqual({ limit: raw });
    });

    it("converts negative and fractional values, which are the schema's business to refuse", () => {
      expect(coerceQuery(capability, { limit: "-5" })).toEqual({ limit: -5 });
      expect(coerceQuery(capability, { limit: "1.5" })).toEqual({ limit: 1.5 });
    });
  });

  describe("booleans", () => {
    const capability = withInput(z.object({ missingAltOnly: z.boolean() }));

    it.each([
      ["true", true],
      ["1", true],
      ["false", false],
      ["0", false],
    ])("converts %s", (raw, expected) => {
      expect(coerceQuery(capability, { missingAltOnly: raw })).toEqual({
        missingAltOnly: expected,
      });
    });

    it("reads a bare flag with no value as true", () => {
      // `?missingAltOnly` is the HTML convention for "on", and it reaches the
      // server as an empty string. Left as "" it would be a type error on the
      // most natural way to write the request.
      expect(coerceQuery(capability, { missingAltOnly: "" })).toEqual({ missingAltOnly: true });
    });

    it.each([["yes"], ["on"], ["TRUE"], ["2"]])(
      "passes %s through untouched rather than guessing",
      (raw) => {
        // "TRUE" in particular: quietly accepting it would make the API's
        // contract depend on which caller wrote it, and the schema's rejection
        // is what tells the next caller the accepted spelling.
        expect(coerceQuery(capability, { missingAltOnly: raw })).toEqual({
          missingAltOnly: raw,
        });
      },
    );
  });

  describe("finding the field's real type", () => {
    it.each([
      ["optional", z.number().optional()],
      ["defaulted", z.number().default(10)],
      ["nullable", z.number().nullable()],
      ["optional and defaulted", z.number().default(10).optional()],
    ])("sees through a %s wrapper to the number inside", (_label, schema) => {
      const capability = withInput(z.object({ limit: schema }));
      expect(coerceQuery(capability, { limit: "20" })).toEqual({ limit: 20 });
    });

    it("sees through a refinement on the object itself", () => {
      // Capabilities use `.refine()` for cross-field rules. Losing the shape
      // behind one would silently stop coercing every field of that capability
      // — no error, just 422s on requests that were always correct.
      const capability = withInput(
        z
          .object({ limit: z.number().optional(), cursor: z.string().optional() })
          .refine((value) => value.limit !== 0, { message: "limit must not be zero" }),
      );
      expect(coerceQuery(capability, { limit: "20" })).toEqual({ limit: 20 });
    });
  });

  describe("keys the schema does not describe", () => {
    const capability = withInput(z.object({ limit: z.number().optional() }));

    it("leaves an unknown key untouched instead of dropping it", () => {
      // Dropping it would hide a typo: the schema's own unknown-key handling
      // is what decides whether `?limitt=20` is an error or ignored, and it
      // cannot decide about a key it never sees.
      expect(coerceQuery(capability, { limitt: "20", cursor: "abc" })).toEqual({
        limitt: "20",
        cursor: "abc",
      });
    });

    it("returns the query unchanged when the input schema is not an object", () => {
      expect(coerceQuery(withInput(z.string()), { limit: "20" })).toEqual({ limit: "20" });
    });

    it("returns an empty result for an empty query", () => {
      expect(coerceQuery(capability, {})).toEqual({});
    });
  });

  it("coerces each field by its own type in one pass", () => {
    const capability = withInput(
      z.object({
        limit: z.number().optional(),
        missingAltOnly: z.boolean().optional(),
        cursor: z.string().optional(),
      }),
    );

    expect(
      coerceQuery(capability, { limit: "50", missingAltOnly: "1", cursor: "01hqz", extra: "x" }),
    ).toEqual({ limit: 50, missingAltOnly: true, cursor: "01hqz", extra: "x" });
  });
});
