/**
 * `renderDocument` — the one render function.
 *
 * The editor's live preview, the publish-time lint gate and the published HTML
 * are the same call. That is the whole design: a preview produced by a second,
 * simpler pipeline shows an author markup that will never ship, and a lint gate
 * running its own parse blocks on problems the renderer does not have. So there
 * is exactly one of these, it is pure, and everything it cannot compute from
 * its input is injected.
 *
 * The pipeline, in order, and why the order is what it is:
 *
 *   parse -> gfm -> directives      the source, as written
 *   lint over mdast                 positions still exist here, and only here
 *   directive transform             markup and structured data, in one pass
 *   media transform                 `media://` resolved through the injection
 *   mdast -> hast                   `allowDangerousHtml: false`
 *   rehype-slug                     proposes a slug for every heading
 *   stable anchors                  overrides it with the id we published before
 *   autolink headings               so the copy-link points at the live id
 *   shiki                           highlighting, before anything is stripped
 *   clobber guard                   ids that would shadow DOM globals, srcset
 *   sanitize                        last, so nothing added after it is trusted
 *   stringify
 */

import rehypeShikiFromHighlighter from "@shikijs/rehype/core";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypeSanitize from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkDirective from "remark-directive";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { createHighlighter } from "shiki";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { VFile } from "vfile";
import type { Element, Root as HastRoot } from "hast";
import type { Root as MdastRoot } from "mdast";

import { rehypeClobberGuard } from "./clobber-guard";
import { emptyHarvest, transformDirectives } from "./directives";
import { contentHash } from "./hash";
import {
  faqAnswerInBody,
  headingHierarchy,
  imageAltRequired,
  metadataLengths,
  readability,
  thinContent,
  type FaqAnswer,
} from "./lints/index";
import { buildPublicMarkdown } from "./md-public";
import { emptyMediaHarvest, transformMedia } from "./media";
import { contentSanitizeSchema } from "./sanitize-schema";
import { emptyAnchorHarvest, QA_MARKER, rehypeStableAnchors } from "./stable-anchors";
import { countWords, hastToText, readingTimeMinutes } from "./text";
import type { LintFinding, QaBlock, RenderInput, RenderResult } from "./types";

/**
 * One highlighter for the process.
 *
 * Building it loads two theme definitions and the WASM regex engine, which is
 * far too much to redo per keystroke in a live preview. It is a memoised pure
 * computation — no configuration, no I/O beyond the bundled grammars — so
 * sharing it does not make `renderDocument` stateful in any way a caller can
 * observe. Languages load on demand rather than up front, so a site that only
 * ever writes TypeScript never pays for the other two hundred.
 */
type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;

/**
 * Grammars are loaded up front, never lazily.
 *
 * `lazy: true` with an empty `langs` looks like a sensible optimisation and is
 * a correctness bug: shiki loads a grammar asynchronously, but the rehype
 * transform that needs it is synchronous. The first fence in a given language
 * therefore renders UNHIGHLIGHTED and merely schedules the load, and the second
 * render — of the identical document — comes out different. Rendering happens
 * once at publish and the result is stored, so in production that meant the
 * first document published after a process start kept plain-looking code
 * forever, with nothing to indicate why.
 *
 * Loading the set eagerly costs a few hundred milliseconds once per process.
 * That is paid at publish time, not per request, and buys the guarantee the
 * whole pipeline rests on: the same markdown always produces the same bytes.
 *
 * A fence tagged with a language outside this list falls back to `text`
 * deterministically, which is the right answer for a typo.
 */
const SUPPORTED_LANGUAGES = [
  "bash",
  "css",
  "diff",
  "go",
  "html",
  "java",
  "javascript",
  "json",
  "jsx",
  "markdown",
  "php",
  "python",
  "ruby",
  "rust",
  "shell",
  "sql",
  "tsx",
  "typescript",
  "yaml",
] as const;

let highlighterPromise: Promise<Highlighter> | undefined;

function sharedHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: [...SUPPORTED_LANGUAGES],
  });
  return highlighterPromise;
}

/** Determinism: two renders of the same document must produce the same list. */
function sortFindings(findings: LintFinding[]): LintFinding[] {
  return findings.slice().sort((a, b) => {
    const line = (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER);
    if (line !== 0) return line;
    const column = (a.column ?? 0) - (b.column ?? 0);
    if (column !== 0) return column;
    return a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message);
  });
}

