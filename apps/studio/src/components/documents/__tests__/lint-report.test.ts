import { describe, expect, it } from "vitest";
import { hasLintErrors, summarizeLintReport } from "../lint-report";

/**
 * The whole point of this module is one distinction: "we checked and found
 * nothing" is not "nobody has ever checked". The column defaults to `{}`, so
 * the second is the common case, and a refactor that collapses the two shows a
 * green badge on every unreviewed document in the site.
 *
 * Everything else here is narrowing an untyped JSON column without throwing:
 * the value comes from the database and any shape is possible.
 */
describe("summarizeLintReport", () => {
  describe("tells 'never checked' apart from 'checked and clean'", () => {
    it("reports the column default as never checked", () => {
      // This is the shape the column ships with, so it is the shape most rows
      // in a young site have.
      expect(summarizeLintReport({})).toMatchObject({
        checked: false,
        errors: 0,
        warnings: 0,
        checkedAt: null,
        findings: [],
      });
    });

    it("reports an empty findings array as checked and clean", () => {
      // Same zero counts as the case above, opposite meaning. If these two
      // ever return the same `checked`, the badge is lying about one of them.
      expect(summarizeLintReport({ findings: [] })).toMatchObject({
        checked: true,
        errors: 0,
        warnings: 0,
        findings: [],
      });
    });

    it("treats a timestamp with no findings array as a completed run", () => {
      // A run that recorded when it happened but wrote no findings list is
      // still a run: the evidence of the check is the timestamp.
      expect(summarizeLintReport({ checkedAt: "2026-08-01T10:00:00.000Z" })).toMatchObject({
        checked: true,
        errors: 0,
        warnings: 0,
        checkedAt: "2026-08-01T10:00:00.000Z",
        findings: [],
      });
    });
  });

  describe("counts findings by severity", () => {
    const report = {
      checkedAt: "2026-08-01T10:00:00.000Z",
      findings: [
        { rule: "missing-alt", severity: "error", message: "Image has no alt text." },
        { rule: "long-title", severity: "warning", message: "Title is long." },
        { rule: "long-desc", severity: "warning", message: "Description is long." },
        { rule: "style", severity: "info", message: "Consider a shorter sentence." },
      ],
    };

    it("counts errors and warnings separately", () => {
      const summary = summarizeLintReport(report);
      expect(summary.errors).toBe(1);
      expect(summary.warnings).toBe(2);
    });

    it("keeps every finding, including severities it does not count", () => {
      // The counts drive the badge; the panel lists all of them. An `info`
      // that were dropped here would vanish from the panel too.
      expect(summarizeLintReport(report).findings).toHaveLength(4);
    });

    it("carries the timestamp through so the panel can say when", () => {
      expect(summarizeLintReport(report).checkedAt).toBe("2026-08-01T10:00:00.000Z");
    });
  });

  describe("narrows an untyped column without throwing", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a string", "clean"],
      ["a number", 0],
      // An array is an object to `typeof`, and reading `.findings` off one
      // gives undefined — which would otherwise read as "checked, no findings".
      ["an array", []],
    ])("reports %s as never checked", (_label, value) => {
      expect(summarizeLintReport(value).checked).toBe(false);
    });

    it("drops entries that are not findings, keeping the ones that are", () => {
      const summary = summarizeLintReport({
        findings: [
          null,
          "not a finding",
          { rule: "no-severity" },
          { rule: "missing-alt", severity: "error", message: "Image has no alt text." },
        ],
      });
      expect(summary.findings).toHaveLength(1);
      expect(summary.errors).toBe(1);
    });

    it("fills in a placeholder rule and message rather than rendering undefined", () => {
      expect(summarizeLintReport({ findings: [{ severity: "warning" }] }).findings[0]).toEqual({
        rule: "unknown",
        severity: "warning",
        message: "",
      });
    });

    it("ignores a non-string timestamp", () => {
      const summary = summarizeLintReport({ findings: [], checkedAt: 1735689600000 });
      expect(summary.checkedAt).toBeNull();
      expect(summary.checked).toBe(true);
    });
  });
});

describe("hasLintErrors", () => {
  it("is false for a document nobody has checked", () => {
    // The publish gate reads this. Returning true for an unchecked document
    // would block every new draft; returning true only for real errors is
    // what makes "not checked" a neutral state rather than a blocking one.
    expect(hasLintErrors({})).toBe(false);
    expect(hasLintErrors(null)).toBe(false);
  });

  it("is false for a document checked and found clean", () => {
    expect(hasLintErrors({ findings: [] })).toBe(false);
  });

  it("is false when the only findings are warnings", () => {
    expect(hasLintErrors({ findings: [{ severity: "warning", message: "Title is long." }] })).toBe(
      false,
    );
  });

  it("is true only when a completed check found a blocking problem", () => {
    expect(hasLintErrors({ findings: [{ severity: "error", message: "No alt text." }] })).toBe(true);
  });
});
