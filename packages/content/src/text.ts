/**
 * Plain text derived from the rendered page.
 *
 * Deliberately taken from the *final, sanitised* hast rather than from the
 * markdown. `text` is what feeds full-text search, the readability lints and
 * `llms-full.txt`, and all three are claims about what a reader actually sees.
 * Deriving it from the source would let sanitisation remove something from the
 * page while search and the FAQ lint went on believing it was there — which is
 * precisely the mismatch that costs a site its rich results.
 */

import type { Nodes } from "hast";

/**
 * Elements that end a line of prose.
 *
 * Without this, `<li>a</li><li>b</li>` stringifies to "ab" and the readability
 * pass sees one impossible sentence.
 */
const BLOCK = new Set([
  "address", "article", "aside", "blockquote", "dd", "div", "dl", "dt",
  "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6",
  "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

export interface TextOptions {
  /** Tag names to drop entirely, contents included. */
  skip?: ReadonlySet<string>;
}

export function hastToText(node: Nodes, options: TextOptions = {}): string {
  const skip = options.skip ?? new Set<string>();
  const parts: string[] = [];

  const walk = (current: Nodes): void => {
    if (current.type === "text") {
      parts.push(current.value);
      return;
    }
    if (current.type === "comment" || current.type === "doctype") return;

    if (current.type === "element") {
      if (skip.has(current.tagName)) return;
      if (current.tagName === "br") {
        parts.push("\n");
        return;
      }
      const isBlock = BLOCK.has(current.tagName);
      if (isBlock) parts.push("\n\n");
      for (const child of current.children) walk(child);
      if (isBlock) parts.push("\n\n");
      return;
    }

    if ("children" in current) {
      for (const child of current.children) walk(child);
    }
  };

  walk(node);

  return parts
    .join("")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return matches ? matches.length : 0;
}

/**
 * 225 words per minute.
 *
 * Squarely inside the range measured for adults reading prose on screens, and
 * a round number the studio can explain to an author who disagrees with it.
 * Always at least one minute — "0 min read" reads as a bug.
 */
export function readingTimeMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / 225));
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])[\s"'’”)\]]*\s+|\n{2,}/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/**
 * Vowel-group syllable estimate.
 *
 * Flesch needs syllables and nothing short of a pronunciation dictionary gets
 * them exactly right. The heuristic — count vowel runs, drop a silent trailing
 * `e`, never return zero — is the one the readability literature uses, and it
 * is accurate enough for a score that is only ever read as a band.
 */
export function countSyllables(word: string): number {
  const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
  if (cleaned.length === 0) return 0;
  if (cleaned.length <= 3) return 1;

  const trimmed = cleaned
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 0);
}

export interface Readability {
  /** Flesch reading ease. Higher is easier; 60 is "plain English". */
  fleschReadingEase: number;
  sentenceCount: number;
  wordCount: number;
  longSentences: { text: string; words: number }[];
}

/** Sentences past this are where a reader loses the thread. */
export const LONG_SENTENCE_WORDS = 30;

export function analyseReadability(text: string): Readability {
  const sentences = splitSentences(text);
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];

  if (sentences.length === 0 || words.length === 0) {
    return { fleschReadingEase: 100, sentenceCount: 0, wordCount: 0, longSentences: [] };
  }

  let syllables = 0;
  for (const word of words) syllables += countSyllables(word);

  const score =
    206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);

  const longSentences = sentences
    .map((sentence) => ({ text: sentence, words: countWords(sentence) }))
    .filter((sentence) => sentence.words > LONG_SENTENCE_WORDS);

  return {
    fleschReadingEase: Math.round(score * 10) / 10,
    sentenceCount: sentences.length,
    wordCount: words.length,
    longSentences,
  };
}
