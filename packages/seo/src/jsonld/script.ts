import type { JsonLdObject } from "../types.js";

/**
 * Serialises nodes for the inside of a `<script type="application/ld+json">`.
 *
 * The return value is the script's *body*, not the tag: the SDK renders the
 * element itself, and handing it a string keeps this package free of any
 * framework's escaping rules.
 *
 * Which is the whole difficulty. Inside a `<script>`, the HTML parser is not
 * looking for JSON — it is looking for `</script`, and it will end the element
 * there no matter how well-formed the JSON around it is. A post titled
 * `</script><img onerror=...>` would otherwise close the tag and hand the
 * remainder of the document to the browser as markup. So `<`, `>` and `&` are
 * emitted as `\u003c`, `\u003e` and `\u0026`: still valid JSON, still parsing
 * back to the original strings, but containing no character sequence the HTML
 * tokeniser reacts to. U+2028 and U+2029 go too — legal in JSON, fatal inside
 * a JavaScript string literal, and free to escape here.
 *
 * Several nodes serialise as a JSON-LD array, which is one script tag instead
 * of five and is exactly what the spec says to do with multiple top-level
 * nodes. Nulls are dropped so callers can splat in `faqLd(doc)` without
 * checking it first.
 */
export function jsonLdScript(...objects: (JsonLdObject | null | undefined)[]): string {
  const nodes = objects.filter((node): node is JsonLdObject => node != null);
  const payload = nodes.length === 1 ? nodes[0] : nodes;

  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
