/**
 * Reading the `lintReport` column without lying about it.
 *
 * The column defaults to `{}`, so the overwhelmingly common shape early in a
 * document's life is "nothing has ever run". That is not the same fact as "we
 * ran the lints and found nothing", and a green badge on a document nobody has
 * checked tells an editor the opposite of the truth. Everything here exists to
 * keep those two states apart.
 */

export interface LintFinding {
  rule: string;
  severity: string;
  message: string;
}

export interface LintSummary {
  /** False when no pipeline run has ever written to this document. */
  checked: boolean;
  errors: number;
  warnings: number;
  /** ISO timestamp of the run, when the report carries one. */
  checkedAt: string | null;
  findings: LintFinding[];
}

const UNCHECKED: LintSummary = {
  checked: false,
  errors: 0,
  warnings: 0,
  checkedAt: null,
  findings: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toFinding(value: unknown): LintFinding | null {
  if (!isRecord(value)) return null;
  const { rule, severity, message } = value;
  if (typeof severity !== "string") return null;
  return {
    rule: typeof rule === "string" ? rule : "unknown",
    severity,
    message: typeof message === "string" ? message : "",
  };
}

export function summarizeLintReport(report: unknown): LintSummary {
  if (!isRecord(report)) return UNCHECKED;

  const rawFindings = report.findings;
  const checkedAt = typeof report.checkedAt === "string" ? report.checkedAt : null;

  // A report with neither a findings array nor a timestamp is the default `{}`
  // the column ships with — an absence of evidence, not evidence of absence.
  if (!Array.isArray(rawFindings) && checkedAt === null) return UNCHECKED;

  const findings = Array.isArray(rawFindings)
    ? rawFindings
        .map(toFinding)
        .filter((finding): finding is LintFinding => finding !== null)
    : [];

  return {
    checked: true,
    errors: findings.filter((finding) => finding.severity === "error").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    checkedAt,
    findings,
  };
}

/** True only for documents we have actually checked and found blocking problems in. */
export function hasLintErrors(report: unknown): boolean {
  return summarizeLintReport(report).errors > 0;
}
