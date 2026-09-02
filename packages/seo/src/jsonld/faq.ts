import type { JsonLdObject, SeoDocument } from "../types";
import { SCHEMA_CONTEXT } from "./shared";

/**
 * FAQ markup for the question-and-answer pairs the content pipeline extracted.
 *
 * Returns `null` rather than an empty `FAQPage` when a document has no pairs:
 * an FAQPage whose `mainEntity` is empty is a manual action waiting to happen,
 * and "emit nothing" is the only correct output for a post that is not an FAQ.
 *
 * The `@id` of each question is the bare fragment of the heading it came from.
 * A relative `@id` resolves against the document the script is embedded in,
 * which is precisely the page being described — so this stays correct without
 * the builder needing to know the site's origin, and stays correct if the same
 * markup is served from a staging host.
 */
export function faqLd(doc: SeoDocument): JsonLdObject | null {
  const pairs = (doc.qa ?? []).filter(
    (pair) => pair.question.trim() !== "" && pair.answerText.trim() !== "",
  );
  if (pairs.length === 0) return null;

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    mainEntity: pairs.map((pair) => ({
      "@type": "Question",
      "@id": `#${pair.anchorId}`,
      name: pair.question,
      acceptedAnswer: { "@type": "Answer", text: pair.answerText },
    })),
  };
}
