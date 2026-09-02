import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  BoldIcon,
  CircleHelpIcon,
  FilmIcon,
  Heading2Icon,
  LinkIcon,
  ListChecksIcon,
  ListOrderedIcon,
  QuoteIcon,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * The toolbar's commands, expressed as edits to the document.
 *
 * Every one of these inserts *text*. There is no parallel model of the
 * document, no node tree the buttons manipulate and the editor renders from —
 * the markdown in the buffer is the only representation there is. A toolbar
 * that maintains its own structure has to reconcile it with what the author
 * types by hand, and that reconciliation is where a markdown editor stops
 * round-tripping its own content.
 */

export type CommandIcon = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

export interface EditorCommand {
  id: string;
  /** Short enough for a dense strip. */
  label: string;
  /** The tooltip, and the accessible name when the label is hidden. */
  title: string;
  icon: CommandIcon;
  /** A CodeMirror key name, bound in the editor's keymap. */
  key?: string;
  run: (view: EditorView) => void;
}

/**
 * Marks where the caret should land inside a template, and is stripped before
 * the text reaches the document.
 *
 * A plain-ASCII sentinel rather than a control character: these templates are
 * read and edited by people, and an invisible marker in a string literal is a
 * marker somebody eventually deletes by accident.
 */
const CARET = "[[caret]]";

interface Skeleton {
  text: string;
  caret: number;
}

function skeleton(template: string): Skeleton {
  const caret = template.indexOf(CARET);
  return {
    text: template.replace(CARET, ""),
    caret: caret < 0 ? template.length : caret,
  };
}

/**
 * Insert a block on lines of its own.
 *
 * Directives are only recognised at the start of a line, so a `:::tldr`
 * dropped mid-sentence would render as literal text rather than failing
 * loudly. The padding below is what stops the toolbar from producing that.
 */
function insertBlock(view: EditorView, template: string): void {
  const { state } = view;
  const range = state.selection.main;
  const line = state.doc.lineAt(range.from);
  const prefix = state.sliceDoc(line.from, range.from);
  const onBlankPrefix = prefix.trim().length === 0;

  // Starting from the line start when only whitespace precedes the caret
  // swallows stray indentation; four spaces before a `:::` would make the
  // whole block an indented code block instead.
  const from = onBlankPrefix ? line.from : range.from;
  const lead = onBlankPrefix ? "" : "\n\n";

  const rest = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + 1));
  const trail = range.to === state.doc.length || rest === "\n" ? "\n" : "\n\n";

  const block = skeleton(template);
  const anchor = from + lead.length + block.caret;

  view.dispatch({
    changes: { from, to: range.to, insert: `${lead}${block.text}${trail}` },
    selection: EditorSelection.single(anchor),
    scrollIntoView: true,
  });
  view.focus();
}

/** Wrap the selection, or drop in a placeholder and select it to be typed over. */
function wrap(view: EditorView, before: string, after: string, placeholder: string): void {
  const spec = view.state.changeByRange((range) => {
    const selected = view.state.sliceDoc(range.from, range.to);
    const body = selected.length > 0 ? selected : placeholder;
    const start = range.from + before.length;
    return {
      changes: { from: range.from, to: range.to, insert: `${before}${body}${after}` },
      range: EditorSelection.range(start, start + body.length),
    };
  });

  view.dispatch({ ...spec, scrollIntoView: true });
  view.focus();
}

/** Toggle an ATX heading of `depth` on the caret's line. */
function toggleHeading(view: EditorView, depth: number): void {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const existing = /^(#{1,6})[ \t]+/.exec(line.text);
  const existingLength = existing?.[0].length ?? 0;

  // A second press on a heading of the same depth removes it, so the button is
  // a toggle rather than a way to accumulate hashes.
  const marker = existing?.[1]?.length === depth ? "" : `${"#".repeat(depth)} `;

  const delta = marker.length - existingLength;
  view.dispatch({
    changes: { from: line.from, to: line.from + existingLength, insert: marker },
    selection: EditorSelection.single(Math.max(line.from, head + delta)),
    scrollIntoView: true,
  });
  view.focus();
}

function insertLink(view: EditorView): void {
  const { state } = view;
  const range = state.selection.main;
  const selected = state.sliceDoc(range.from, range.to);
  const label = selected.length > 0 ? selected : "link text";
  const url = "https://";
  // `[` + label + `](` is three characters of syntax before the URL begins.
  const urlStart = range.from + label.length + 3;

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `[${label}](${url})` },
    // The URL is selected rather than merely pointed at, so pasting one
    // replaces the placeholder instead of appending to it.
    selection: EditorSelection.range(urlStart, urlStart + url.length),
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * The authoring blocks the pipeline understands.
 *
 * Each skeleton is well-formed on arrival — a `:::takeaways` already contains
 * a list, a `:::howto` already contains steps — because the directive
 * transform emits a lint warning for a block that is structurally empty, and
 * a toolbar button whose output immediately warns is a button that teaches
 * people to ignore the checks panel.
 */
export const BLOCK_COMMANDS: EditorCommand[] = [
  {
    id: "tldr",
    label: "TL;DR",
    title: "Summary block — the answer up front, in one or two sentences",
    icon: QuoteIcon,
    run: (view) => insertBlock(view, `:::tldr\n${CARET}\n:::`),
  },
  {
    id: "takeaways",
    label: "Takeaways",
    title: "Key takeaways — a short list of the points worth remembering",
    icon: ListChecksIcon,
    run: (view) => insertBlock(view, `:::takeaways\n- ${CARET}\n-\n:::`),
  },
  {
    id: "faq",
    label: "FAQ",
    title:
      "Question and answer. Each answer must also appear in the body above — an " +
      "answer that exists only here will not pass the publish gate",
    icon: CircleHelpIcon,
    run: (view) => insertBlock(view, `:::faq\n### ${CARET}\n\n:::`),
  },
  {
    id: "howto",
    label: "How-to",
    title: "Ordered steps, lifted into HowTo structured data",
    icon: ListOrderedIcon,
    run: (view) => insertBlock(view, `:::howto[${CARET}]\n::step[]\n::step[]\n:::`),
  },
  {
    id: "embed",
    label: "Embed",
    title: "Embed a video or other supported provider by URL",
    icon: FilmIcon,
    run: (view) => insertBlock(view, `::embed{url="${CARET}"}`),
  },
];

export const INLINE_COMMANDS: EditorCommand[] = [
  {
    id: "bold",
    label: "Bold",
    title: "Bold",
    icon: BoldIcon,
    key: "Mod-b",
    run: (view) => wrap(view, "**", "**", "bold text"),
  },
  {
    id: "link",
    label: "Link",
    title: "Insert a link",
    icon: LinkIcon,
    key: "Mod-k",
    run: insertLink,
  },
  {
    id: "heading",
    label: "Heading",
    title: "Toggle a level-2 heading on this line",
    icon: Heading2Icon,
    key: "Mod-Alt-2",
    run: (view) => toggleHeading(view, 2),
  },
];

export const ALL_COMMANDS: EditorCommand[] = [...INLINE_COMMANDS, ...BLOCK_COMMANDS];
