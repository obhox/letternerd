"use client";

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState, Prec, type Extension } from "@codemirror/state";
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

/**
 * The slash menu.
 *
 * The same commands as the toolbar, reachable without leaving the keyboard.
 * The trigger deliberately requires the slash to start a line or follow
 * whitespace, so "and/or" and "https://" do not open a menu mid-sentence.
 */
function slashCommands(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/(?:^|\s)\/[a-z]*/i);
  if (!before) return null;

  const offset = before.text.indexOf("/");
  if (offset < 0) return null;
  const from = before.from + offset;

  const options: Completion[] = BLOCK_COMMANDS.map((command) => ({
    label: `/${command.id}`,
    detail: command.label,
    info: command.title,
    type: "keyword",
    apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
      // Remove the typed "/faq" before running the command, so the skeleton is
      // inserted onto a clean line rather than after the trigger text.
      view.dispatch({
        changes: { from: applyFrom, to: applyTo, insert: "" },
        selection: { anchor: applyFrom },
      });
      command.run(view);
    },
  }));

  return { from, options, validFor: /^\/[a-z]*$/i };
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
  ".cm-tooltip": {
    border: "1px solid var(--color-border)",
    borderRadius: "0.375rem",
    backgroundColor: "var(--color-surface)",
    color: "var(--color-ink)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    fontFamily: "var(--font-sans)",
    padding: "0.25rem 0.5rem",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-muted)",
    color: "var(--color-ink)",
  },
  ".cm-completionDetail": { color: "var(--color-ink-muted)", fontStyle: "normal" },
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
  placeholder = "Write in markdown. Type / for the authoring blocks, or use the toolbar.",
  className,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

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
      /*
       * Ours first, and at the highest precedence.
       *
       * Keymaps are consulted in precedence order, so this is what guarantees
       * Ctrl-S saves the document rather than opening the browser's save
       * dialog, and that it keeps doing so whatever `defaultKeymap`, the
       * completion keymap or the markdown keymap bind now or later. None of
       * these keys collide with Enter or Backspace, so list continuation and
       * markup-aware deletion are left alone.
       */
      Prec.highest(keymap.of(bindings)),

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
      // text. `markdown()` installs its own keymap — Enter continues a list,
      // Backspace deletes markup — at a precedence above the default one, so
      // it is not added again by hand here.
      markdown({ codeLanguages: languages }),
      // `fallback: true` so plain text and any token the style does not name
      // still take the editor's own colour rather than the browser default.
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),

      history(),
      // Only the slash menu completes. `override` replaces every other source,
      // which keeps a popup from appearing while somebody is writing prose.
      autocompletion({ override: [slashCommands] }),
      keymap.of([...historyKeymap, ...defaultKeymap]),

      theme,
      EditorView.contentAttributes.of({ "aria-label": label, spellcheck: "true" }),
      EditorView.updateListener.of((update) => {
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
