"use client";

import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import {
  Annotation,
  EditorState,
  type ChangeSet,
  type EditorSelection,
  type Extension,
} from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExt,
  type KeyBinding,
  type ViewUpdate,
} from "@codemirror/view";
import { useEffect, useRef } from "react";
import { Button, Toolbar, ToolbarGroup, ToolbarSeparator, cn } from "@cms/ui";
import { ALL_COMMANDS, BLOCK_COMMANDS, INLINE_COMMANDS } from "./snippets";

/**
 * CodeMirror 6, wrapped without being fought.
 *
 * CodeMirror owns a DOM subtree and a document of its own, and React owns a
 * render function that runs whenever anything above it changes. The two only
 * coexist if the boundary is drawn in exactly one place: the view is created
 * once, on mount, and lives in a ref for the rest of the component's life.
 *
 * Two mistakes follow from getting that wrong, and both are common enough to
 * be worth naming:
 *
 *   - Recreating the `EditorView` when a prop changes. Every parent render
 *     would tear down the editor and build a new one, which throws away the
 *     selection, the scroll position and the focus, mid-sentence.
 *   - Driving the document from a React state variable — `value={markdown}` —
 *     and writing it back on every keystroke. React re-renders after the state
 *     update, the effect pushes the "new" text back into a view that already
 *     contains it, and the caret jumps to the end of the document. The
 *     document is not React state; it lives in the view, and changes travel
 *     *out* through `updateListener`.
 *
 * So this component takes `initialValue`, never `value`. The parent keeps
 * whatever copy it needs for saving and previewing, and nothing it does with
 * that copy can reach back in and disturb the caret.
 */

const HISTORY_LIMIT = 300;
/** Keystrokes closer together than this collapse into one undo step. */
const HISTORY_GROUP_MS = 600;

type HistoryKind = "undo" | "redo";

/** Marks the transactions the history itself dispatches, so it ignores them. */
const historyEvent = Annotation.define<HistoryKind>();

interface HistoryEntry {
  /** The change that puts the document back. */
  changes: ChangeSet;
  selection: EditorSelection;
  time: number;
}

interface History {
  undo: HistoryEntry[];
  redo: HistoryEntry[];
}

/**
 * A minimal undo stack.
 *
 * `@codemirror/commands`, which ships the real `history()` extension, is not a
 * dependency of this app and this change may not add one. The alternative to
 * these few lines is an editor where Ctrl-Z silently does nothing, which in
 * the screen people spend all day in is not a defensible gap. Transactions
 * know how to invert themselves, so the stack only has to remember the
 * inverses and re-apply them; if `@codemirror/commands` is ever added, delete
 * all of this and use `history()` and `historyKeymap` instead.
 */
function record(history: History, update: ViewUpdate): void {
  for (const tr of update.transactions) {
    if (!tr.docChanged) continue;

    const entry: HistoryEntry = {
      changes: tr.changes.invert(tr.startState.doc),
      selection: tr.startState.selection,
      time: Date.now(),
    };

    const kind = tr.annotation(historyEvent);
    if (kind === "undo") {
      history.redo.push(entry);
      continue;
    }
    if (kind === "redo") {
      history.undo.push(entry);
      continue;
    }

    // A fresh edit invalidates the redo branch, exactly as every other editor
    // behaves: you cannot redo into a future you have just diverged from.
    history.redo.length = 0;

    const top = history.undo[history.undo.length - 1];
    if (top && entry.time - top.time < HISTORY_GROUP_MS) {
      // Undoing a paragraph one character at a time is undo that nobody uses,
      // so adjacent edits compose into a single step. Order matters: the newer
      // inverse runs first, and lands the document where the older inverse
      // expects to find it.
      history.undo[history.undo.length - 1] = {
        changes: entry.changes.compose(top.changes),
        selection: top.selection,
        time: entry.time,
      };
    } else {
      history.undo.push(entry);
      if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    }
  }
}

function step(view: EditorView, stack: HistoryEntry[], kind: HistoryKind): boolean {
  const entry = stack.pop();
  if (!entry) return false;
  view.dispatch({
    changes: entry.changes,
    selection: entry.selection,
    annotations: historyEvent.of(kind),
    scrollIntoView: true,
  });
  return true;
}

/**
 * Colours come from the design tokens rather than from CodeMirror's own theme,
 * so the editor tracks the studio's light and dark palettes without a second
 * set of definitions to keep in step.
 */
