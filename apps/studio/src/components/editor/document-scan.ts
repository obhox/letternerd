/**
 * Two facts about the source that only the source can answer.
 *
 * Everything an author *reads* comes from `render_preview` — the pipeline that
 * publishes — and nothing here parses markdown into anything renderable. What
 * this module does is different in kind: it reports where in the buffer things
 * are, in lines, which is a question about the text file rather than about the
 * document. The server sees a rendered tree with no line numbers in it, so it
 * cannot answer that, and the outline could not scroll the editor without it.
 *
 * The counts are here for the same reason. `render_preview` returns an
 * authoritative `wordCount`, and it is the one the preview pane shows, but it
 * arrives a debounce behind the keyboard. A counter that freezes for a third
 * of a second every time you stop typing looks broken, so the status bar
 * counts locally and continuously, and the two agree to within the markup that
 * a rough strip cannot see.
 */

export interface SourceHeading {
  /** 1-based, as CodeMirror numbers lines and as lint findings report them. */
  line: number;
  depth: number;
  text: string;
}

/** Fence state, so a `#` inside a code block is not mistaken for a heading. */
const FENCE = /^\s{0,3}(```|~~~)/;
const ATX = /^(#{1,6})\s+(.*)$/;

/**
 * Headings, in document order, with the line each one starts on.
 *
 * ATX only. Setext headings (`===` underlines) are legal markdown and the
 * pipeline honours them, but they are not what the toolbar or the slash menu
 * produce, and treating a line of equals signs as a heading marker without
 * tracking paragraph context misfires on tables and horizontal rules. A
 * missing entry costs the outline a row; a wrong one scrolls the editor to the
 * wrong place, which is worse.
 */
export function scanHeadings(markdown: string): SourceHeading[] {
  const headings: SourceHeading[] = [];
  let fenced = false;

  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const text = lines[index] ?? "";

    if (FENCE.test(text)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;

    const match = ATX.exec(text);
    if (!match) continue;

    headings.push({
      line: index + 1,
      depth: match[1]!.length,
      // Trailing hashes are a legal closing sequence, not part of the text.
      text: match[2]!.replace(/\s+#+\s*$/, "").trim(),
    });
  }

  return headings;
}

export interface DocumentCounts {
  words: number;
  characters: number;
  /** Rounded up, minimum one, matching how the pipeline reports it. */
  readingMinutes: number;
}

/** The reading speed the pipeline's own estimate uses. */
const WORDS_PER_MINUTE = 220;

/**
 * Counts over the prose, with the obvious markup removed.
 *
 * Approximate on purpose: it strips fences, directive markers, link URLs and
 * inline punctuation, and does not try to be a parser. A word count is a sense
 * of scale, and the authoritative one is a debounce away in the preview.
 */
export function countDocument(markdown: string): DocumentCounts {
  const prose = markdown
    // Fenced code, including the fences themselves.
    .replace(/^\s{0,3}(```|~~~)[\s\S]*?^\s{0,3}\1\s*$/gm, "")
    // Directive fences and leaf directives.
    .replace(/^\s{0,3}:{2,3}.*$/gm, "")
    // Image and link targets: the label counts, the URL does not.
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    // Leading block markers.
    .replace(/^\s{0,3}([#>]+|[-*+]|\d+[.)])\s+/gm, "")
    // Inline emphasis and code punctuation.
    .replace(/[*_`~]/g, "");

  const words = prose.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;

  return {
    words,
    characters: markdown.length,
    readingMinutes: Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)),
  };
}
