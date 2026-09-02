/**
 * Readability, measured on the prose a reader actually sees.
 *
 * Run against the rendered text with code blocks removed. Flesch treats an
 * identifier as a very long word and a semicolon as a sentence that never ends,
 * so a technical post with three code samples scores as unreadable and the
 * author learns to ignore the lint — which costs more than not having it.
 */

import { analyseReadability, LONG_SENTENCE_WORDS } from "../text";
import type { LintFinding } from "../types";

export const READABILITY = "readability";

/**
 * Below this, the prose reads as academic.
 *
 * 50 is the bottom of "fairly difficult" — a defensible floor for business
 * writing, and low enough that a post about tax law does not trip it merely for
 * using the vocabulary of tax law.
 */
export const MIN_READING_EASE = 50;

/** One long sentence is a rhythm choice; a fifth of the document is a habit. */
const LONG_SENTENCE_RATIO = 0.2;

export function readability(proseText: string): LintFinding[] {
  const analysis = analyseReadability(proseText);
  if (analysis.sentenceCount === 0) return [];

  const findings: LintFinding[] = [];

  if (analysis.fleschReadingEase < MIN_READING_EASE) {
    findings.push({
      rule: READABILITY,
      severity: "warning",
      message: `Flesch reading ease is ${analysis.fleschReadingEase}; aim for ${MIN_READING_EASE} or above.`,
    });
  }

  const long = analysis.longSentences.length;
  if (long > 0 && long / analysis.sentenceCount >= LONG_SENTENCE_RATIO) {
    findings.push({
      rule: READABILITY,
      severity: "warning",
      message: `${long} of ${analysis.sentenceCount} sentences run past ${LONG_SENTENCE_WORDS} words.`,
    });
  }

  return findings;
}
