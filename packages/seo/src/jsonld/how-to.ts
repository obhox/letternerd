import type { JsonLdObject, SeoDocument } from "../types";
import { SCHEMA_CONTEXT, prune } from "./shared";

/**
 * `null` when the document has no how-to, for the same reason `faqLd` returns
 * null: markup describing a procedure that is not on the page is the kind of
 * mismatch that costs a site every rich result it has, not just this one.
 */
export function howToLd(doc: SeoDocument): JsonLdObject | null {
  const howTo = doc.howTo;
  if (!howTo || howTo.steps.length === 0) return null;

  return prune({
    "@context": SCHEMA_CONTEXT,
    "@type": "HowTo",
    name: howTo.name,
    description: howTo.description ?? undefined,
    step: howTo.steps.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.name,
      text: step.text,
    })),
  });
}
