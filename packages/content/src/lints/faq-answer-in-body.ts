/**
 * Every FAQ answer must be visible on the page.
 *
 * The `qaBlocks` this pipeline extracts become FAQPage JSON-LD. Google's
 * requirement for that markup is that the question and answer appear in the
 * page's visible content, and structured data that promises text the page does
 * not show is the single most common reason a site loses its FAQ rich result —
 * a loss that is invisible in the CMS and only shows up as a slow bleed in
 * Search Console weeks later. So this blocks.
 *
 * The check compares against the *final, sanitised* page text rather than the
 * source, which is what makes it more than a tautology: an answer written
 * entirely as raw HTML is removed by the sanitiser, and without this the
 * JSON-LD would go on quoting text no reader can see.
 */

import type { LintFinding } from "../types";

export const FAQ_ANSWER_IN_BODY = "faq-answer-in-body";

export interface FaqAnswer {
  question: string;
  /** The answer as plain text, taken from the rendered subtree. */
  answerText: string;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function faqAnswerInBody(answers: readonly FaqAnswer[], pageText: string): LintFinding[] {
  const findings: LintFinding[] = [];
  const body = normalize(pageText);

  for (const answer of answers) {
    const text = normalize(answer.answerText);

    if (text.length === 0) {
      findings.push({
        rule: FAQ_ANSWER_IN_BODY,
        severity: "error",
        message: `The FAQ question "${answer.question}" has no visible answer.`,
      });
      continue;
    }

    if (!body.includes(text)) {
      findings.push({
        rule: FAQ_ANSWER_IN_BODY,
        severity: "error",
        message: `The answer to "${answer.question}" does not appear in the page's visible text.`,
      });
    }
  }

  return findings;
}
