/**
 * The lint vocabulary, and the one definition of "blocked".
 *
 * `BLOCKING_RULES` lives here rather than in the publish capability because
 * more than one caller needs the answer — the publish gate, the studio's
 * pre-flight panel, the bulk importer — and three places agreeing on which
 * findings are fatal is three places that will eventually disagree.
 *
 * A rule blocks only if it is in this set *and* the finding is an error. That
 * conjunction matters: it leaves room for a blocking rule to also emit advisory
 * warnings without those quietly becoming publish-stoppers.
 */

import type { LintFinding } from "../types.js";
import { FAQ_ANSWER_IN_BODY } from "./faq-answer-in-body.js";
import { IMAGE_ALT_REQUIRED } from "./image-alt.js";

/** Emitted by the media transform, which is where resolution actually fails. */
export const UNRESOLVED_MEDIA_REF = "unresolved-media-ref";

export const BLOCKING_RULES: Set<string> = new Set([
  // Inaccessible, and only the author can fix it.
  IMAGE_ALT_REQUIRED,
  // Structured data that lies about the page costs the rich result.
  FAQ_ANSWER_IN_BODY,
  // A dangling reference renders as an empty box on a live page.
  UNRESOLVED_MEDIA_REF,
]);

export function isBlocking(finding: LintFinding): boolean {
  return finding.severity === "error" && BLOCKING_RULES.has(finding.rule);
}

export function hasBlockingFindings(findings: readonly LintFinding[]): boolean {
  return findings.some(isBlocking);
}

export { headingHierarchy, HEADING_HIERARCHY } from "./heading-hierarchy.js";
export { imageAltRequired, IMAGE_ALT_REQUIRED } from "./image-alt.js";
export {
  metadataLengths,
  META_DESCRIPTION_LENGTH,
  TITLE_LENGTH,
  DESCRIPTION_MIN,
  DESCRIPTION_MAX,
  TITLE_MIN,
  TITLE_MAX,
} from "./metadata.js";
export { readability, READABILITY, MIN_READING_EASE } from "./readability.js";
export {
  faqAnswerInBody,
  FAQ_ANSWER_IN_BODY,
  type FaqAnswer,
} from "./faq-answer-in-body.js";
export { thinContent, THIN_CONTENT, MIN_WORDS } from "./thin-content.js";