const theme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "0.8125rem",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-ink)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
    overflow: "auto",
  },
  ".cm-content": { padding: "0.75rem 0", caretColor: "var(--color-ink)" },
  ".cm-line": { padding: "0 0.75rem" },
  ".cm-gutters": {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-ink-muted)",
    border: "none",
    borderRight: "1px solid var(--color-border)",
  },
  ".cm-activeLineGutter": { backgroundColor: "var(--color-muted)" },
  ".cm-activeLine": { backgroundColor: "color-mix(in oklch, var(--color-muted) 60%, transparent)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--color-ink)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in oklch, var(--color-accent) 25%, transparent)",
  },
  ".cm-placeholder": { color: "var(--color-ink-muted)" },
});

export interface MarkdownEditorProps {
  /**
   * The document to start from. Read once, on mount. Later changes are
   * ignored on purpose — see the note at the top of this file.
   */
  initialValue: string;
  onChange: (markdown: string) => void;
  /** Invoked on Ctrl/Cmd-S, which the editor swallows so the browser does not. */
  onSaveRequest?: () => void;
  label?: string;
  placeholder?: string;
  className?: string;
}

export function MarkdownEditor({
  initialValue,
  onChange,
  onSaveRequest,
  label = "Markdown body",
  placeholder = "Write in markdown. Use the toolbar for TL;DR, takeaways, FAQ, how-to and embed blocks.",
  className,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const historyRef = useRef<History>({ undo: [], redo: [] });

  /**
   * The callbacks are read through refs rather than closed over.
   *
   * The editor is built once, so a handler captured at mount would keep
   * calling the first render's `onChange` forever — holding a stale `draft`
   * and quietly reverting saves. A ref updated on every render keeps the view
   * calling the current one without the view itself having to be rebuilt.
   */
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSaveRequest);
  useEffect(() => {
    onChangeRef.current = onChange;
    onSaveRef.current = onSaveRequest;
  });

  // Captured once so a re-render with a different `initialValue` cannot
  // retroactively become a document reset.
  const initialRef = useRef(initialValue);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const history = historyRef.current;

    const bindings: KeyBinding[] = [
      ...ALL_COMMANDS.flatMap((command): KeyBinding[] =>
        command.key
          ? [
              {
                key: command.key,
                preventDefault: true,
                run: (view) => {
                  command.run(view);
                  return true;
                },
              },
            ]
          : [],
      ),
      { key: "Mod-z", preventDefault: true, run: (view) => step(view, history.undo, "undo") },
      {
        key: "Mod-Shift-z",
        mac: "Mod-Shift-z",
        preventDefault: true,
        run: (view) => step(view, history.redo, "redo"),
      },
      { key: "Mod-y", preventDefault: true, run: (view) => step(view, history.redo, "redo") },
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ];

    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      EditorView.lineWrapping,
      placeholderExt(placeholder),
      // `codeLanguages` lets the markdown parser recognise the language of a
      // fenced block, so ```ts is parsed as TypeScript rather than as opaque
      // text. Note that CodeMirror still needs a highlight style to paint the
      // result, and `@codemirror/language` is not installed here — see the
      // note in the accompanying report.
      markdown({ codeLanguages: languages }),
      // Continues lists and blockquotes on Enter, and deletes markup
      // sensibly on Backspace. Placed before our own bindings so Enter keeps
      // its markdown-aware behaviour.
      keymap.of([...markdownKeymap, ...bindings]),
      theme,
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true" }),
      EditorView.updateListener.of((update) => {
        record(history, update);
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: initialRef.current, extensions }),
      parent: host,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
      history.undo.length = 0;
      history.redo.length = 0;
    };
    // Mount only. Every prop this effect reads is either captured in a ref or
    // fixed for the life of the editor; adding them here is what would start
    // recreating the view mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function run(command: (typeof ALL_COMMANDS)[number]): void {
    const view = viewRef.current;
    if (view) command.run(view);
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]",
        className,
      )}
    >
      <Toolbar aria-label="Markdown formatting">
        <ToolbarGroup>
          {INLINE_COMMANDS.map((command) => (
            <Button
              key={command.id}
              size="icon"
              variant="ghost"
              aria-label={command.title}
              title={command.title}
              onClick={() => run(command)}
            >
              <command.icon aria-hidden="true" />
            </Button>
          ))}
        </ToolbarGroup>

        <ToolbarSeparator />

        <ToolbarGroup className="ui-scroll min-w-0 overflow-x-auto">
          {BLOCK_COMMANDS.map((command) => (
            <Button
              key={command.id}
              size="sm"
              variant="ghost"
              title={command.title}
              onClick={() => run(command)}
            >
              <command.icon aria-hidden="true" />
              {command.label}
            </Button>
          ))}
        </ToolbarGroup>
      </Toolbar>

      {/*
        React renders this element and nothing inside it. CodeMirror appends
        its own subtree here on mount and owns it from then on; giving React
        children to reconcile would put the two in a fight over the same DOM.
      */}
      <div ref={hostRef} className="ui-scroll min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
