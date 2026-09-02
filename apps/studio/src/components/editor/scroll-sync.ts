"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { EditorApi } from "./markdown-editor";
import type { SourceHeading } from "./document-scan";

/**
 * Keeping the two panes looking at the same part of the document.
 *
 * The naive version of this maps scroll percentage to scroll percentage, and
 * it is wrong the moment a document stops being uniform: an image is one line
 * of markdown and four hundred pixels of preview, a fenced code block is
 * twenty lines of source and a squat grey slab, a `:::faq` is three lines that
 * render as a bordered card. Percentage sync puts the panes a screen apart by
 * the middle of any real post, and the author stops trusting it.
 *
 * So the mapping is anchored on headings, which exist in both representations
 * and are where a reader's eye actually locates itself. The source heading
 * list and the rendered `<h1>`–`<h6>` elements are matched up by text, in
 * order, giving a set of (line, pixel) pairs; between two anchors the position
 * is interpolated, which is exactly as accurate as the assumption that a
 * section is roughly uniform inside itself — an assumption that only has to
 * hold for a few paragraphs at a time rather than for the whole document.
 *
 * The other half of the problem is that two panes syncing each other is a
 * feedback loop. Whichever pane the human is touching drives; the other is
 * moved, and its resulting scroll event is ignored for a moment afterwards.
 * Without that suppression window the panes shove each other, and the symptom
 * — scrolling that fights back, or drifts on its own — is far worse than no
 * sync at all.
 */

interface Anchor {
  /** 1-based line in the markdown source. */
  line: number;
  /** Pixel offset of the same heading inside the preview's scroll content. */
  top: number;
}

/** How long a programmatic scroll disowns the other pane's scroll events. */
const SUPPRESS_MS = 180;

function normalise(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Match rendered headings to source headings, in order.
 *
 * A two-pointer walk rather than an index-for-index pairing, because the two
 * lists legitimately differ: the `:::faq` transform turns a `### question`
 * into a paragraph with its own class rather than a heading, so the source has
 * entries the rendered document does not. Advancing the source pointer until
 * the text matches skips those without knocking the rest out of alignment.
 */
function buildAnchors(
  preview: HTMLElement,
  headings: readonly SourceHeading[],
  lineCount: number,
): Anchor[] {
  const rendered = Array.from(preview.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const previewTop = preview.getBoundingClientRect().top - preview.scrollTop;

  const anchors: Anchor[] = [{ line: 1, top: 0 }];
  let cursor = 0;

  for (const element of rendered) {
    const text = normalise(element.textContent ?? "");
    let index = cursor;
    while (index < headings.length && normalise(headings[index]!.text) !== text) index += 1;
    if (index >= headings.length) continue;

    cursor = index + 1;
    const top = element.getBoundingClientRect().top - previewTop;
    const line = headings[index]!.line;
    // Strictly increasing on both axes, or the interpolation divides by zero.
    const last = anchors[anchors.length - 1]!;
    if (line > last.line && top > last.top) anchors.push({ line, top });
  }

  const last = anchors[anchors.length - 1]!;
  const end = Math.max(preview.scrollHeight - preview.clientHeight, last.top + 1);
  if (lineCount > last.line) anchors.push({ line: lineCount, top: end });

  return anchors;
}

/** Where `value` sits between two anchors, on whichever axis is given. */
function interpolate(anchors: Anchor[], value: number, from: "line" | "top"): number {
  const to = from === "line" ? "top" : "line";

  let index = 0;
  while (index < anchors.length - 2 && anchors[index + 1]![from] <= value) index += 1;

  const start = anchors[index]!;
  const end = anchors[index + 1] ?? start;
  const span = end[from] - start[from];
  const fraction = span <= 0 ? 0 : Math.min(1, Math.max(0, (value - start[from]) / span));

  return start[to] + fraction * (end[to] - start[to]);
}

export interface ScrollSyncInput {
  /** Only true in split view; there is nothing to sync otherwise. */
  enabled: boolean;
  editorRef: RefObject<EditorApi | null>;
  previewRef: RefObject<HTMLElement | null>;
  headings: readonly SourceHeading[];
  lineCount: number;
}

export function useScrollSync({
  enabled,
  editorRef,
  previewRef,
  headings,
  lineCount,
}: ScrollSyncInput): void {
  // Read inside the listeners rather than captured, so an edit that changes
  // the headings does not require tearing the listeners down and rebuilding
  // them — which would drop a scroll gesture in progress.
  const headingsRef = useRef(headings);
  const lineCountRef = useRef(lineCount);
  headingsRef.current = headings;
  lineCountRef.current = lineCount;

  useEffect(() => {
    if (!enabled) return;

    const editor = editorRef.current;
    const preview = previewRef.current;
    const scroller = editor?.scrollElement();
    if (!editor || !preview || !scroller) return;

    /** Timestamps until which each pane's own scroll events are not the driver. */
    const suppressed = { editor: 0, preview: 0 };
    let frame = 0;

    const schedule = (run: () => void) => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        run();
      });
    };

    const onEditorScroll = () => {
      if (performance.now() < suppressed.editor) return;
      schedule(() => {
        const line = editor.topVisibleLine();
        if (line === null) return;
        const anchors = buildAnchors(preview, headingsRef.current, lineCountRef.current);
        const top = interpolate(anchors, line, "line");
        // Nothing to do if it is already there; an assignment would still cost
        // a scroll event and a suppression window.
        if (Math.abs(preview.scrollTop - top) < 2) return;
        suppressed.preview = performance.now() + SUPPRESS_MS;
        preview.scrollTop = top;
      });
    };

    const onPreviewScroll = () => {
      if (performance.now() < suppressed.preview) return;
      schedule(() => {
        const anchors = buildAnchors(preview, headingsRef.current, lineCountRef.current);
        const line = Math.round(interpolate(anchors, preview.scrollTop, "top"));
        suppressed.editor = performance.now() + SUPPRESS_MS;
        editor.scrollLineToTop(line);
      });
    };

    scroller.addEventListener("scroll", onEditorScroll, { passive: true });
    preview.addEventListener("scroll", onPreviewScroll, { passive: true });

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onEditorScroll);
      preview.removeEventListener("scroll", onPreviewScroll);
    };
  }, [enabled, editorRef, previewRef]);
}
