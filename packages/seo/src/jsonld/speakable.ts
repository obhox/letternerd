import type { JsonLdObject, SeoDocument } from "../types.js";
import { SCHEMA_CONTEXT } from "./shared.js";

/**
 * The class names are a contract with the content pipeline, which wraps the
 * TL;DR and the key-takeaways list in exactly these. Changing one without the
 * other produces markup that points at nothing, which is why they are named
 * here as constants rather than inline.
 */
export const SPEAKABLE_TLDR_SELECTOR = ".cms-tldr";
export const SPEAKABLE_TAKEAWAYS_SELECTOR = ".cms-takeaways";

/**
 * Only the sections that actually exist are advertised.
 *
 * A selector matching no element is not merely useless — it is a promise to an
 * assistant that there is a spoken-word summary here, and the assistant reads
 * out whatever it finds instead. A document with neither a TL;DR nor
 * takeaways gets no speakable markup at all.
 */
export function speakableLd(doc: SeoDocument): JsonLdObject | null {
  const selectors: string[] = [];
  if (doc.tldr && doc.tldr.trim() !== "") selectors.push(SPEAKABLE_TLDR_SELECTOR);
  if (doc.keyTakeaways && doc.keyTakeaways.length > 0) selectors.push(SPEAKABLE_TAKEAWAYS_SELECTOR);
  if (selectors.length === 0) return null;

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebPage",
    name: doc.title,
    speakable: { "@type": "SpeakableSpecification", cssSelector: selectors },
  };
}