export async function renderDocument(input: RenderInput): Promise<RenderResult> {
  const directiveHarvest = emptyHarvest();
  const mediaHarvest = emptyMediaHarvest();
  const anchorHarvest = emptyAnchorHarvest();
  const mdastFindings: LintFinding[] = [];

  const highlighter = await sharedHighlighter();

  const processor = unified()
    .use(remarkParse)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkGfm)
    .use(remarkDirective)
    .use(function lintMdast() {
      // Before any transform, because this is the last point at which every
      // node still carries the source position an author can navigate to.
      return (tree: MdastRoot) => {
        mdastFindings.push(
          ...headingHierarchy(tree),
          ...imageAltRequired(tree, input.resolveMedia),
        );
      };
    })
    .use(function directives() {
      return (tree: MdastRoot) => transformDirectives(tree, directiveHarvest);
    })
    .use(function media() {
      return (tree: MdastRoot) => transformMedia(tree, input.resolveMedia, mediaHarvest);
    })
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlug)
    .use(rehypeStableAnchors, {
      ...(input.existingHeadings ? { existingHeadings: input.existingHeadings } : {}),
      harvest: anchorHarvest,
    })
    .use(rehypeAutolinkHeadings, {
      behavior: "append",
      properties: {
        className: ["cms-anchor-link"],
        // Decorative: the heading text is already the link's context, and an
        // announced "link, hash" after every heading is noise.
        ariaHidden: "true",
        tabIndex: -1,
      },
    })
    .use(rehypeShikiFromHighlighter, highlighter, {
      themes: { light: "github-light", dark: "github-dark" },
      // Every supported grammar is already loaded; see SUPPORTED_LANGUAGES.
      // Lazy loading here is what made the first render differ from the second.
      lazy: false,
      defaultLanguage: "text",
      fallbackLanguage: "text",
      // A code fence tagged with a language nobody has heard of is a typo, not
      // a reason to fail a publish. It renders unhighlighted.
      onError: () => {},
    })
    // Immediately before the sanitiser, so it sees every id and `srcset` the
    // passes above produced and nothing runs between it and the output.
    .use(rehypeClobberGuard)
    .use(rehypeSanitize, contentSanitizeSchema)
    .use(rehypeStringify);

  const file = new VFile({ value: input.markdown });

  // Two independent parses. `mdPublic` is built by flattening the source into
  // ordinary markdown, and the render tree has by then been rewritten into
  // nodes `mdast-util-to-markdown` has no handler for.
  const renderTree = processor.parse(file);
  const publicTree = processor.parse(file);

  const hast = (await processor.run(renderTree, file)) as HastRoot;
  const html = String(processor.stringify(hast, file));

  const text = hastToText(hast);
  // Code is prose to nobody. Measuring reading ease over an identifier-dense
  // snippet scores every technical post as unreadable, and a lint an author
  // learns to ignore is worse than no lint.
  const proseText = hastToText(hast, { skip: new Set(["pre"]) });
  const wordCount = countWords(text);

  const publicMarkdown = buildPublicMarkdown({
    tree: publicTree,
    site: input.site,
    slug: input.slug,
    resolveMedia: input.resolveMedia,
    publicFrontmatter: input.publicFrontmatter,
  });

  const answerElements = collectAnswerElements(hast);
  const qaBlocks: QaBlock[] = [];
  const faqAnswers: FaqAnswer[] = [];

  for (const [position, question] of directiveHarvest.questions.entries()) {
    const answer = answerElements.get(question.index);
    const answerHtml = answer
      ? String(processor.stringify({ type: "root", children: answer.children }, file)).trim()
      : "";
    qaBlocks.push({
      question: question.question,
      answerMd: publicMarkdown.answers[position] ?? "",
      answerHtml,
      // Empty only if the anchor pass never saw the heading, which means the
      // question was not rendered at all — the FAQ lint below reports it.
      anchorId: anchorHarvest.qaAnchors.get(question.index) ?? "",
      kind: question.kind,
    });
    faqAnswers.push({
      question: question.question,
      answerText: answer ? hastToText(answer) : "",
    });
  }

  const lints = sortFindings([
    ...mdastFindings,
    ...directiveHarvest.findings,
    ...mediaHarvest.findings,
    ...metadataLengths(input.publicFrontmatter),
    ...thinContent(wordCount),
    ...readability(proseText),
    // Runs last, against the sanitised text, so it sees what a reader sees.
    ...faqAnswerInBody(faqAnswers, text),
  ]);

  return {
    html,
    text,
    mdPublic: publicMarkdown.markdown,
    headings: anchorHarvest.headings,
    qaBlocks,
    tldr: directiveHarvest.tldr,
    keyTakeaways: directiveHarvest.keyTakeaways,
    howtos: directiveHarvest.howtos,
    wordCount,
    readingTimeMinutes: readingTimeMinutes(wordCount),
    lints,
    contentHash: contentHash(input.markdown),
  };
}

/** The `<div class="cms-faq__answer">` for each question, keyed by its marker. */
function collectAnswerElements(tree: HastRoot): Map<number, Element> {
  const elements = new Map<number, Element>();
  visit(tree, "element", (node) => {
    if (node.tagName !== "div") return;
    const marker = node.properties?.[QA_MARKER];
    if (typeof marker !== "string") return;
    const index = Number.parseInt(marker, 10);
    if (Number.isInteger(index)) elements.set(index, node);
  });
  return elements;
}
