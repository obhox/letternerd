/**
 * Thin content.
 *
 * Length is not quality, and this deliberately does not pretend otherwise —
 * it is a warning, and a genuinely complete 200-word answer should be published
 * over it. What it catches is the other thing: a draft that was published by
 * accident, or a page written to occupy a keyword rather than to answer it.
 */

import type { LintFinding } from "../types";

export const THIN_CONTENT = "thin-content";

/** Roughly a minute of reading. Below it, a page rarely answers anything fully. */
export const MIN_WORDS = 300;

export function thinContent(wordCount: number): LintFinding[] {
  if (wordCount >= MIN_WORDS) return [];
  return [
    {
      rule: THIN_CONTENT,
      severity: "warning",
      message: `The document is ${wordCount} words; below about ${MIN_WORDS} it reads as thin.`,
    },
  ];
}
