/**
 * `@cms/content` — markdown in, everything the rest of the CMS needs out.
 *
 * The surface is deliberately narrow. `renderDocument` is the only way to turn
 * a document into HTML; the pieces below it are exported because the lint gate
 * and `@cms/seo` legitimately need to name a rule or a class, not because a
 * caller should assemble its own pipeline out of them.
 */

export { PIPELINE_VERSION } from "./types";
export type {
  HeadingEntry,
  HowToBlock,
  LintFinding,
  LintSeverity,
  QaBlock,
  RenderInput,
  RenderResult,
  RenderSiteContext,
  ResolvedMedia,
} from "./types";

export { renderDocument } from "./render";

export { contentHash } from "./hash";

export {
  BLOCKING_RULES,
  hasBlockingFindings,
  isBlocking,
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  FAQ_ANSWER_IN_BODY,
  HEADING_HIERARCHY,
  IMAGE_ALT_REQUIRED,
  META_DESCRIPTION_LENGTH,
  MIN_READING_EASE,
  MIN_WORDS,
  READABILITY,
  THIN_CONTENT,
  TITLE_LENGTH,
  TITLE_MAX,
  TITLE_MIN,
  UNRESOLVED_MEDIA_REF,
} from "./lints/index";

export {
  HEADING_MATCH_THRESHOLD,
  reconcileHeadings,
  type HeadingDraft,
} from "./anchors";
export { levenshtein, normalizeHeadingText, similarity } from "./similarity";

export {
  EMBED_PROVIDERS,
  resolveEmbed,
  type EmbedInfo,
  type EmbedProvider,
} from "./embeds";

export { MEDIA_PROTOCOL, mediaId, type MediaResolver } from "./media";

export { contentSanitizeSchema } from "./sanitize-schema";

export {
  analyseReadability,
  countWords,
  hastToText,
  readingTimeMinutes,
  type Readability,
} from "./text";
