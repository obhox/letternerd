import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Find and replace, without `@codemirror/search`.
 *
 * The official package is not installed and adding a dependency was not mine
 * to decide, so this is a hand-rolled equivalent of the part authors actually
 * use: a literal, optionally case-sensitive scan over the document, every hit
 * highlighted, one of them current, and replace/replace-all over the same
 * ranges. What it deliberately does not do is regular expressions, whole-word
 * matching, search-within-selection or persistent search history — those are
 * the parts worth taking from the real package rather than reimplementing
 * badly. See the note in the editor's report.
 *
 * The matches live in a `StateField` rather than in React state because they
 * are positions in a document that the author keeps editing. Mapping them
 * through each transaction's changes is what stops a highlight from sliding
 * off the word it was on the moment a character is typed above it.
 */

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindMatches {
  matches: readonly FindMatch[];
  /** Index into `matches`, or -1 when there is no current one. */
  current: number;
}

export const setFindMatches = StateEffect.define<FindMatches>();

const highlight = Decoration.mark({ class: "cm-find-match" });
const currentHighlight = Decoration.mark({ class: "cm-find-match cm-find-match-current" });

const findField = StateField.define<DecorationSet>({
  create: () => Decoration.none,

  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFindMatches)) {
        const { matches, current } = effect.value;
        return Decoration.set(
          matches.map((match, index) =>
            (index === current ? currentHighlight : highlight).range(match.from, match.to),
          ),
          true,
        );
      }
    }

    // No effect this time: carry the highlights across the edit rather than
    // dropping them, so typing a replacement does not blank the whole set.
    return transaction.docChanged ? decorations.map(transaction.changes) : decorations;
  },

  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Monotone highlighting: the current match is the inverted one, the rest are
 * a tint. Contrast carries "which of these is selected", because there is no
 * second hue available to carry it.
 */
const findTheme = EditorView.theme({
  ".cm-find-match": {
    backgroundColor: "var(--color-muted)",
    outline: "1px solid var(--color-border-strong)",
    borderRadius: "2px",
  },
  ".cm-find-match-current": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-ink)",
    outline: "1px solid var(--color-accent)",
  },
});

export function findHighlighting(): Extension {
  return [findField, findTheme];
}

/** Every hit for `query`, in document order. */
export function findAll(
  doc: string,
  query: string,
  options: { caseSensitive: boolean },
): FindMatch[] {
  if (query.length === 0) return [];

  const haystack = options.caseSensitive ? doc : doc.toLowerCase();
  const needle = options.caseSensitive ? query : query.toLowerCase();

  const matches: FindMatch[] = [];
  let from = haystack.indexOf(needle);
  while (from !== -1) {
    matches.push({ from, to: from + needle.length });
    // Non-overlapping: searching for "aa" in "aaaa" finds two, not three,
    // which is what replace-all has to agree with to be reversible.
    from = haystack.indexOf(needle, from + needle.length);
    // A pathological query on a huge document should not lock the tab up.
    if (matches.length >= 5000) break;
  }

  return matches;
}
