/**
 * The install page's snippets — generated in the capability layer, not here.
 *
 * These functions used to live in this file, and an agent connected over MCP
 * had no way to reach them: it would have had to guess the SDK's API, and
 * guessing wrong produces a file that compiles in review and breaks in a
 * customer's build. So the generator moved to `@cms/capabilities` — the layer
 * every transport already dispatches through — and this module is the studio's
 * import of it.
 *
 * Kept as a module rather than deleted so the page and its components carry one
 * import path, and so this note has somewhere to live: the guide a person copies
 * and the plan `get_install_plan` hands an agent are byte-identical because they
 * are the same functions, and two copies of a code snippet drift silently.
 *
 * Imported by relative path rather than as `@cms/capabilities` on purpose. The
 * package's entry point builds the whole registry; this page needs one pure
 * module out of it, and reaching for the entry would pull every capability —
 * and the database and storage modules behind them — into a component tree and
 * a test that want neither.
 */

export {
  KEY_PLACEHOLDER,
  apiUrl,
  blogAppDir,
  clientSnippet,
  envSnippet,
  installSnippet,
  legacySnippet,
  markdownRewriteSnippet,
  markdownRouteSnippet,
  postPageSnippet,
  postUrl,
  routeSnippets,
  sampleSlugOf,
  verificationChecks,
  webhookRouteSnippet,
} from "../../../../../packages/capabilities/src/install";

export type {
  FileSnippet,
  InstallValues,
  VerificationCheck,
} from "../../../../../packages/capabilities/src/install";
