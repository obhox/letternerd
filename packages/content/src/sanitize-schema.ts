/**
 * What survives sanitisation.
 *
 * The default GitHub schema is the right starting point — it is the one that
 * has been attacked in public for a decade — but it strips several things this
 * pipeline depends on, so each is added back deliberately and narrowly rather
 * than by loosening the schema wholesale.
 */

import { defaultSchema } from "rehype-sanitize";

type Schema = typeof defaultSchema;
type Attributes = NonNullable<Schema["attributes"]>;

/**
 * Drop the default schema's per-tag class allow-lists.
 *
 * GitHub's schema permits `className` on `ul`, `ol`, `li`, `section` and `a`
 * only for the handful of values its own stylesheet uses. A per-tag definition
 * wins over the `*` one, and a rejected value is filtered out of the list
 * rather than falling through — so `<ul class="cms-takeaways">` sanitises to
 * `<ul class="">`, silently, and the Speakable selector stops matching. Every
 * such definition is replaced with the unrestricted name.
 */
function unrestrictClassNames(attributes: Attributes): Attributes {
  const result: Attributes = {};
  for (const [tagName, definitions] of Object.entries(attributes)) {
    result[tagName] = (definitions ?? []).map((definition) =>
      Array.isArray(definition) && definition[0] === "className" ? "className" : definition,
    );
  }
  return result;
}

const BASE_ATTRIBUTES = unrestrictClassNames(defaultSchema.attributes ?? {});

const OUR_DATA_ATTRIBUTES = [
  "data-provider",
  "data-embed-id",
  "data-embed-url",
  "data-step",
  "data-cms-qa",
  "data-blurhash",
];

export const contentSanitizeSchema: Schema = {
  ...defaultSchema,

  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    // The directives and the media transform emit these; the default schema
    // predates `<figure>` being the obvious way to caption an image.
    "figure",
    "figcaption",
    "button",
  ],

  attributes: {
    ...BASE_ATTRIBUTES,
    "*": [
      ...(BASE_ATTRIBUTES["*"] ?? []),
      // Class names are the API. `.cms-tldr` and `.cms-takeaways` are what the
      // Speakable JSON-LD selects on, and the consuming site styles everything
      // else through them, so an unrestricted allow-list here is intentional:
      // a class name cannot execute, and enumerating ours would break the
      // moment a theme adds one.
      "className",
      "ariaHidden",
      "ariaLabel",
      ...OUR_DATA_ATTRIBUTES,
    ],
    img: [
      ...(BASE_ATTRIBUTES["img"] ?? []),
      "alt",
      "width",
      "height",
      "srcSet",
      "sizes",
      "loading",
      "decoding",
    ],
    // Shiki colours every token with an inline `style`. Dropping it would leave
    // the syntax highlighting we just paid for invisible. A `style` attribute
    // is not a script-execution vector in any browser still shipping, and it is
    // permitted on exactly the three elements Shiki writes to rather than
    // everywhere.
    pre: [...(BASE_ATTRIBUTES["pre"] ?? []), "style", "tabIndex"],
    code: [...(BASE_ATTRIBUTES["code"] ?? []), "style"],
    span: [...(BASE_ATTRIBUTES["span"] ?? []), "style"],
    a: [...(BASE_ATTRIBUTES["a"] ?? []), "href", "rel", "tabIndex"],
    button: ["type"],
  },

  /**
   * Ids are published URLs, so they must not be rewritten.
   *
   * The default schema prefixes `id` and `name` with `user-content-` to stop
   * author-controlled ids from clobbering DOM properties. That protection is
   * real, but it is incompatible with the entire point of this package: an
   * anchor an answer engine cited has to be the string that appears in the
   * HTML. The exposure it gives up is narrow — a heading called "location" can
   * shadow `document.location` for scripts on the consuming page that read
   * globals by name — and it is the same trade every static site generator
   * makes for the same reason.
   */
  clobberPrefix: "",
};
