"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChevronDownIcon, ChevronUpIcon, ReplaceIcon, XIcon } from "lucide-react";
import { Button, cn } from "@cms/ui";
import { findAll, setFindMatches, type FindMatch } from "./find-state";

/**
 * Find and replace over the open document.
 *
 * A panel rather than a dialog: the author needs to see the matches highlighted
 * in the text while they refine the query, and a modal over the document would
 * hide the thing being searched. It is keyboard-complete — Enter and
 * Shift-Enter step through, Escape closes and returns the caret to where it
 * was — because a find bar you have to reach for the mouse to leave is one
 * people stop using.
 */

export interface FindPanelProps {
  getView: () => EditorView | null;
  /** Bumped by the editor on every document change, so results stay honest. */
  docVersion: number;
  onClose: () => void;
}

export function FindPanel({ getView, docVersion, onClose }: FindPanelProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [matches, setMatches] = useState<FindMatch[]>([]);
  const [current, setCurrent] = useState(0);

  const queryRef = useRef<HTMLInputElement | null>(null);

  // Opening with a word selected searches for it, which is the request an
  // author has already expressed by selecting it.
  useEffect(() => {
    const view = getView();
    const selection = view?.state.selection.main;
    if (view && selection && !selection.empty) {
      const selected = view.state.sliceDoc(selection.from, selection.to);
      if (selected.length <= 120 && !selected.includes("\n")) setQuery(selected);
    }
    queryRef.current?.focus();
    queryRef.current?.select();
  }, [getView]);

  /**
   * Recompute on every change to the query, the options, or the document.
   *
   * The last of those is what keeps the panel usable while typing: the author
   * edits a match, the document version changes, and the highlights and the
   * counter follow rather than pointing at stale offsets.
   */
  useEffect(() => {
    const view = getView();
    if (!view) return;

    const found = findAll(view.state.doc.toString(), query, { caseSensitive });
    setMatches(found);
    setCurrent((previous) => (found.length === 0 ? 0 : Math.min(previous, found.length - 1)));
  }, [query, caseSensitive, docVersion, getView]);

  // Push the highlights into the editor. Separate from the search above so a
  // navigation that only moves `current` repaints without rescanning.
  useEffect(() => {
    const view = getView();
    if (!view) return;
    view.dispatch({
      effects: setFindMatches.of({ matches, current: matches.length > 0 ? current : -1 }),
    });
  }, [matches, current, getView]);

  // Clear the highlights when the panel goes away, so a closed search does not
  // leave the document marked up.
  useEffect(() => {
    return () => {
      getView()?.dispatch({ effects: setFindMatches.of({ matches: [], current: -1 }) });
    };
  }, [getView]);

  const reveal = useCallback(
    (index: number) => {
      const view = getView();
      const match = matches[index];
      if (!view || !match) return;
      // Scrolled into view without moving the caret or stealing focus: the
      // author is still typing in the query field.
      view.dispatch({ effects: EditorView.scrollIntoView(match.from, { y: "center" }) });
    },
    [getView, matches],
  );

  const step = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      const next = (current + delta + matches.length) % matches.length;
      setCurrent(next);
      reveal(next);
    },
    [current, matches.length, reveal],
  );

  const replaceCurrent = useCallback(() => {
    const view = getView();
    const match = matches[current];
    if (!view || !match) return;
    view.dispatch({
      changes: { from: match.from, to: match.to, insert: replacement },
      selection: EditorSelection.cursor(match.from + replacement.length),
      scrollIntoView: true,
    });
    // The rescan runs off the bumped document version; `current` stays put so
    // the next match takes its place, which is what repeated pressing wants.
  }, [current, getView, matches, replacement]);

  const replaceAll = useCallback(() => {
    const view = getView();
    if (!view || matches.length === 0) return;
    // One transaction, so one undo step puts the document back exactly.
    view.dispatch({
      changes: matches.map((match) => ({
        from: match.from,
        to: match.to,
        insert: replacement,
      })),
    });
  }, [getView, matches, replacement]);

  const close = useCallback(() => {
    onClose();
    getView()?.focus();
  }, [getView, onClose]);

  const inputClass =
    "ui-focus-ring h-7 min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-xs text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)]";

  return (
    <div
      role="search"
      aria-label="Find in document"
      className="flex flex-col gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2 py-1.5"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <div className="flex items-center gap-1.5">
        <Button
          size="icon"
          variant="ghost"
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          aria-expanded={showReplace}
          title={showReplace ? "Hide replace" : "Show replace"}
          onClick={() => setShowReplace((open) => !open)}
        >
          <ReplaceIcon aria-hidden="true" />
        </Button>

        <input
          ref={queryRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              step(event.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Find"
          aria-label="Find"
          className={cn(inputClass, "w-40 flex-1")}
        />

        <span
          role="status"
          aria-live="polite"
          className="w-20 shrink-0 text-right font-[family-name:var(--font-mono)] text-2xs text-[var(--color-ink-muted)] tabular-nums"
        >
          {query.length === 0
            ? ""
            : matches.length === 0
              ? "No matches"
              : `${current + 1} of ${matches.length}`}
        </span>

        <Button
          size="icon"
          variant="ghost"
          aria-label="Previous match (Shift-Enter)"
          title="Previous match — Shift-Enter"
          disabled={matches.length === 0}
          onClick={() => step(-1)}
        >
          <ChevronUpIcon aria-hidden="true" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Next match (Enter)"
          title="Next match — Enter"
          disabled={matches.length === 0}
          onClick={() => step(1)}
        >
          <ChevronDownIcon aria-hidden="true" />
        </Button>

        <label className="flex shrink-0 cursor-pointer items-center gap-1 text-2xs text-[var(--color-ink-muted)]">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(event) => setCaseSensitive(event.target.checked)}
            className="ui-focus-ring size-3 accent-[var(--color-accent)]"
          />
          Match case
        </label>

        <Button
          size="icon"
          variant="ghost"
          aria-label="Close find (Escape)"
          title="Close — Escape"
          onClick={close}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>

      {showReplace && (
        <div className="flex items-center gap-1.5">
          <span className="w-7 shrink-0" aria-hidden="true" />
          <input
            type="text"
            value={replacement}
            onChange={(event) => setReplacement(event.target.value)}
            placeholder="Replace with"
            aria-label="Replace with"
            className={cn(inputClass, "w-40 flex-1")}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={matches.length === 0}
            onClick={replaceCurrent}
          >
            Replace
          </Button>
          <Button size="sm" variant="outline" disabled={matches.length === 0} onClick={replaceAll}>
            Replace all
          </Button>
        </div>
      )}
    </div>
  );
}
